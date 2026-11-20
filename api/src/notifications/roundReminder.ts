import type { AnalyticsEngineDataset, D1Database } from '@cloudflare/workers-types'
import { googleSubOf, hasPilotAccess } from '../auth/permissions'
import { notBannedSql } from '../groups/ranking'
import { lockedSql } from '../matches/locking'
import { isoSeconds } from '../matches/matchUpsert'
import { hashUserId, logEvent } from '../observability/events'
import type { Env } from '../types'
import { EmailError, sendEmail } from './email'
import {
  MailjetError,
  type MailjetCredentials,
  isTransientMailjetError,
  sendMailjetEmail,
} from './mailjet'
import {
  type Digest,
  type DigestGroup,
  type DigestRound,
  MAX_DIGEST_GROUPS,
  REMINDER_TIME_ZONE,
  buildEmailHtml,
  buildEmailText,
  reminderSubject,
} from './reminderEmail'
import { signUnsubToken } from './unsubscribeToken'

const APP_URL = 'https://palpitae.com.br'
const DAY_MS = 24 * 60 * 60 * 1000
const SEND_LOG_RETENTION_DAYS = 7

// Os envios saem em sequência, um por vez. Um 429 de limite por segundo ou um 5xx
// passageiro merece nova tentativa, porque o cron só roda uma vez por dia. Outro 4xx
// é permanente (endereço inválido, por exemplo) e falha na hora.
const MAX_SEND_ATTEMPTS = 3

// O plano da conta Cloudflare não está confirmado (docs/architecture/
// capacidade-coordenacao-provedores.md), então vale o pior caso: Free, com 50
// subrequests por invocação. O D1 conta junto com o `fetch`. A invocação gasta 4
// consultas fixas (SELECT, batch de reserva, liberação das reservas e a limpeza de
// segurança do `scheduled`) e deixa 1 de folga, que cobre a nova tentativa da
// liberação quando a primeira falha. Sobram 45 subrequests para os `fetch` ao Resend,
// contando cada reenvio, e para as revalidações de descadastro, contando a nova
// tentativa de cada uma. É o padrão do teto; `REMINDER_FETCH_BUDGET` o substitui
// (`reminderFetchBudget`).
const SUBREQUEST_LIMIT = 50
const D1_SUBREQUESTS = 4
const SUBREQUEST_MARGIN = 1
export const RESEND_FETCH_BUDGET = SUBREQUEST_LIMIT - D1_SUBREQUESTS - SUBREQUEST_MARGIN

/**
 * Teto de `fetch` por execução a partir de `REMINDER_FETCH_BUDGET`. Vazio ou ausente
 * vale `RESEND_FETCH_BUDGET`. Um valor que não seja inteiro positivo também volta ao
 * padrão, com erro no log, para que um erro de digitação não desligue o lembrete.
 * Acima de 45 só cabe com o plano Paid da Cloudflare: no Free, o Worker é cortado no
 * 51º subrequest.
 */
export function reminderFetchBudget(raw: string | undefined): number {
  const value = raw?.trim()
  if (!value) return RESEND_FETCH_BUDGET
  if (/^\d+$/.test(value) && Number(value) > 0) return Number(value)
  console.error(
    `[roundReminder] REMINDER_FETCH_BUDGET inválido (${JSON.stringify(raw)}): usando ${RESEND_FETCH_BUDGET}.`,
  )
  return RESEND_FETCH_BUDGET
}

// Por quanto tempo a última leitura de descadastro vale durante o lote. A reserva lê
// a preferência, e uma tentativa de envio que começa depois desse prazo relê antes de
// chamar o Resend. Na prática custa uma consulta a cada 5 s de lote: um lote cheio,
// com envios um por vez, gasta de 1 a 3 vagas do teto nessas releituras. Reler antes
// de cada envio custaria um subrequest por destinatário e cortaria pela metade quem
// cabe no teto.
const UNSUB_RECHECK_MS = 5_000

// Espera antes de repetir uma leitura ou gravação do D1 que falhou. O cron roda uma
// vez por dia, e uma falha passageira não deve encerrar a fila nem prender reservas.
const D1_RETRY_MS = 250

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Roda a operação do D1 e, se ela falhar, repete uma vez depois de `D1_RETRY_MS`.
 * `canRetry` é consultado depois da falha e pode impedir a nova tentativa. Lança o
 * erro da última tentativa.
 */
async function withD1Retry<T>(
  operation: () => Promise<T>,
  canRetry: () => boolean = () => true,
): Promise<T> {
  try {
    return await operation()
  } catch (err) {
    if (!canRetry()) throw err
    await sleep(D1_RETRY_MS)
    return operation()
  }
}

/** Contador dos subrequests desta execução que não são as consultas fixas. */
type FetchBudget = { used: number; max: number }

/** O teto de subrequests chegou. Quem não enviou volta para a próxima execução. */
class SubrequestBudgetError extends Error {
  constructor() {
    super('Teto de subrequests da execução atingido')
    this.name = 'SubrequestBudgetError'
  }
}

/** O usuário descadastrou depois da reserva. Não é falha: a reserva volta e ele sai do lote. */
class UnsubscribedError extends Error {
  constructor() {
    super('Usuário descadastrado durante o lote')
    this.name = 'UnsubscribedError'
  }
}

/** A leitura de descadastro falhou. Sem ela nenhum envio segue. */
class UnsubCheckError extends Error {
  constructor(cause: unknown) {
    super('Falha ao revalidar descadastro', { cause })
    this.name = 'UnsubCheckError'
  }
}

/**
 * Confere o descadastro de quem ainda vai receber. A leitura vale por
 * `UNSUB_RECHECK_MS`. Vencido o prazo, uma consulta só relê todos os pendentes e
 * desconta um subrequest do saldo. Ela só roda se sobrar saldo para a consulta e um
 * envio. Se a consulta falhar, ela é repetida uma vez nas mesmas condições de saldo.
 */
class UnsubGuard {
  private readonly subscribed: Set<string>
  private checkedAt: number

  constructor(
    private readonly db: D1Database,
    userIds: string[],
    private readonly budget: FetchBudget,
    readAt: number,
  ) {
    // A reserva leu a preferência de todos. `readAt` é o início dela, o instante mais
    // antigo em que a leitura pode ter acontecido.
    this.subscribed = new Set(userIds)
    this.checkedAt = readAt
  }

  /** Lança `UnsubscribedError` se o usuário saiu da lista depois da última leitura. */
  async assertSubscribed(userId: string): Promise<void> {
    if (Date.now() - this.checkedAt >= UNSUB_RECHECK_MS) await this.recheck()
    if (!this.subscribed.has(userId)) throw new UnsubscribedError()
  }

  /** O usuário saiu da fila, com ou sem envio. A próxima leitura não o inclui. */
  done(userId: string): void {
    this.subscribed.delete(userId)
  }

  private async recheck(): Promise<void> {
    if (!this.canRead()) throw new SubrequestBudgetError()
    let startedAt = 0
    let rows: { id: string }[]
    try {
      // A nova tentativa desconta do saldo como a primeira. Sem saldo para ela e um
      // envio, a falha encerra a fila.
      rows = await withD1Retry(
        () => {
          this.budget.used++
          startedAt = Date.now()
          return this.readSubscribed()
        },
        () => this.canRead(),
      )
    } catch (err) {
      throw new UnsubCheckError(err)
    }
    const still = new Set(rows.map((row) => row.id))
    for (const id of this.subscribed) if (!still.has(id)) this.subscribed.delete(id)
    this.checkedAt = startedAt
  }

  /** Sobra saldo para uma consulta e um envio. */
  private canRead(): boolean {
    return this.budget.max - this.budget.used >= 2
  }

  private async readSubscribed(): Promise<{ id: string }[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id FROM users
         WHERE id IN (SELECT value FROM json_each(?)) AND email_unsubscribed_at IS NULL`,
      )
      .bind(JSON.stringify([...this.subscribed]))
      .all<{ id: string }>()
    return results
  }
}

/**
 * Falha que vale nova tentativa: 429 de limite por segundo, 5xx e erro de rede
 * (status 0 ou erro que não vem do Resend). Cota esgotada e outros 4xx são permanentes.
 */
function isTransientEmailError(err: unknown): boolean {
  const emailError = err instanceof EmailError ? err : undefined
  const status = emailError?.status ?? 0
  return !emailError?.quotaExceeded && (status === 429 || status >= 500 || status === 0)
}

/**
 * Erro do Resend depois de ao menos uma falha passageira na mesma chamada.
 * A tentativa anterior pode ter sido aceita (timeout/5xx/rede); o status final
 * não autoriza fallback nem reenvio às cegas.
 */
export class UncertainResendError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super('Resend incerto após tentativa passageira')
    this.name = 'UncertainResendError'
    this.cause = cause
  }
}

/**
 * Envia um e-mail, repetindo em 429 de limite por segundo e em 5xx ou erro de rede,
 * com espera exponencial que respeita o Retry-After do Resend. Cota esgotada e
 * outros 4xx falham na primeira tentativa. Cada tentativa gasta o saldo de `fetch` da
 * execução, e sem saldo lança `SubrequestBudgetError`. Lança o erro quando as tentativas acabam,
 * e quem chama contabiliza a falha e segue.
 *
 * Se alguma tentativa passageira precedeu o erro final, lança `UncertainResendError`
 * envolvendo a causa: o Resend pode ter aceitado antes da falha visível.
 *
 * `beforeAttempt` roda antes de cada tentativa, inclusive dos reenvios, e cancela o
 * envio lançando erro. É o último ponto em que o descadastro ainda impede o e-mail.
 * Depois que o `fetch` começa, o Resend pode aceitar, e o e-mail aceito não volta.
 * Um reenvio cancelado depois de uma resposta 5xx ou de erro de rede pode ter sido
 * precedido de um aceite que a resposta não confirmou.
 */
async function sendWithRetry(
  apiKey: string,
  msg: Parameters<typeof sendEmail>[1],
  budget: FetchBudget,
  beforeAttempt: () => Promise<void>,
): Promise<void> {
  let hadTransient = false
  for (let attempt = 1; ; attempt++) {
    // Cada tentativa é um `fetch`. Sem saldo, para antes de chamar a rede.
    if (budget.used >= budget.max) {
      if (hadTransient) throw new UncertainResendError(new SubrequestBudgetError())
      throw new SubrequestBudgetError()
    }
    await beforeAttempt()
    budget.used++
    try {
      await sendEmail(apiKey, msg)
      return
    } catch (err) {
      if (!isTransientEmailError(err) || attempt >= MAX_SEND_ATTEMPTS) {
        if (hadTransient) throw new UncertainResendError(err)
        throw err
      }
      hadTransient = true
      if (budget.used >= budget.max) throw new UncertainResendError(new SubrequestBudgetError())
      const retryAfterMs = err instanceof EmailError ? err.retryAfterMs : undefined
      await sleep(retryAfterMs ?? 500 * 2 ** (attempt - 1))
    }
  }
}

/** Configuração do link de descadastro. Sem ela o e-mail sai sem o link. */
type UnsubConfig = {
  secret: string
  apiBaseUrl: string
}

type PendingRow = {
  user_id: string
  email: string
  /** Provedor e id da conta, para o `sub` do Google que o `ADMIN_GOOGLE_SUB` confere. */
  provider: string | null
  provider_id: string | null
  group_id: string
  group_name: string
  competition_id: string
  competition_name: string
  competition_visibility: string | null
  match_id: string
  round: string | null
  start_time: string
  home_team: string
  away_team: string
  home_logo: string | null
  away_logo: string | null
  /** Último dia com lembrete enviado ao usuário, nos 7 dias guardados. */
  last_sent: string | null
}

/**
 * Jogos de hoje ainda abertos e sem palpite, um por usuário e grupo. Exportado para
 * o teste de plano de consulta (roundReminder.queryPlan.test.ts).
 *
 * `m.postponed = 0` fica fora de `lockedSql`, porque jogo adiado segue aberto para
 * palpite (ADR-013). Ele não entra no lembrete porque não tem dia marcado. Jogo
 * remarcado tem `postponed = 0` e entra no dia novo, mesmo em rodada que ficou para
 * trás (ADR-019).
 *
 * Quem tem registro em `group_bans` do grupo fica de fora, pelo mesmo filtro das
 * outras leituras (`notBannedSql`), mesmo que sobre uma linha em `group_members`.
 *
 * Os `CROSS JOIN` fixam a ordem. A consulta parte dos jogos do dia pelo índice de
 * `start_time`, e cada junção seguinte é uma busca por chave. Binds em
 * `pendingMatchesBinds`.
 *
 * `last_sent` ordena a fila de envio (`byQueueOrder`). Vem da chave primária de
 * `email_reminder_sends`, sem consulta a mais.
 */
export const PENDING_MATCHES_SQL = `SELECT
         u.id         AS user_id,
         u.email      AS email,
         u.provider   AS provider,
         u.provider_id AS provider_id,
         g.id         AS group_id,
         g.name       AS group_name,
         c.id         AS competition_id,
         c.name       AS competition_name,
         c.visibility AS competition_visibility,
         m.id         AS match_id,
         m.round      AS round,
         m.start_time AS start_time,
         ht.name      AS home_team,
         awt.name     AS away_team,
         ht.logo_url  AS home_logo,
         awt.logo_url AS away_logo,
         (SELECT MAX(ls.reminder_date) FROM email_reminder_sends ls
          WHERE ls.user_id = u.id) AS last_sent
       FROM matches m
       CROSS JOIN groups g         ON g.competition_id = m.competition_id AND g.deleted_at IS NULL
       CROSS JOIN group_members gm ON gm.group_id = g.id
       CROSS JOIN users u          ON u.id = gm.user_id
       JOIN competitions c         ON c.id = m.competition_id
       JOIN teams ht               ON ht.id = m.home_team_id
       JOIN teams awt              ON awt.id = m.away_team_id
       WHERE m.start_time > ?
         AND m.start_time < ?
         AND m.postponed = 0
         AND NOT ${lockedSql('m')}
         AND u.email_unsubscribed_at IS NULL
         AND ${notBannedSql('gm')}
         AND NOT EXISTS (
           SELECT 1 FROM predictions p
           WHERE p.user_id = u.id AND p.group_id = g.id AND p.match_id = m.id
         )
         AND NOT EXISTS (
           SELECT 1 FROM email_reminder_sends s
           WHERE s.user_id = u.id AND s.reminder_date = ?
         )
       ORDER BY m.start_time ASC`

type ReminderDay = {
  /** Dia em Brasília, YYYY-MM-DD. */
  date: string
  /** Meia-noite seguinte em Brasília, em UTC. */
  endIso: string
  /** Linhas de `email_reminder_sends` anteriores a este dia são apagadas. */
  retentionCutoff: string
}

const REMINDER_ZONE_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: REMINDER_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** Relógio de Brasília no instante, lido como se fosse UTC. */
function zonedWallClockMs(instantMs: number): number {
  const instant = new Date(instantMs)
  const parts: Record<string, number> = {}
  for (const { type, value } of REMINDER_ZONE_FORMAT.formatToParts(instant)) {
    if (type !== 'literal') parts[type] = Number(value)
  }
  // O formato para nos segundos. Os milissegundos voltam para o deslocamento sair exato.
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    instant.getUTCMilliseconds(),
  )
}

/** Dia em Brasília no instante, YYYY-MM-DD. */
function zonedDate(instantMs: number): string {
  return new Date(zonedWallClockMs(instantMs)).toISOString().slice(0, 10)
}

/**
 * Primeiro instante do dia seguinte em Brasília. A meia-noite usa o deslocamento de
 * agora e, se ele mudar até lá, o de depois da mudança. Fica o menor candidato que já
 * cai no dia seguinte. No início do horário de verão a meia-noite não existe e o dia
 * acaba quando 00:00 vira 01:00. No fim, a hora repetida ainda conta como dia anterior.
 */
function nextZonedMidnightMs(nowMs: number, date: string): number {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
  const wallMidnight = Date.parse(`${next}T00:00:00Z`)
  const before = wallMidnight - (zonedWallClockMs(nowMs) - nowMs)
  const after = wallMidnight - (zonedWallClockMs(before) - before)
  return Math.min(...[before, after].filter((candidate) => zonedDate(candidate) >= next))
}

function reminderDay(nowMs: number): ReminderDay {
  const date = zonedDate(nowMs)
  const dayMs = Date.parse(`${date}T00:00:00Z`)
  return {
    date,
    endIso: isoSeconds(new Date(nextZonedMidnightMs(nowMs, date))),
    retentionCutoff: new Date(dayMs - SEND_LOG_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10),
  }
}

/** Binds na ordem exigida por `PENDING_MATCHES_SQL`. */
function pendingMatchesBinds(nowIso: string, day: ReminderDay): string[] {
  return [nowIso, day.endIso, nowIso, day.date]
}

/**
 * Agrupa as linhas por usuário, grupo e rodada. A rodada faz parte da chave porque
 * um grupo pode ter, no mesmo dia, jogo da rodada atual e jogo remarcado de rodada
 * antiga, e cada um precisa do próprio link. As linhas chegam em ordem de horário,
 * então grupos e rodadas ficam na ordem do primeiro jogo.
 */
function buildDigests(rows: PendingRow[]): Digest[] {
  const digests = new Map<
    string,
    {
      digest: Digest
      groups: Map<string, { group: DigestGroup; rounds: Map<string | null, DigestRound> }>
    }
  >()
  for (const row of rows) {
    let entry = digests.get(row.user_id)
    if (!entry) {
      const digest: Digest = {
        userId: row.user_id,
        email: row.email,
        groups: [],
        matchIds: new Set(),
        firstStart: row.start_time,
        lastSent: row.last_sent,
      }
      entry = { digest, groups: new Map() }
      digests.set(row.user_id, entry)
    }
    const { digest, groups } = entry

    let indexedGroup = groups.get(row.group_id)
    if (!indexedGroup) {
      const group: DigestGroup = {
        groupId: row.group_id,
        groupName: row.group_name,
        competitionName: row.competition_name,
        rounds: [],
      }
      digest.groups.push(group)
      indexedGroup = { group, rounds: new Map() }
      groups.set(row.group_id, indexedGroup)
    }

    let round = indexedGroup.rounds.get(row.round)
    if (!round) {
      round = { competitionId: row.competition_id, round: row.round, matches: [] }
      indexedGroup.group.rounds.push(round)
      indexedGroup.rounds.set(row.round, round)
    }

    round.matches.push({
      home: row.home_team,
      away: row.away_team,
      homeLogo: row.home_logo,
      awayLogo: row.away_logo,
      startTime: row.start_time,
    })
    digest.matchIds.add(row.match_id)
  }
  return [...digests.values()].map(({ digest }) => digest)
}

/**
 * Ordem da fila de envio quando o teto não cobre todos. Primeiro quem recebeu o
 * lembrete há mais tempo, ou não recebeu nos últimos 7 dias. Quem ficou de fora num
 * dia não tem linha desse dia e passa à frente de quem recebeu. Sem essa regra a fila
 * seguiria só o horário do primeiro jogo, e quem joga à noite ficaria de fora todo dia.
 * No empate vale o jogo que fecha primeiro e, por fim, o id, para a ordem ser estável.
 */
function byQueueOrder(a: Digest, b: Digest): number {
  const lastSent = (a.lastSent ?? '').localeCompare(b.lastSent ?? '')
  if (lastSent !== 0) return lastSent
  const firstStart = a.firstStart.localeCompare(b.firstStart)
  if (firstStart !== 0) return firstStart
  return a.userId < b.userId ? -1 : 1
}

/**
 * Linhas de competição em piloto ficam só para quem tem acesso ao piloto, o mesmo
 * critério da lista de grupos. Quem saiu de `PILOT_EMAILS` continua membro do grupo,
 * mas não abre o link.
 */
function withPilotAccess(rows: PendingRow[], access: PilotAccess): PendingRow[] {
  const allowed = new Map<string, boolean>()
  return rows.filter((row) => {
    if (row.competition_visibility !== 'pilot') return true
    let ok = allowed.get(row.user_id)
    if (ok === undefined) {
      ok = hasPilotAccess(
        { email: row.email, googleSub: googleSubOf(row.provider, row.provider_id) },
        access,
      )
      allowed.set(row.user_id, ok)
    }
    return ok
  })
}

/** Rodadas distintas nos e-mails, para o evento agregado do cron. */
function countRounds(digests: Digest[]): number {
  const rounds = new Set<string>()
  for (const digest of digests) {
    for (const group of digest.groups) {
      for (const round of group.rounds) rounds.add(`${round.competitionId}::${round.round}`)
    }
  }
  return rounds.size
}

/**
 * Reserva o envio do dia em uma gravação só e devolve os usuários reservados por
 * esta execução. Outra execução no mesmo dia não recebe esses usuários, e a chave
 * primária garante isso mesmo com disparos simultâneos.
 *
 * A gravação é única porque cada consulta ao D1 conta no
 * limite de subrequests do Worker junto com os envios ao Resend. O plano Free tem
 * 50 por invocação. O chamador libera em `finally` as reservas sem aceite do provedor.
 *
 * A reserva relê o descadastro na mesma gravação. Quem saiu da lista depois da
 * consulta dos pendentes não é reservado.
 */
async function claimRecipients(
  db: D1Database,
  userIds: string[],
  day: ReminderDay,
): Promise<Set<string>> {
  const [, claim] = await db.batch<{ user_id: string }>([
    db
      .prepare('DELETE FROM email_reminder_sends WHERE reminder_date < ?')
      .bind(day.retentionCutoff),
    db
      .prepare(
        `INSERT INTO email_reminder_sends (user_id, reminder_date)
         SELECT u.id, ? FROM json_each(?) j
         JOIN users u ON u.id = j.value
         WHERE u.email_unsubscribed_at IS NULL
         ON CONFLICT (user_id, reminder_date) DO NOTHING
         RETURNING user_id`,
      )
      .bind(day.date, JSON.stringify(userIds)),
  ])
  return new Set(claim.results.map((row) => row.user_id))
}

/**
 * Devolve a reserva de quem não recebeu, para que uma nova execução no mesmo dia
 * possa enviar. Uma falha tem uma nova tentativa, que usa a vaga de folga do teto de
 * subrequests. Se a falha persistir, ela só vai para o log e a execução segue até o
 * evento final, porque o envio do dia já terminou.
 */
async function releaseClaims(db: D1Database, userIds: string[], day: ReminderDay): Promise<void> {
  if (userIds.length === 0) return
  try {
    await withD1Retry(() =>
      db
        .prepare(
          `DELETE FROM email_reminder_sends
           WHERE reminder_date = ? AND user_id IN (SELECT value FROM json_each(?))`,
        )
        .bind(day.date, JSON.stringify(userIds))
        .run(),
    )
  } catch (err) {
    // Só a contagem: os ids identificariam quem ficou sem lembrete.
    console.error(
      `[roundReminder] Falha ao liberar ${userIds.length} reserva(s) depois de 2 tentativas. Uma nova execução hoje não envia para essas pessoas:`,
      err,
    )
  }
}

function failureReason(err: unknown): string {
  if (err instanceof SubrequestBudgetError) return 'subrequest_budget'
  if (err instanceof UnsubCheckError) return 'unsub_check_failed'
  if (err instanceof MailjetError) return `mailjet_http_${err.status}`
  if (err instanceof UncertainResendError) {
    const cause = err.cause
    if (cause instanceof EmailError) {
      return cause.quotaExceeded ? 'quota_exceeded' : `http_${cause.status}`
    }
    if (cause instanceof SubrequestBudgetError) return 'subrequest_budget'
    return 'unknown'
  }
  if (!(err instanceof EmailError)) return 'unknown'
  return err.quotaExceeded ? 'quota_exceeded' : `http_${err.status}`
}

/**
 * Motivo que encerra a fila: toda tentativa seguinte falharia, ou sairia sem a
 * leitura de descadastro. `null` deixa a fila seguir.
 *
 * Com Mailjet configurado, cota do Resend não encerra a fila: o desvio ao
 * fallback cobre o restante.
 */
function stopReason(err: unknown, mailjetConfigured: boolean): string | null {
  if (err instanceof UncertainResendError) {
    return stopReason(err.cause, mailjetConfigured)
  }
  if (err instanceof EmailError && err.quotaExceeded) {
    return mailjetConfigured ? null : 'quota_exceeded'
  }
  if (err instanceof SubrequestBudgetError || err instanceof UnsubCheckError) {
    return failureReason(err)
  }
  return null
}

/** Chave de correlação compartilhada entre Resend (Idempotency-Key) e Mailjet (CustomID). */
function reminderCorrelationId(userId: string, reminderDate: string): string {
  return `lembrete-diario/${userId}/${reminderDate}`
}

/**
 * Recusa definitiva do Resend: 4xx de validação/conta ou cota esgotada, na primeira
 * tentativa sem falha passageira antes. 409 (idempotência concorrente ou corpo
 * diferente na reexecução) nunca é definitivo: o Resend pode ter aceitado, ou a
 * chave do dia já foi usada. Timeout, 5xx, rede e `UncertainResendError` também
 * ficam de fora.
 */
function isDefinitiveResendRefusal(err: unknown): err is EmailError {
  if (!(err instanceof EmailError)) return false
  if (err.status === 409) return false
  return !isTransientEmailError(err)
}

/** Conta Resend indisponível para o restante do lote (cota ou credencial). */
function marksResendUnavailable(err: EmailError): boolean {
  return err.quotaExceeded || err.status === 401 || err.status === 403
}

type DispatchOptions = {
  db: D1Database
  resendApiKey: string
  appUrl: string
  apiBaseUrl: string | undefined
  unsub: UnsubConfig | undefined
  ae: AnalyticsEngineDataset | undefined
  day: ReminderDay
  /** Saldo de `fetch` (Resend, Mailjet e revalidações). Os testes reduzem para exercitar o teto. */
  fetchBudget?: number
  pendingClaims: Set<string>
  /** Início da gravação da reserva, que leu o descadastro de todos. */
  claimStartedAt: number
  /**
   * Fallback Mailjet. Ausente = comportamento idêntico ao da main (só Resend).
   * Só entra após recusa definitiva do Resend, e só para quem ainda não teve
   * tentativa no dia nesta execução.
   */
  mailjet?: MailjetCredentials
}

type DispatchResult = {
  sent: number
  matchesListed: number
  failedUserIds: string[]
  /** Descadastraram depois da reserva e não receberam. */
  unsubscribedUserIds: string[]
}

/**
 * Um envio pelo Mailjet. Conta no teto de subrequests. Sem nova tentativa: a
 * Mailjet não tem idempotência como a do Resend.
 */
async function sendViaMailjetOnce(
  creds: MailjetCredentials,
  msg: Parameters<typeof sendEmail>[1],
  customId: string,
  budget: FetchBudget,
  beforeAttempt: () => Promise<void>,
): Promise<'accepted' | 'uncertain'> {
  if (budget.used >= budget.max) throw new SubrequestBudgetError()
  await beforeAttempt()
  budget.used++
  try {
    await sendMailjetEmail(creds, msg, customId)
    return 'accepted'
  } catch (err) {
    if (isTransientMailjetError(err)) return 'uncertain'
    throw err
  }
}

/**
 * Envia um e-mail por usuário, sem endereço compartilhado. Uma falha não derruba
 * os demais. Cota esgotada (sem Mailjet), teto de subrequests ou falha na leitura
 * de descadastro encerram a fila. Com Mailjet, cota do Resend desvia o restante
 * ao fallback. Quem fica de fora volta em `failedUserIds`, e quem descadastrou
 * durante o lote volta em `unsubscribedUserIds`.
 */
async function dispatchDigests(
  digests: Digest[],
  {
    db,
    resendApiKey,
    appUrl,
    apiBaseUrl,
    unsub,
    ae,
    day,
    fetchBudget = RESEND_FETCH_BUDGET,
    pendingClaims,
    claimStartedAt,
    mailjet,
  }: DispatchOptions,
): Promise<DispatchResult> {
  // A leitura de descadastro da reserva vale a partir do início da gravação.
  const budget: FetchBudget = { used: 0, max: fetchBudget }
  const guard = new UnsubGuard(
    db,
    digests.map((digest) => digest.userId),
    budget,
    claimStartedAt,
  )

  // Hash e token saem em paralelo antes dos envios. O try/catch por usuário impede
  // que um token com erro derrube o lote.
  const prepared = await Promise.all(
    digests.map(async (digest) => {
      const hashedId = await hashUserId(digest.userId).catch(() => '<hash-error>')
      let unsubToken: string | undefined = undefined
      let tokenError: unknown = null
      if (unsub && apiBaseUrl) {
        try {
          unsubToken = await signUnsubToken(digest.userId, unsub.secret)
        } catch (err) {
          tokenError = err
        }
      }
      return { digest, hashedId, unsubToken, tokenError }
    }),
  )

  let sent = 0
  let matchesListed = 0
  let stopped: string | null = null
  /** Cota do Resend já recusou nesta execução: o restante vai direto ao Mailjet. */
  let resendUnavailable = false
  /**
   * Quem já teve tentativa nesta execução (Resend incerto ou Mailjet). Não recebe
   * Mailjet de novo no desvio por cota.
   */
  const attempted = new Set<string>()
  const failedUserIds: string[] = []
  const unsubscribedUserIds: string[] = []

  for (const { digest, hashedId, unsubToken, tokenError } of prepared) {
    const matchCount = digest.matchIds.size
    const recordFailure = (reason: string) => {
      failedUserIds.push(digest.userId)
      logEvent(ae, 'email_reminder_failed', {
        blobs: [hashedId, day.date, reason],
        doubles: [matchCount],
      })
    }
    const recordSent = () => {
      pendingClaims.delete(digest.userId)
      sent++
      matchesListed += matchCount
      logEvent(ae, 'email_reminder_sent', {
        blobs: [hashedId, day.date],
        doubles: [matchCount, Math.min(digest.groups.length, MAX_DIGEST_GROUPS)],
      })
    }

    if (stopped) {
      recordFailure(stopped)
      continue
    }

    try {
      if (tokenError) throw tokenError
      const unsubUrl = unsubToken
        ? `${apiBaseUrl}/notifications/unsubscribe?token=${unsubToken}`
        : undefined

      const subject = reminderSubject(matchCount, digest.firstStart)
      // RFC 8058: Gmail e Apple Mail mostram o botão nativo de descadastro.
      const headers = unsubUrl
        ? {
            'List-Unsubscribe': `<${unsubUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : undefined

      const correlationId = reminderCorrelationId(digest.userId, day.date)
      const msg = {
        to: digest.email,
        subject,
        html: buildEmailHtml({ digest, subject, appUrl, unsubUrl }),
        text: buildEmailText({ digest, subject, appUrl, unsubUrl }),
        headers,
        idempotencyKey: correlationId,
      }
      const beforeAttempt = () => guard.assertSubscribed(digest.userId)

      const tryMailjet = async (): Promise<boolean> => {
        if (!mailjet) return false
        if (attempted.has(digest.userId)) return false
        attempted.add(digest.userId)
        const outcome = await sendViaMailjetOnce(
          mailjet,
          msg,
          correlationId,
          budget,
          beforeAttempt,
        )
        if (outcome === 'accepted') {
          recordSent()
          return true
        }
        // Timeout/5xx da Mailjet: mantém a reserva (sem idempotência, não reenvia).
        pendingClaims.delete(digest.userId)
        recordFailure('mailjet_uncertain')
        return true
      }

      // Cota do Resend já esgotou: destinatário sem tentativa anterior vai ao Mailjet.
      if (mailjet && resendUnavailable) {
        if (attempted.has(digest.userId)) {
          recordFailure('quota_exceeded')
          continue
        }
        const handled = await tryMailjet()
        if (!handled) recordFailure('quota_exceeded')
        continue
      }

      try {
        await sendWithRetry(resendApiKey, msg, budget, beforeAttempt)
        recordSent()
      } catch (err) {
        if (err instanceof UncertainResendError) {
          // Houve falha passageira antes: o Resend pode ter aceitado. Nunca Mailjet.
          attempted.add(digest.userId)
          const cause = err.cause
          if (
            cause instanceof UnsubscribedError ||
            cause instanceof SubrequestBudgetError ||
            cause instanceof UnsubCheckError
          ) {
            throw cause
          }
          throw err
        }
        if (
          err instanceof UnsubscribedError ||
          err instanceof SubrequestBudgetError ||
          err instanceof UnsubCheckError
        ) {
          throw err
        }

        // Timeout/5xx/rede/409: como na main (libera a reserva). Nunca Mailjet.
        if (!isDefinitiveResendRefusal(err)) {
          attempted.add(digest.userId)
          throw err
        }

        // Só chega aqui com recusa definitiva na 1ª tentativa (sem passageiro antes).
        if (marksResendUnavailable(err)) resendUnavailable = true

        if (!mailjet || attempted.has(digest.userId)) throw err

        const handled = await tryMailjet()
        if (!handled) throw err
      }
    } catch (err) {
      if (err instanceof UnsubscribedError) {
        unsubscribedUserIds.push(digest.userId)
      } else {
        recordFailure(failureReason(err))
        stopped = stopReason(err, Boolean(mailjet))
        if (err instanceof MailjetError) {
          console.error(
            `[roundReminder] Falha ao enviar para ${hashedId}: Mailjet status=${err.status}`,
          )
        } else {
          console.error(`[roundReminder] Falha ao enviar para ${hashedId}:`, err)
        }
      }
    } finally {
      guard.done(digest.userId)
    }
  }

  return { sent, matchesListed, failedUserIds, unsubscribedUserIds }
}

type PilotAccess = Pick<Env, 'ADMIN_EMAIL' | 'ADMIN_GOOGLE_SUB' | 'PILOT_EMAILS'>

export type ReminderOptions = {
  /** Teto de `fetch` da execução. Padrão `RESEND_FETCH_BUDGET`. */
  fetchBudget?: number
  /** Quem vê competição em piloto. Sem ele, grupo de competição em piloto não gera lembrete. */
  pilotAccess?: PilotAccess
  /**
   * Fallback Mailjet. Sem as duas credenciais o cron se comporta como na main:
   * só Resend, falha libera a reserva, sem desvio.
   */
  mailjet?: MailjetCredentials
}

/**
 * Envia, uma vez por dia (07:00 em Brasília), um e-mail a cada usuário com jogo
 * de hoje ainda aberto e sem palpite. O e-mail lista só esses jogos, por grupo e
 * rodada. Quem palpitou todos os jogos do dia ou cancelou os lembretes não recebe.
 * Vale no máximo um e-mail por usuário por dia (`email_reminder_sends`, ADR-020).
 *
 * Com `mailjet`, recusa definitiva do Resend na 1ª tentativa (4xx/cota/401/403,
 * sem passageiro antes) desvia ao Mailjet uma vez, só para quem ainda não teve
 * tentativa nesta execução. Timeout, 5xx, rede, 409 e falha após passageiro
 * nunca caem no fallback. Sem credenciais, o comportamento é o da main.
 *
 * `nowMs` existe para os testes fixarem o dia.
 */
export async function sendRoundReminders(
  db: D1Database,
  resendApiKey: string,
  ae?: AnalyticsEngineDataset,
  appUrl: string = APP_URL,
  unsub?: UnsubConfig,
  nowMs: number = Date.now(),
  { fetchBudget, pilotAccess = {}, mailjet }: ReminderOptions = {},
): Promise<void> {
  const startedAt = Date.now()

  // Sem chave, todo envio voltaria 401 e seria contado como lembrete perdido.
  // Melhor pular a execução e expor o erro de configuração.
  if (!resendApiKey.trim()) {
    console.error('[roundReminder] RESEND_API_KEY ausente: nenhum lembrete enviado.')
    logEvent(ae, 'cron_round_reminder_misconfig', { blobs: ['no_api_key'] })
    return
  }

  const day = reminderDay(nowMs)
  const { results } = await db
    .prepare(PENDING_MATCHES_SQL)
    .bind(...pendingMatchesBinds(isoSeconds(new Date(nowMs)), day))
    .all<PendingRow>()
  const digests = buildDigests(withPilotAccess(results, pilotAccess))

  if (digests.length === 0) {
    console.info('[roundReminder] Nenhum jogo sem palpite hoje.')
    logEvent(ae, 'cron_round_reminder', { doubles: [0, 0, 0, 0] })
    return
  }

  // Antes do batch: a latência da gravação conta no prazo da leitura de descadastro.
  const claimStartedAt = Date.now()
  const claimed = await claimRecipients(
    db,
    digests.map((digest) => digest.userId),
    day,
  )
  // A partir da reserva, toda saída passa pela liberação. Só o aceite do provedor
  // retira um usuário deste conjunto, antes de qualquer log ou outra operação.
  let recipients: Digest[] = []
  let result: DispatchResult
  try {
    recipients = digests.filter((digest) => claimed.has(digest.userId)).sort(byQueueOrder)
    const apiBaseUrl = unsub?.apiBaseUrl ? unsub.apiBaseUrl.replace(/\/+$/, '') : undefined
    result = await dispatchDigests(recipients, {
      db,
      resendApiKey,
      appUrl,
      apiBaseUrl,
      unsub,
      ae,
      day,
      fetchBudget,
      pendingClaims: claimed,
      claimStartedAt,
      mailjet,
    })
  } finally {
    await releaseClaims(db, [...claimed], day)
  }
  const { sent, matchesListed, failedUserIds, unsubscribedUserIds } = result

  const failed = failedUserIds.length
  const rounds = countRounds(recipients)
  logEvent(ae, 'cron_round_reminder', { doubles: [rounds, sent, failed, matchesListed] })

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron sendRoundReminders',
      rounds,
      sent,
      failed,
      matches_listed: matchesListed,
      already_claimed: digests.length - recipients.length,
      unsubscribed_during_run: unsubscribedUserIds.length,
      total_ms: Date.now() - startedAt,
    }),
  )
}

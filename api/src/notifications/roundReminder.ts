import type { AnalyticsEngineDataset, D1Database } from '@cloudflare/workers-types'
import { lockedSql } from '../matches/locking'
import { roundLabel } from '../matches/rounds'
import { isoSeconds } from '../matches/sync'
import { hashUserId, logEvent } from '../observability/events'
import { EmailError, sendEmail } from './email'
import { signUnsubToken } from './unsubscribeToken'

const APP_URL = 'https://palpitae.com.br'

// Brasília é UTC-3, sem horário de verão desde 2019.
const BRT_OFFSET_MS = 3 * 60 * 60 * 1000
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
// segurança do `scheduled`) e deixa 1 de folga. Sobram 45 subrequests para os `fetch`
// ao Resend, contando cada reenvio, e para as revalidações de descadastro.
const SUBREQUEST_LIMIT = 50
const D1_SUBREQUESTS = 4
const SUBREQUEST_MARGIN = 1
export const RESEND_FETCH_BUDGET = SUBREQUEST_LIMIT - D1_SUBREQUESTS - SUBREQUEST_MARGIN

// Por quanto tempo a última leitura de descadastro vale durante o lote. A reserva lê
// a preferência, e uma tentativa de envio que começa depois desse prazo relê antes de
// chamar o Resend. Um lote sem pausa termina dentro do prazo e não gasta subrequest
// extra. Reler antes de cada envio custaria um subrequest por destinatário e cortaria
// pela metade quem cabe no teto.
const UNSUB_RECHECK_MS = 5_000

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
 * envio.
 */
class UnsubGuard {
  private readonly subscribed: Set<string>
  private checkedAt: number

  constructor(
    private readonly db: D1Database,
    userIds: string[],
    private readonly budget: FetchBudget,
  ) {
    // A reserva acabou de ler a preferência de todos.
    this.subscribed = new Set(userIds)
    this.checkedAt = Date.now()
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
    if (this.budget.max - this.budget.used < 2) throw new SubrequestBudgetError()
    this.budget.used++
    let rows: { id: string }[]
    try {
      const result = await this.db
        .prepare(
          `SELECT id FROM users
           WHERE id IN (SELECT value FROM json_each(?)) AND email_unsubscribed_at IS NULL`,
        )
        .bind(JSON.stringify([...this.subscribed]))
        .all<{ id: string }>()
      rows = result.results
    } catch (err) {
      throw new UnsubCheckError(err)
    }
    const still = new Set(rows.map((row) => row.id))
    for (const id of this.subscribed) if (!still.has(id)) this.subscribed.delete(id)
    this.checkedAt = Date.now()
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Envia um e-mail, repetindo em 429 de limite por segundo e em 5xx ou erro de rede,
 * com espera exponencial que respeita o Retry-After do Resend. Cota esgotada e
 * outros 4xx falham na primeira tentativa. Cada tentativa gasta o saldo de `fetch` da
 * execução, e sem saldo lança `SubrequestBudgetError`. Lança o erro quando as tentativas acabam,
 * e quem chama contabiliza a falha e segue.
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
  for (let attempt = 1; ; attempt++) {
    // Cada tentativa é um `fetch`. Sem saldo, para antes de chamar a rede.
    if (budget.used >= budget.max) throw new SubrequestBudgetError()
    await beforeAttempt()
    budget.used++
    try {
      await sendEmail(apiKey, msg)
      return
    } catch (err) {
      const emailError = err instanceof EmailError ? err : undefined
      const status = emailError?.status ?? 0
      const transient = !emailError?.quotaExceeded && (status === 429 || status >= 500 || status === 0)
      if (!transient || attempt >= MAX_SEND_ATTEMPTS) throw err
      if (budget.used >= budget.max) throw new SubrequestBudgetError()
      await sleep(emailError?.retryAfterMs ?? 500 * 2 ** (attempt - 1))
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
  group_id: string
  group_name: string
  competition_id: string
  competition_name: string
  match_id: string
  round: string | null
  start_time: string
  home_team: string
  away_team: string
  home_logo: string | null
  away_logo: string | null
}

type DigestMatch = {
  home: string
  away: string
  homeLogo: string | null
  awayLogo: string | null
  startTime: string
}

type DigestRound = {
  competitionId: string
  round: string | null
  matches: DigestMatch[]
}

type DigestGroup = {
  groupId: string
  groupName: string
  competitionName: string
  rounds: DigestRound[]
}

/** E-mail de um usuário com os jogos sem palpite do dia, por grupo e rodada. */
type Digest = {
  userId: string
  email: string
  groups: DigestGroup[]
  /** Jogos distintos. O mesmo jogo sem palpite em dois grupos conta uma vez. */
  matchIds: Set<string>
  firstStart: string
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
 * Os `CROSS JOIN` fixam a ordem. A consulta parte dos jogos do dia pelo índice de
 * `start_time`, e cada junção seguinte é uma busca por chave. Binds em
 * `pendingMatchesBinds`.
 */
export const PENDING_MATCHES_SQL = `SELECT
         u.id         AS user_id,
         u.email      AS email,
         g.id         AS group_id,
         g.name       AS group_name,
         c.id         AS competition_id,
         c.name       AS competition_name,
         m.id         AS match_id,
         m.round      AS round,
         m.start_time AS start_time,
         ht.name      AS home_team,
         awt.name     AS away_team,
         ht.logo_url  AS home_logo,
         awt.logo_url AS away_logo
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

function reminderDay(nowMs: number): ReminderDay {
  const date = new Date(nowMs - BRT_OFFSET_MS).toISOString().slice(0, 10)
  const dayMs = Date.parse(`${date}T00:00:00Z`)
  return {
    date,
    endIso: isoSeconds(new Date(dayMs + DAY_MS + BRT_OFFSET_MS)),
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
  const digests = new Map<string, Digest>()
  for (const row of rows) {
    let digest = digests.get(row.user_id)
    if (!digest) {
      digest = {
        userId: row.user_id,
        email: row.email,
        groups: [],
        matchIds: new Set(),
        firstStart: row.start_time,
      }
      digests.set(row.user_id, digest)
    }

    let group = digest.groups.find((g) => g.groupId === row.group_id)
    if (!group) {
      group = {
        groupId: row.group_id,
        groupName: row.group_name,
        competitionName: row.competition_name,
        rounds: [],
      }
      digest.groups.push(group)
    }

    let round = group.rounds.find((r) => r.round === row.round)
    if (!round) {
      round = { competitionId: row.competition_id, round: row.round, matches: [] }
      group.rounds.push(round)
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
  return [...digests.values()]
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
 * 50 por invocação. A consequência é que uma invocação interrompida no meio deixa
 * os restantes sem e-mail naquele dia. Perder um aviso é melhor do que repetir.
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
    db.prepare('DELETE FROM email_reminder_sends WHERE reminder_date < ?').bind(day.retentionCutoff),
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
 * possa enviar. Uma falha aqui só vai para o log, porque o envio do dia já terminou.
 */
async function releaseClaims(db: D1Database, userIds: string[], day: ReminderDay): Promise<void> {
  if (userIds.length === 0) return
  try {
    await db
      .prepare(
        `DELETE FROM email_reminder_sends
         WHERE reminder_date = ? AND user_id IN (SELECT value FROM json_each(?))`,
      )
      .bind(day.date, JSON.stringify(userIds))
      .run()
  } catch (err) {
    console.error('[roundReminder] Falha ao liberar envios não concluídos:', err)
  }
}

function failureReason(err: unknown): string {
  if (err instanceof SubrequestBudgetError) return 'subrequest_budget'
  if (err instanceof UnsubCheckError) return 'unsub_check_failed'
  if (!(err instanceof EmailError)) return 'unknown'
  return err.quotaExceeded ? 'quota_exceeded' : `http_${err.status}`
}

/**
 * Motivo que encerra a fila: toda tentativa seguinte falharia, ou sairia sem a
 * leitura de descadastro. `null` deixa a fila seguir.
 */
function stopReason(err: unknown): string | null {
  if (err instanceof EmailError && err.quotaExceeded) return 'quota_exceeded'
  if (err instanceof SubrequestBudgetError || err instanceof UnsubCheckError) {
    return failureReason(err)
  }
  return null
}

type DispatchOptions = {
  db: D1Database
  resendApiKey: string
  appUrl: string
  apiBaseUrl: string | undefined
  unsub: UnsubConfig | undefined
  ae: AnalyticsEngineDataset | undefined
  day: ReminderDay
  /** Saldo de `fetch` ao Resend e revalidações. Os testes reduzem para exercitar o teto. */
  fetchBudget?: number
}

type DispatchResult = {
  sent: number
  matchesListed: number
  failedUserIds: string[]
  /** Descadastraram depois da reserva e não receberam. */
  unsubscribedUserIds: string[]
}

/**
 * Envia um e-mail por usuário, sem endereço compartilhado. Uma falha não derruba
 * os demais. Cota esgotada, teto de subrequests ou falha na leitura de descadastro
 * encerram a fila. Quem fica de fora volta em `failedUserIds`, e quem descadastrou
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
  }: DispatchOptions,
): Promise<DispatchResult> {
  // Criado logo depois da reserva, que leu o descadastro de todos.
  const budget: FetchBudget = { used: 0, max: fetchBudget }
  const guard = new UnsubGuard(
    db,
    digests.map((digest) => digest.userId),
    budget,
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

      await sendWithRetry(
        resendApiKey,
        {
          to: digest.email,
          subject,
          html: buildEmailHtml({ digest, subject, appUrl, unsubUrl }),
          text: buildEmailText({ digest, subject, appUrl, unsubUrl }),
          headers,
          // Se a resposta se perder, a nova tentativa não gera um segundo e-mail.
          idempotencyKey: `lembrete-diario/${digest.userId}/${day.date}`,
        },
        budget,
        () => guard.assertSubscribed(digest.userId),
      )
      sent++
      matchesListed += matchCount
      // user_hash do id, nunca o e-mail cru (regra LGPD).
      logEvent(ae, 'email_reminder_sent', {
        blobs: [hashedId, day.date],
        doubles: [matchCount, digest.groups.length],
      })
    } catch (err) {
      if (err instanceof UnsubscribedError) {
        unsubscribedUserIds.push(digest.userId)
      } else {
        recordFailure(failureReason(err))
        stopped = stopReason(err)
        console.error(`[roundReminder] Falha ao enviar para ${hashedId}:`, err)
      }
    } finally {
      guard.done(digest.userId)
    }
  }

  return { sent, matchesListed, failedUserIds, unsubscribedUserIds }
}

/**
 * Envia, uma vez por dia (07:00 em Brasília), um e-mail a cada usuário com jogo
 * de hoje ainda aberto e sem palpite. O e-mail lista só esses jogos, por grupo e
 * rodada. Quem palpitou todos os jogos do dia ou cancelou os lembretes não recebe.
 * Vale no máximo um e-mail por usuário por dia (`email_reminder_sends`, ADR-020).
 *
 * `nowMs` e `fetchBudget` existem para os testes fixarem o dia e o saldo.
 */
export async function sendRoundReminders(
  db: D1Database,
  resendApiKey: string,
  ae?: AnalyticsEngineDataset,
  appUrl: string = APP_URL,
  unsub?: UnsubConfig,
  nowMs: number = Date.now(),
  fetchBudget?: number,
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
  const digests = buildDigests(results)

  if (digests.length === 0) {
    console.info('[roundReminder] Nenhum jogo sem palpite hoje.')
    logEvent(ae, 'cron_round_reminder', { doubles: [0, 0, 0, 0] })
    return
  }

  const claimed = await claimRecipients(
    db,
    digests.map((digest) => digest.userId),
    day,
  )
  const recipients = digests.filter((digest) => claimed.has(digest.userId))

  // Sem apiBaseUrl o e-mail sai sem o link, e o `.replace` não quebra o lote.
  const apiBaseUrl = unsub?.apiBaseUrl ? unsub.apiBaseUrl.replace(/\/+$/, '') : undefined

  const { sent, matchesListed, failedUserIds, unsubscribedUserIds } = await dispatchDigests(
    recipients,
    { db, resendApiKey, appUrl, apiBaseUrl, unsub, ae, day, fetchBudget },
  )
  // Quem descadastrou no meio do lote também devolve a reserva. A consulta dos
  // pendentes já não o traz, e se ele reativar no mesmo dia uma nova execução envia.
  await releaseClaims(db, [...failedUserIds, ...unsubscribedUserIds], day)

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

// Um formatter por módulo. O cron formata por jogo e por destinatário.
const TIME_BRT_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
})

/** Horário do jogo em Brasília, "19:30". O palpite fecha nesse horário (ADR-004). */
export function formatTimeBRT(isoUtc: string): string {
  return TIME_BRT_FORMAT.format(new Date(isoUtc))
}

function reminderSubject(matchCount: number, firstStart: string): string {
  const time = formatTimeBRT(firstStart)
  return matchCount === 1
    ? `1 jogo sem palpite hoje. Fecha às ${time}`
    : `${matchCount} jogos sem palpite hoje. O primeiro fecha às ${time}`
}

/**
 * Link da aba Palpitar na rodada dos jogos listados. A rodada vai explícita porque
 * o jogo remarcado de rodada antiga nunca está na rodada padrão do grupo (ADR-019).
 */
function predictionsUrl(appUrl: string, groupId: string, round: string | null): string {
  const query = round ? `?rodada=${encodeURIComponent(round)}` : ''
  return `${appUrl}/grupos/${groupId}${query}`
}

/**
 * Escapa os cinco caracteres com significado em HTML. Nomes de grupo, rodada e time
 * vêm do banco e podem ter `"`, `'` ou `&`. O nome do grupo é escrito pelo usuário.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Escudo do time em <img>. Sem logo, devolve string vazia.
 *
 * Muitos escudos do football-data.org são SVG, que Gmail e Outlook não renderizam
 * e trocam pelo `alt`. O nome do time aparece ao lado, então o layout não quebra.
 */
function crestImg(url: string | null, alt: string): string {
  if (!url || !/^https?:\/\//i.test(url)) return ''
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="20" height="20" style="vertical-align: middle; border: 0;">`
}

interface EmailTemplateOptions {
  digest: Digest
  subject: string
  appUrl: string
  unsubUrl?: string
}

/**
 * Cada jogo ocupa duas linhas. A primeira tem "escudo mandante x visitante escudo" em
 * colunas de largura fixa. A segunda tem o horário, centralizado igual em todos os blocos.
 * O escudo e o nome ficam num `span` sem quebra, então nunca se separam.
 */
function matchRowHtml(match: DigestMatch): string {
  const nowrap = 'white-space: nowrap;'
  return `
      <tr>
        <td style="width: 45%; padding: 8px 4px 0; text-align: right; font-weight: bold;"><span style="${nowrap}">${escapeHtml(match.home)}&nbsp;${crestImg(match.homeLogo, match.home)}</span></td>
        <td style="width: 10%; padding: 8px 4px 0; text-align: center; color: #6b7280;">x</td>
        <td style="width: 45%; padding: 8px 4px 0; text-align: left; font-weight: bold;"><span style="${nowrap}">${crestImg(match.awayLogo, match.away)}&nbsp;${escapeHtml(match.away)}</span></td>
      </tr>
      <tr>
        <td colspan="3" style="padding: 2px 4px 8px; text-align: center; color: #6b7280; font-size: 13px;">fecha ${escapeHtml(formatTimeBRT(match.startTime))}</td>
      </tr>`
}

function groupBlockHtml(group: DigestGroup, appUrl: string): string {
  // Link de texto simples, sem botão colorido nem UTM. E-mail que parece mensagem
  // pessoal tem menos chance de cair na aba Promoções do Gmail.
  const rounds = group.rounds
    .map((round) => {
      const url = predictionsUrl(appUrl, group.groupId, round.round)
      return `
    <p style="margin: 8px 0 0; color: #6b7280;">${escapeHtml(roundLabel(round.round ?? ''))}</p>
    <table style="width: 100%; table-layout: fixed; border-collapse: collapse; margin: 8px 0;">${round.matches.map(matchRowHtml).join('')}</table>
    <p style="margin: 4px 0 0;"><a href="${escapeHtml(url)}" style="color: #16a34a; font-weight: bold;">Fazer meus palpites &rarr;</a></p>`
    })
    .join('')

  return `
    <h3 style="margin: 24px 0 0; font-size: 16px;">${escapeHtml(group.groupName)}</h3>
    <p style="margin: 2px 0 0; color: #6b7280;">${escapeHtml(group.competitionName)}</p>${rounds}`
}

function buildEmailHtml({ digest, subject, appUrl, unsubUrl }: EmailTemplateOptions): string {
  const groups = digest.groups.map((group) => groupBlockHtml(group, appUrl)).join('')

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background: #f3f4f6;">
  <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
    <div style="padding: 8px 0 16px;">
      <span style="font-size: 20px; font-weight: 700; color: #111827; letter-spacing: -0.5px;">Palpitae</span>
    </div>
    <h2 style="margin: 0 0 4px;">${escapeHtml(subject)}</h2>
    <p style="color: #6b7280; margin-top: 0;">Cada palpite fecha no horário do jogo.</p>${groups}
    <p style="color: #6b7280; font-size: 12px; margin-top: 32px;">
      Você está recebendo este e-mail porque participa de um grupo no Palpitae.${
        unsubUrl
          ? `<br>Não quer mais estes lembretes? <a href="${escapeHtml(unsubUrl)}" style="color: #6b7280;">Cancelar inscrição</a>.`
          : ''
      }
    </p>
  </div>
</body>
</html>`
}

/** Versão em texto puro, para clientes que preferem text/plain. */
function buildEmailText({ digest, subject, appUrl, unsubUrl }: EmailTemplateOptions): string {
  const lines = [subject, 'Cada palpite fecha no horário do jogo.']
  for (const group of digest.groups) {
    lines.push('', group.groupName, group.competitionName)
    for (const round of group.rounds) {
      lines.push(roundLabel(round.round ?? ''))
      for (const match of round.matches) {
        lines.push(`${match.home} vs ${match.away}, fecha ${formatTimeBRT(match.startTime)}`)
      }
      lines.push(`Fazer meus palpites: ${predictionsUrl(appUrl, group.groupId, round.round)}`)
    }
  }
  lines.push('', 'Você está recebendo este e-mail porque participa de um grupo no Palpitae.')
  if (unsubUrl) lines.push(`Cancelar inscrição: ${unsubUrl}`)
  return lines.join('\n')
}

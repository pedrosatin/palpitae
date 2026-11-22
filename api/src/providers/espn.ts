
import { notifyHttpAttempt, type ProviderHttpObserver } from '../observability/providerHttp'

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer'

/** Timeout por tentativa — o sync diário não pode travar num slug morto. */
export const ESPN_TIMEOUT_MS = 10_000

/** Backoff do único retry (429/5xx) — a ESPN não cobra, então basta ser curto. */
export const ESPN_RETRY_BACKOFF_MS = 500

/**
 * Intervalo mínimo entre o início de duas requests ao scoreboard público.
 * Rajadas devolvem 403 Akamai; ~1,3s serializado é o ritmo seguro observado.
 */
export const ESPN_MIN_INTERVAL_MS = 1_300

let espnGate: Promise<void> = Promise.resolve()

let lastEspnRequestStartedAt = 0

const DEFAULT_MIN_INTERVAL_MS =
  typeof process !== 'undefined' && process.env.VITEST ? 0 : ESPN_MIN_INTERVAL_MS

let espnMinIntervalMs = DEFAULT_MIN_INTERVAL_MS

let espnTimeoutMs = ESPN_TIMEOUT_MS

/**
 * Reinicia a fila, o relógio, o intervalo e o timeout. Só para testes; o Worker
 * real mantém o estado pelo tempo de vida do isolate.
 */
export function resetEspnClientForTests(): void {
  espnGate = Promise.resolve()
  lastEspnRequestStartedAt = 0
  espnMinIntervalMs = DEFAULT_MIN_INTERVAL_MS
  espnTimeoutMs = ESPN_TIMEOUT_MS
}

/**
 * Ajusta só o delay de pacing nos testes. `0` preserva a serialização HTTP
 * sem esperar 1,3s entre dezenas de chamadas mockadas.
 */
export function setEspnMinIntervalForTests(ms: number): void {
  espnMinIntervalMs = Math.max(0, ms)
}

/** Ajusta o timeout por tentativa nos testes (ex.: abort com relógio real). */
export function setEspnTimeoutForTests(ms: number): void {
  espnTimeoutMs = Math.max(1, ms)
}

/**
 * Serializa `fn` no isolate (no máximo 1 HTTP ESPN em voo). O pacing por
 * tentativa fica em `awaitEspnRequestSlot` — assim o retry também espera.
 * Falhas não quebram a fila das próximas chamadas.
 */
function withEspnPace<T>(fn: () => Promise<T>): Promise<T> {
  const previous = espnGate
  let release!: () => void
  espnGate = new Promise<void>((resolve) => {
    release = resolve
  })

  return previous
    .catch(() => undefined)
    .then(() => fn())
    .finally(release)
}

/**
 * Espera o maior entre o intervalo mínimo desde o último início HTTP e
 * `minDelayMs` (backoff do retry), depois marca o início desta tentativa.
 * Não soma os dois quando o pacing já cobre o backoff.
 */
async function awaitEspnRequestSlot(minDelayMs = 0): Promise<void> {
  if (lastEspnRequestStartedAt > 0) {
    const elapsed = Date.now() - lastEspnRequestStartedAt
    // Relógio de teste pode voltar (fake timers): elapsed negativo não espera pacing.
    const pacingWait = elapsed < 0 ? 0 : Math.max(0, espnMinIntervalMs - elapsed)
    const wait = Math.max(minDelayMs, pacingWait)
    if (wait > 0) await delay(wait)
  } else if (minDelayMs > 0) {
    await delay(minDelayMs)
  }
  lastEspnRequestStartedAt = Date.now()
}

/**
 * A ESPN respondeu com status de erro. `status` deixa o chamador separar
 * rate limit, proibição de acesso e queda do provedor.
 */
export class EspnHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'EspnHttpError'
  }
}

/**
 * A ESPN não foi chamada, ou o acesso foi vedado, e o trabalho espera
 * `retryAt` (ms epoch): orçamento do minuto cheio (`window_full`), pausa por
 * 429 ou 403 (`blocked`) ou coleta suspensa porque a resposta proibiu o acesso
 * (`suspended`, só o operador retoma). Não é falha do sync: nenhuma tentativa
 * é gasta com ela.
 */
export class EspnUnavailableError extends Error {
  constructor(
    readonly reason: 'window_full' | 'blocked' | 'suspended',
    readonly retryAt: number,
    detail?: string,
  ) {
    super(
      detail ??
        `ESPN indisponível (${reason}): nova tentativa a partir de ${new Date(retryAt).toISOString()}`,
    )
    this.name = 'EspnUnavailableError'
  }
}

/** Resposta 200 sem o que o scoreboard sempre traz: não confirma nada. */
export class EspnIncompleteResponseError extends Error {
  constructor(slug: string) {
    super(`ESPN respondeu sem a lista de eventos em ${slug}: resposta incompleta`)
    this.name = 'EspnIncompleteResponseError'
  }
}

/** Bloqueio que uma resposta impôs ao provedor, para o cliente falhar com o prazo. */
export type EspnBlock = { reason: 'blocked' | 'suspended'; retryAt: number }

/**
 * Coordenação das tentativas pelo orçamento compartilhado (ADR-027). O cliente
 * não sabe de D1: o gate reserva a vaga antes de cada request (lança
 * `EspnUnavailableError` se negada) e registra a resposta depois. Sem gate o
 * cliente age como antes: o radar e os scripts locais seguem fora do orçamento.
 */
export type EspnGate = {
  reserve(): Promise<void>
  note(status: number, headers: Headers): Promise<EspnBlock | null>
}

export type EspnCompetitorTeam = {
  id?: string
  displayName?: string
  shortDisplayName?: string
  abbreviation?: string
  logo?: string
}

export type EspnCompetitor = {
  id?: string
  homeAway?: string
  winner?: boolean
  score?: string
  shootoutScore?: number
  team?: EspnCompetitorTeam
}

export type EspnCompetitionStatusType = {
  name?: string
  state?: string
  completed?: boolean
}

/**
 * Status que não contam como resultado final: adiado, cancelado, suspenso e
 * abandonado. Em 08/11/2026 a ESPN mandou Estoril × Marítimo, adiado, como
 * STATUS_POSTPONED com state 'post', completed false e placar 0-0. Só state
 * 'post' não indica fim de jogo.
 */
export const ESPN_POSTPONED_STATUSES = new Set([
  'STATUS_POSTPONED',
  'STATUS_CANCELED',
  'STATUS_CANCELLED',
  'STATUS_SUSPENDED',
  'STATUS_ABANDONED',
])

/** Fim de jogo: state 'post', completed true e status fora de ESPN_POSTPONED_STATUSES. */
export function isEspnFinal(type: EspnCompetitionStatusType | undefined): boolean {
  return (
    type?.state === 'post' &&
    type.completed === true &&
    !ESPN_POSTPONED_STATUSES.has(type.name ?? '')
  )
}

/**
 * Placar da ESPN como inteiro não negativo. Só aceita dígitos: "" e "3.0" viram
 * null (Number('') valeria 0 e gravaria um 0 × 0 que a ESPN nunca informou).
 */
export function parseNonNegativeInt(raw: string | undefined): number | null {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) return null
  return Number(raw)
}

export type EspnEventCompetition = {
  id?: string
  date?: string
  leg?: { value?: number } | null
  group?: { groupId?: string; name?: string; abbreviation?: string }
  status?: { type?: EspnCompetitionStatusType }
  competitors?: EspnCompetitor[]
}

/** Evento do scoreboard usado pelo radar e pelo sync de partidas. */
export type EspnScoreboardEvent = {
  id?: string
  date?: unknown
  season?: { year?: number; type?: number; slug?: string }
  week?: number | { number?: number }
  matchday?: number
  status?: { type?: EspnCompetitionStatusType }
  competitions?: EspnEventCompetition[]
}

/** Entrada de `leagues[]` — fatia que o radar usa (nome, logo, temporada). */
export type EspnScoreboardLeague = {
  name?: string
  logos?: { href?: string }[]
  season?: EspnSeason
}

/** Temporada reportada no próprio scoreboard. */
export type EspnSeason = { year?: number; startDate?: string; endDate?: string }

/** Resposta do scoreboard. */
export type EspnScoreboard = {
  events?: EspnScoreboardEvent[]
  leagues?: EspnScoreboardLeague[]
}

/**
 * Eventos do scoreboard, ou falha se a resposta não trouxe a lista. Ausência de
 * `events` não é "sem jogos": é resposta incompleta, e quem a tratasse como
 * lista vazia daria o sync por feito. Lista vazia continua válida (data sem
 * jogos), mas também não confirma resultado de nenhuma partida.
 */
export function requireScoreboardEvents(
  board: EspnScoreboard | null | undefined,
  slug: string,
): EspnScoreboardEvent[] {
  if (!board || !Array.isArray(board.events)) throw new EspnIncompleteResponseError(slug)
  return board.events
}

/** URL do scoreboard de uma liga, opcionalmente filtrada por data no formato YYYYMMDD. Exportada para testes. */
export function espnScoreboardUrl(slug: string, yyyymmdd?: string): string {
  if (yyyymmdd) {
    return `${SCOREBOARD_URL}/${slug}/scoreboard?dates=${yyyymmdd}`
  }
  return `${SCOREBOARD_URL}/${slug}/scoreboard`
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Scoreboard de uma liga na rodada corrente ou numa data `YYYYMMDD`. Serializa
 * as chamadas (mutex por isolate) e aplica `ESPN_MIN_INTERVAL_MS` entre o
 * início de cada tentativa HTTP — inclusive o único retry de 429/5xx, cujo
 * backoff de `ESPN_RETRY_BACKOFF_MS` é o piso quando o pacing já não cobre.
 * Erros 4xx (inclui 403 Akamai), timeout e falhas de rede abortam direto — o
 * chamador que consulta vários slugs já trata falha parcial, e retry em 403
 * viraria tempestade.
 *
 * `onAttempt` recebe provedor, status e duração de cada tentativa (status 0
 * sem resposta); nunca altera o resultado nem lança.
 *
 * Com `gate`, cada tentativa reserva vaga no orçamento compartilhado e a
 * resposta é registrada nele (ADR-027). Uma resposta que bloqueia o provedor
 * (429, 403, 401, 451) falha na hora com `EspnUnavailableError`, sem o retry.
 */
export async function fetchEspnScoreboard(
  slug: string,
  yyyymmdd?: string,
  onAttempt?: ProviderHttpObserver,
  gate?: EspnGate,
): Promise<EspnScoreboard> {
  return withEspnPace(async () => {
    let lastError: unknown = new Error(`ESPN: nenhuma tentativa feita para ${slug}`)

    for (let attempt = 0; attempt < 2; attempt++) {
      await awaitEspnRequestSlot(attempt > 0 ? ESPN_RETRY_BACKOFF_MS : 0)
      if (gate) await gate.reserve()

      const startedAt = Date.now()
      let res: Response
      try {
        res = await fetch(espnScoreboardUrl(slug, yyyymmdd), {
          signal: AbortSignal.timeout(espnTimeoutMs),
        })
      } catch (err) {
        notifyHttpAttempt(onAttempt, {
          provider: 'espn',
          status: 0,
          durationMs: Date.now() - startedAt,
        })
        throw err
      }
      notifyHttpAttempt(onAttempt, {
        provider: 'espn',
        status: res.status,
        durationMs: Date.now() - startedAt,
      })
      const block = gate ? await gate.note(res.status, res.headers) : null
      if (res.ok) return (await res.json()) as EspnScoreboard

      // Corpo junto: a mensagem de um 429/5xx é o que diferencia rate limit de
      // outage na hora de olhar o log do Actions.
      const body = (await res.text().catch(() => '')).slice(0, 200)
      const message = `ESPN respondeu ${res.status} em ${slug}: ${body}`
      if (block) throw new EspnUnavailableError(block.reason, block.retryAt, message)
      lastError = new EspnHttpError(res.status, message)
      if (!isRetryable(res.status)) throw lastError
    }

    throw lastError
  })
}

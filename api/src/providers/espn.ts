/**
 * Cliente da API pública da ESPN (site.api.espn.com) — sem chave, sem quota
 * conhecida, estável há anos. Não é uma API documentada/oficial: é a que
 * alimenta o site da ESPN, e por isso cada consumidor deve tratar respostas
 * malformadas como erro (ver ADR-015).
 *
 * Compartilhado entre o radar em `api/src/radar/` e o sync primário de copas da
 * ESPN em `api/src/matches/espnSync.ts`.
 *
 * A ESPN exige o parâmetro `dates=YYYYMMDD` no plural. O parâmetro `date=` no
 * singular é ignorado e devolve a rodada corrente. Para uma data sem jogos a
 * ESPN devolve a rodada vizinha, e para uma liga fora de temporada devolve os
 * últimos jogos. Quem conta "jogos do dia" tem que filtrar pelo campo `date` de
 * cada evento.
 */

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

/** Cadeia que serializa todas as chamadas `fetchEspnScoreboard` do isolate. */
let espnGate: Promise<void> = Promise.resolve()

/** Timestamp do último início de request (0 = nenhuma ainda neste isolate). */
let lastEspnRequestStartedAt = 0

/** Em Vitest o delay parte de 0 (exclusão mútua permanece); o Worker usa 1,3s. */
const DEFAULT_MIN_INTERVAL_MS =
  typeof process !== 'undefined' && process.env.VITEST ? 0 : ESPN_MIN_INTERVAL_MS

/** Intervalo efetivo; testes de pacing restauram `ESPN_MIN_INTERVAL_MS`. */
let espnMinIntervalMs = DEFAULT_MIN_INTERVAL_MS

/** Timeout efetivo por tentativa; testes de abort podem encurtar. */
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
 * Executa `fn` com exclusão mútua e intervalo mínimo desde o último início.
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
    .then(async () => {
      if (lastEspnRequestStartedAt > 0) {
        const elapsed = Date.now() - lastEspnRequestStartedAt
        // Relógio de teste pode voltar (fake timers): elapsed negativo não espera.
        const wait = elapsed < 0 ? 0 : Math.max(0, espnMinIntervalMs - elapsed)
        if (wait > 0) await delay(wait)
      }
      lastEspnRequestStartedAt = Date.now()
      return fn()
    })
    .finally(release)
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
  /** Rodada numérica em algumas ligas; Série B costuma omitir. */
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

/** URL do scoreboard de uma liga, opcionalmente filtrada por data no formato YYYYMMDD. Exportada para testes. */
export function espnScoreboardUrl(slug: string, yyyymmdd?: string): string {
  if (yyyymmdd) {
    return `${SCOREBOARD_URL}/${slug}/scoreboard?dates=${yyyymmdd}`
  }
  return `${SCOREBOARD_URL}/${slug}/scoreboard`
}

/** Status que vale uma segunda tentativa: rate limit e erros de servidor. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Scoreboard de uma liga na rodada corrente ou numa data `YYYYMMDD`. Serializa
 * as chamadas com `ESPN_MIN_INTERVAL_MS` entre inícios. Aplica 1 retry com
 * backoff em 429 e 5xx (dentro do mesmo slot). Erros 4xx (inclui 403 Akamai),
 * timeout e falhas de rede abortam direto — o chamador que consulta vários
 * slugs já trata falha parcial, e retry em 403 viraria tempestade.
 */
export async function fetchEspnScoreboard(
  slug: string,
  yyyymmdd?: string,
): Promise<EspnScoreboard> {
  return withEspnPace(async () => {
    let lastError: unknown = new Error(`ESPN: nenhuma tentativa feita para ${slug}`)

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await delay(ESPN_RETRY_BACKOFF_MS)

      const res = await fetch(espnScoreboardUrl(slug, yyyymmdd), {
        signal: AbortSignal.timeout(espnTimeoutMs),
      })
      if (res.ok) return (await res.json()) as EspnScoreboard

      // Corpo junto: a mensagem de um 429/5xx é o que diferencia rate limit de
      // outage na hora de olhar o log do Actions.
      const body = (await res.text().catch(() => '')).slice(0, 200)
      lastError = new Error(`ESPN respondeu ${res.status} em ${slug}: ${body}`)
      if (!isRetryable(res.status)) throw lastError
    }

    throw lastError
  })
}

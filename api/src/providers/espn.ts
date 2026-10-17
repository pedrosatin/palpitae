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
const TIMEOUT_MS = 10_000

/** Backoff do único retry (429/5xx) — a ESPN não cobra, então basta ser curto. */
const RETRY_BACKOFF_MS = 500

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
  group?: { groupId?: string; name?: string; abbreviation?: string }
  status?: { type?: EspnCompetitionStatusType }
  competitors?: EspnCompetitor[]
}

/** Evento do scoreboard usado pelo radar e pelo sync de partidas. */
export type EspnScoreboardEvent = {
  id?: string
  date?: unknown
  season?: { year?: number; type?: number; slug?: string }
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
 * Scoreboard de uma liga na rodada corrente ou numa data `YYYYMMDD`. Aplica 1
 * retry com backoff em 429 e 5xx. Erros 4xx, timeout e falhas de rede abortam
 * direto, pois o chamador que consulta vários slugs já trata falha parcial.
 */
export async function fetchEspnScoreboard(
  slug: string,
  yyyymmdd?: string,
): Promise<EspnScoreboard> {
  let lastError: unknown = new Error(`ESPN: nenhuma tentativa feita para ${slug}`)

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await delay(RETRY_BACKOFF_MS)

    const res = await fetch(espnScoreboardUrl(slug, yyyymmdd), {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.ok) return (await res.json()) as EspnScoreboard

    // Corpo junto: a mensagem de um 429/5xx é o que diferencia rate limit de
    // outage na hora de olhar o log do Actions.
    const body = (await res.text().catch(() => '')).slice(0, 200)
    lastError = new Error(`ESPN respondeu ${res.status} em ${slug}: ${body}`)
    if (!isRetryable(res.status)) throw lastError
  }

  throw lastError
}

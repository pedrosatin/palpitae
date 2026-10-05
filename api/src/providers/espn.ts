/**
 * Cliente da API pública da ESPN (site.api.espn.com) — sem chave, sem quota
 * conhecida, estável há anos. Não é uma API documentada/oficial: é a que
 * alimenta o site da ESPN, e por isso cada consumidor deve tratar respostas
 * malformadas como erro (ver ADR-015).
 *
 * Compartilhado entre o radar (api/src/radar/) e futuros consumidores. O tipo
 * devolvido é o mínimo que o radar precisa — `events` como lista de objetos
 * opacos (o radar só conta os do dia via `date`) e `leagues[0]` com o nome, o
 * logo e a temporada. Quem precisar de detalhes de jogo tipa depois.
 *
 * Nota importante sobre o parâmetro `date`: a ESPN não filtra estritamente —
 * para uma data sem jogos devolve a rodada vizinha, e para uma liga fora de
 * temporada devolve os últimos jogos. Quem conta "jogos do dia" tem que
 * filtrar pelo campo `date` de cada evento.
 */

const SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/soccer'

/** Timeout por tentativa — o sync diário não pode travar num slug morto. */
const TIMEOUT_MS = 10_000

/** Backoff do único retry (429/5xx) — a ESPN não cobra, então basta ser curto. */
const RETRY_BACKOFF_MS = 500

/** Evento do scoreboard. `date` (ISO 8601 UTC) é tudo que o radar lê. */
export type EspnScoreboardEvent = { date?: unknown }

/** Entrada de `leagues[]` — fatia que o radar usa (nome, logo, temporada). */
export type EspnScoreboardLeague = {
  name?: string
  logos?: { href?: string }[]
  season?: EspnSeason
}

/** Temporada reportada no próprio scoreboard. */
export type EspnSeason = { year?: number; startDate?: string; endDate?: string }

/** Resposta do scoreboard — fatia mínima que o radar usa. */
export type EspnScoreboard = {
  events?: EspnScoreboardEvent[]
  leagues?: EspnScoreboardLeague[]
}

/** URL do scoreboard de uma liga numa data (YYYYMMDD). Exportada para testes. */
export function espnScoreboardUrl(slug: string, yyyymmdd: string): string {
  return `${SCOREBOARD_URL}/${slug}/scoreboard?date=${yyyymmdd}`
}

/** Status que vale uma segunda tentativa: rate limit e erros de servidor. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Scoreboard de uma liga numa data. 1 retry com backoff em 429/5xx; o resto
 * (4xx, timeout, rede) falha direto — quem orquestra vários slugs já lida com
 * falha parcial.
 */
export async function fetchEspnScoreboard(slug: string, yyyymmdd: string): Promise<EspnScoreboard> {
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

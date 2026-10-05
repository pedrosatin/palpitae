/**
 * Recorte ESPN para o radar de competições — a lista curada de slugs que
 * substitui o catálogo `/leagues?current=true` da API-Football (conta
 * suspensa, ver ADR-015).
 *
 * A ESPN não tem um catálogo utilizável em runtime (só um índice paginado de
 * ~219 slugs, `sports.core.api.espn.com`, sem metadados de temporada), então
 * o "catálogo" aqui é uma lista estática: 1 chamada de scoreboard por slug.
 * Cada resposta já traz a temporada corrente (`leagues[0].season`), então não
 * existe chamada de catálogo — só os ~35 scoreboards do recorte.
 *
 * Os nomes/países são NOSSOS, não os da ESPN: a ESPN chama bra.1 de
 * "Brazilian Serie A" e esp.1 de "Spanish La Liga", e o radar casa a
 * competição com a curadoria de artigos por `(país, nome)` normalizado
 * (`findEntry` em articles.ts). O nome da lista é escolhido para casar.
 */

import { fetchEspnScoreboard, type EspnScoreboard, type EspnSeason } from '../providers/espn'

/** Liga como o sync do radar consome — formato independente de provider. */
export type ProviderLeague = {
  externalId: string
  name: string
  country: string
  type: string | null
  logoUrl: string | null
  season: string
  startsOn: string | null
  endsOn: string | null
}

/** Slug ESPN + como ele entra no radar (nome/país que casam com a curadoria). */
export type EspnLeagueRef = {
  slug: string
  name: string
  country: string
  type: 'League' | 'Cup'
}

/**
 * Recorte curado. Nome e país casam com `RADAR_ENTRIES` (articles.ts) via
 * `findEntry` quando a competição tem artigo mapeado; o resto é país do
 * recorte (`RADAR_COUNTRIES`) e entra como candidata sem sinal de interesse.
 *
 * Lacunas conhecidas da ESPN (aceitas, ver ADR-015): Série C, Baiano,
 * Pernambucano, Paranaense, Copa do Nordeste e Brasileirão Feminino não têm
 * slug. Para conferir/aumentar esta lista, o catálogo completo (~219 slugs)
 * está em `__fixtures__/espn-catalog.txt` — comando de refresh na ADR-015.
 */
export const ESPN_LEAGUES: EspnLeagueRef[] = [
  // Brasil — clubes
  { slug: 'bra.1', name: 'Serie A', country: 'Brazil', type: 'League' },
  { slug: 'bra.2', name: 'Serie B', country: 'Brazil', type: 'League' },
  { slug: 'bra.copa_do_brazil', name: 'Copa do Brasil', country: 'Brazil', type: 'Cup' },
  { slug: 'bra.supercopa_do_brazil', name: 'Supercopa do Brasil', country: 'Brazil', type: 'Cup' },
  // Brasil — estaduais
  { slug: 'bra.camp.paulista', name: 'Paulista - A1', country: 'Brazil', type: 'League' },
  { slug: 'bra.camp.carioca', name: 'Carioca - 1', country: 'Brazil', type: 'League' },
  { slug: 'bra.camp.mineiro', name: 'Mineiro - 1', country: 'Brazil', type: 'League' },
  { slug: 'bra.camp.gaucho', name: 'Gaucho - 1', country: 'Brazil', type: 'League' },
  // Conmebol
  { slug: 'conmebol.libertadores', name: 'CONMEBOL Libertadores', country: 'World', type: 'Cup' },
  { slug: 'conmebol.sudamericana', name: 'CONMEBOL Sudamericana', country: 'World', type: 'Cup' },
  { slug: 'conmebol.recopa', name: 'CONMEBOL Recopa', country: 'World', type: 'Cup' },
  { slug: 'conmebol.america', name: 'Copa America', country: 'World', type: 'Cup' },
  // Uefa
  { slug: 'uefa.champions', name: 'UEFA Champions League', country: 'World', type: 'Cup' },
  { slug: 'uefa.europa', name: 'UEFA Europa League', country: 'World', type: 'Cup' },
  { slug: 'uefa.europa.conf', name: 'UEFA Europa Conference League', country: 'World', type: 'Cup' },
  { slug: 'uefa.euro', name: 'Euro Championship', country: 'World', type: 'Cup' },
  // Seleções
  { slug: 'fifa.world', name: 'World Cup', country: 'World', type: 'Cup' },
  {
    slug: 'fifa.worldq.conmebol',
    name: 'World Cup - Qualification South America',
    country: 'World',
    type: 'Cup',
  },
  { slug: 'fifa.cwc', name: 'FIFA Club World Cup', country: 'World', type: 'Cup' },
  // Ligas nacionais de fora
  { slug: 'eng.1', name: 'Premier League', country: 'England', type: 'League' },
  // ESPN chama de "Spanish La Liga" — o nome aqui casa com a curadoria.
  { slug: 'esp.1', name: 'La Liga', country: 'Spain', type: 'League' },
  { slug: 'ita.1', name: 'Serie A', country: 'Italy', type: 'League' },
  { slug: 'ger.1', name: 'Bundesliga', country: 'Germany', type: 'League' },
  { slug: 'fra.1', name: 'Ligue 1', country: 'France', type: 'League' },
  { slug: 'por.1', name: 'Primeira Liga', country: 'Portugal', type: 'League' },
  { slug: 'ned.1', name: 'Eredivisie', country: 'Netherlands', type: 'League' },
  { slug: 'arg.1', name: 'Liga Profesional Argentina', country: 'Argentina', type: 'League' },
  { slug: 'chi.1', name: 'Primera División', country: 'Chile', type: 'League' },
  { slug: 'uru.1', name: 'Primera División', country: 'Uruguay', type: 'League' },
  { slug: 'col.1', name: 'Primera A', country: 'Colombia', type: 'League' },
  { slug: 'per.1', name: 'Primera División', country: 'Peru', type: 'League' },
  { slug: 'par.1', name: 'Primera División', country: 'Paraguay', type: 'League' },
  { slug: 'bol.1', name: 'Primera División', country: 'Bolivia', type: 'League' },
  { slug: 'ecu.1', name: 'Serie A', country: 'Ecuador', type: 'League' },
  { slug: 'ven.1', name: 'Primera División', country: 'Venezuela', type: 'League' },
  { slug: 'usa.1', name: 'Major League Soccer', country: 'USA', type: 'League' },
  { slug: 'mex.1', name: 'Liga MX', country: 'Mexico', type: 'League' },
  { slug: 'ksa.1', name: 'Pro League', country: 'Saudi-Arabia', type: 'League' },
]

/** Requisições simultâneas à ESPN — API grande e sem chave, mas sem abuso. */
const ESPN_CONCURRENCY = 5

/** Temporada corrente já validada contra a data do sync. */
type SeasonWindow = { year: string; startsOn: string | null; endsOn: string | null }

/**
 * A ESPN deixa a `season` da última edição no scoreboard mesmo depois dela
 * acabar (Copa América 2024, Euro 2024, eliminatórias 2023-25): janela vencida
 * ou nem começada = "não corrente", pular. Sem `season` nenhuma (fora de
 * catálogo) idem. É o equivalente do filtro `current=true` que o catálogo da
 * API-Football fazia.
 */
function parseSeason(season: EspnSeason | undefined, today: string): SeasonWindow | null {
  if (!season || typeof season.year !== 'number') return null
  const startsOn = typeof season.startDate === 'string' ? season.startDate.slice(0, 10) : null
  const endsOn = typeof season.endDate === 'string' ? season.endDate.slice(0, 10) : null
  if (startsOn && today < startsOn) return null
  if (endsOn && today > endsOn) return null
  return { year: String(season.year), startsOn, endsOn }
}

/**
 * Jogos daquela data (UTC). OBRIGATÓRIO filtrar pelo `date` de cada evento:
 * para uma data sem jogos a ESPN devolve a rodada vizinha, e para uma liga
 * fora de temporada devolve os últimos jogos — `events.length` sozinho
 * contaria jogos que não são do dia.
 */
function matchesOn(scoreboard: EspnScoreboard, dateISO: string): number {
  return (scoreboard.events ?? []).filter(
    (event) => typeof event.date === 'string' && event.date.startsWith(dateISO),
  ).length
}

/** Resultado da varredura do recorte numa data. */
export type EspnRadarSnapshot = {
  /** Ligas com temporada corrente na data. */
  leagues: ProviderLeague[]
  /** Jogos na data, por slug (ausente = 0). */
  counts: Map<string, number>
  /** Slugs que falharam — a coleta seguiu com os que responderam. */
  failed: string[]
}

/**
 * Varre os slugs do recorte (concorrência limitada) e devolve o que a ESPN
 * reporta para a data: quais ligas estão na temporada corrente e quantos
 * jogos cada uma tem.
 *
 * Falha parcial é tolerada (o snapshot segue com os que responderam e os
 * falhos vêm em `failed`); TODOS em erro → throw, para o chamador preservar
 * o snapshot do dia anterior (fail-closed).
 */
export async function fetchEspnLeaguesAndCounts(dateISO: string): Promise<EspnRadarSnapshot> {
  const yyyymmdd = dateISO.replaceAll('-', '')
  const leagues: ProviderLeague[] = []
  const counts = new Map<string, number>()
  const failed: string[] = []

  const queue = [...ESPN_LEAGUES]
  const workers = Array.from({ length: Math.min(ESPN_CONCURRENCY, queue.length) }, async () => {
    for (let ref = queue.shift(); ref; ref = queue.shift()) {
      try {
        const board = await fetchEspnScoreboard(ref.slug, yyyymmdd)
        const meta = board.leagues?.[0]
        const season = parseSeason(meta?.season, dateISO)
        // Sem `leagues[0]` ou sem temporada corrente: pular silenciosamente —
        // não é erro, a competição só não está acontecendo.
        if (!meta || !season) continue

        leagues.push({
          externalId: ref.slug,
          name: ref.name,
          country: ref.country,
          type: ref.type,
          logoUrl: meta.logos?.[0]?.href ?? null,
          season: season.year,
          startsOn: season.startsOn,
          endsOn: season.endsOn,
        })
        counts.set(ref.slug, matchesOn(board, dateISO))
      } catch (err) {
        failed.push(ref.slug)
        console.warn(`[radar] ESPN falhou para ${ref.slug}:`, err)
      }
    }
  })
  await Promise.all(workers)

  if (failed.length === ESPN_LEAGUES.length) {
    throw new Error(`ESPN falhou em todos os ${failed.length} slugs do recorte`)
  }
  return { leagues, counts, failed }
}

import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import {
  createProviderHttpObserver,
  type ProviderHttpObserver,
} from '../observability/providerHttp'
import {
  fetchEspnScoreboard as fetchScoreboard,
  isEspnFinal,
  parseNonNegativeInt,
  type EspnScoreboardEvent,
} from '../providers/espn'
import { ACTIVE_RESULT_WINDOW_MS, EARLIEST_RESULT_MS, RESCUE_WINDOW_MS } from './matchPollingWindow'

/**
 * Fallback de RESULTADOS via ESPN (ADR-016). Quando o sync da football-data.org
 * falha (429/5xx/outage) ou devolve dados atrasados, o jogo ficava sem placar até o provedor
 * primário voltar. Aqui a ESPN não-oficial preenche o placar de jogos que JÁ
 * existem no D1 — nunca insere jogos, times ou competições.
 *
 * Endpoint: GET site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard
 * — 200 sem auth, sem quota conhecida. Detalhe validado ao vivo (05/10/2026):
 * o parâmetro de data é `dates=YYYYMMDD` (plural). O singular `date=` é
 * silenciosamente IGNORADO e devolve a rodada corrente — todos os eventos em
 * estado 'pre', ou seja, um fallback que nunca atualiza nada.
 */

/**
 * Código football-data.org → slug ESPN, cobrindo os códigos plausíveis do free
 * tier (TIER_ONE na nomenclatura deles). Conferido ao vivo em
 * api.football-data.org/v4/competitions:
 *   - `EL` é UEFA Europa League (TIER_TWO, mas mapeado por segurança);
 *   - `ECL` NÃO existe — Conference League é `UCL` (TIER_FOUR, fora do free
 *     tier e sem uso no produto hoje);
 *   - `EC` (Eurocopa) é TIER_ONE e entra por ser o torneio de seleções mais
 *     plausível depois da Copa (ADR-011).
 * Código sem mapeamento → fallback não se aplica (log info, não é erro).
 */
export const FOOTBALL_DATA_TO_ESPN: Record<string, string> = {
  BSA: 'bra.1',
  '2013': 'bra.1',
  WC: 'fifa.world',
  '2000': 'fifa.world',
  EC: 'uefa.euro',
  '2018': 'uefa.euro',
  PL: 'eng.1',
  '2021': 'eng.1',
  ELC: 'eng.2',
  '2016': 'eng.2',
  PD: 'esp.1',
  '2014': 'esp.1',
  SA: 'ita.1',
  '2019': 'ita.1',
  BL1: 'ger.1',
  '2002': 'ger.1',
  FL1: 'fra.1',
  '2015': 'fra.1',
  DED: 'ned.1',
  '2003': 'ned.1',
  PPL: 'por.1',
  '2017': 'por.1',
  CL: 'uefa.champions',
  '2001': 'uefa.champions',
  EL: 'uefa.europa',
  '2146': 'uefa.europa',
}

/**
 * Tolerância entre o `start_time` interno e o `date` do evento ESPN. Os dois
 * provedores divergem em remarcamentos de última hora; 150 min cobre isso sem
 * abrir a porta para casar jogos de rodadas diferentes no mesmo dia.
 */
const KICKOFF_TOLERANCE_MS = 150 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

type EspnCompetitor = {
  homeAway?: string
  team?: { displayName?: string }
  score?: string
}

type EspnEvent = EspnScoreboardEvent

type WindowMatch = {
  id: string
  start_time: string
  home_name: string
  away_name: string
  comp_code: string | null
}

export type EspnFallbackOptions = {
  /**
   * Instante de referência da janela ativa. O poller passa o `now` que ele
   * mesmo computou, garantindo janelas idênticas entre a query dele e a daqui.
   */
  now?: number
  /** Chamado a cada tentativa HTTP à ESPN, além da telemetria. O poller conta as chamadas da invocação. */
  onHttpAttempt?: ProviderHttpObserver
}

/**
 * Normalização de nome — mesmo padrão do `matchKey` de radar/articles.ts:
 * NFD, sem diacritics, lowercase, sem pontuação. 'São Paulo' e 'Sao Paulo'
 * viram a mesma chave.
 */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Casamento por conter/contido nos DOIS sentidos: football-data usa nomes
 * completos ('Liverpool FC', 'SSC Napoli') e a ESPN os encurta ('Liverpool',
 * 'Napoli'). O sync grava os clubes do Brasileirão com o nome popular
 * (clubNames.ts), que casa com o nome da ESPN. Exige relação em ambos os lados
 * do confronto (mandante-com-mandante e visitante-com-visitante).
 */
function namesRelated(a: string, b: string): boolean {
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
}

async function fetchEspnScoreboard(
  slug: string,
  yyyymmdd: string,
  onAttempt?: ProviderHttpObserver,
): Promise<EspnEvent[]> {
  const data = await fetchScoreboard(slug, yyyymmdd, onAttempt)
  return data.events ?? []
}

function espnCompetitors(ev: EspnEvent): {
  home: EspnCompetitor | undefined
  away: EspnCompetitor | undefined
} {
  const competitors = ev.competitions?.[0]?.competitors ?? []
  return {
    home: competitors.find((c) => c.homeAway === 'home'),
    away: competitors.find((c) => c.homeAway === 'away'),
  }
}

/**
 * Um evento ESPN casa com um jogo interno quando o kickoff está dentro da
 * tolerância E os nomes normalizados de ambos os times se contêm. Falta de
 * qualquer lado (data inválida, competitor ausente) → não casa (fail-closed).
 */
function matchesEvent(m: WindowMatch, ev: EspnEvent): boolean {
  if (typeof ev.date !== 'string') return false
  const kickoff = Date.parse(ev.date)
  const start = Date.parse(m.start_time)
  if (!Number.isFinite(kickoff) || !Number.isFinite(start)) return false
  if (Math.abs(kickoff - start) > KICKOFF_TOLERANCE_MS) return false

  const { home, away } = espnCompetitors(ev)
  return (
    namesRelated(normalizeName(m.home_name), normalizeName(home?.team?.displayName ?? '')) &&
    namesRelated(normalizeName(m.away_name), normalizeName(away?.team?.displayName ?? ''))
  )
}

/** Placar final do evento, ou nulls se não-numérico/ausente. */
function espnScores(ev: EspnEvent): { home: number | null; away: number | null } {
  const { home, away } = espnCompetitors(ev)
  return { home: parseNonNegativeInt(home?.score), away: parseNonNegativeInt(away?.score) }
}

/**
 * Para cada competição consultada: recupera os jogos ainda sem resultado cujo evento
 * correspondente na ESPN já terminou (`isEspnFinal`). Devolve um mapa compId → nº de
 * jogos atualizados (comps sem jogos na janela, sem mapeamento ou com casamento
 * ambíguo devolvem 0 e nunca lançam).
 *
 * Fail-closed em todas as dúvidas: 0 ou >1 candidatos, placar não-numérico ou
 * evento sem fim de jogo confirmado (adiado, cancelado, em andamento) → pula o
 * jogo. Errar por não pontuar é recuperável (o primário volta); pontuar errado
 * não é.
 */
export async function scoreWindowFromEspn(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  compIds: string[],
  opts: EspnFallbackOptions = {},
): Promise<Map<string, number>> {
  const updatedByComp = new Map<string, number>()
  if (compIds.length === 0) return updatedByComp

  // Mesmos limites do poller, incluindo o resgate de até 24 h e a exclusão de
  // adiados fora da janela ativa. ISO com T/Z mantém a comparação TEXT correta.
  const now = opts.now ?? Date.now()
  const earliestOver = new Date(now - EARLIEST_RESULT_MS).toISOString()
  const stillRelevant = new Date(now - ACTIVE_RESULT_WINDOW_MS).toISOString()
  const rescueFloor = new Date(now - RESCUE_WINDOW_MS).toISOString()

  await Promise.all(
    compIds.map(async (compId) => {
      try {
        const updated = await scoreCompetitionWindow(
          db,
          ae,
          compId,
          earliestOver,
          rescueFloor,
          stillRelevant,
          opts.onHttpAttempt,
        )
        updatedByComp.set(compId, updated)
      } catch (err) {
        // Erro de fetch/parsing isola a competição — as demais continuam. Devolve
        // 0 para o mapa cobrir todas as comps pedidas (0 = nada atualizado).
        updatedByComp.set(compId, 0)
        logError(ae, 'match_results_fallback', `[espn-fallback] Falhou comp=${compId}:`, err, {
          blobs: [compId],
        })
      }
    }),
  )

  return updatedByComp
}

async function scoreCompetitionWindow(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  compId: string,
  earliestOver: string,
  rescueFloor: string,
  stillRelevant: string,
  onHttpAttempt: ProviderHttpObserver | undefined,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT m.id, m.start_time,
              th.name AS home_name,
              ta.name AS away_name,
              c.external_id AS comp_code
         FROM matches m
         JOIN teams th ON th.id = m.home_team_id
         JOIN teams ta ON ta.id = m.away_team_id
         JOIN competitions c ON c.id = m.competition_id
        WHERE m.competition_id = ?
          AND c.provider = 'football-data'
          AND m.start_time <= ?
          AND m.start_time >= ?
          AND (m.start_time >= ? OR m.postponed = 0)
          AND m.status != 'finished'`,
    )
    .bind(compId, earliestOver, rescueFloor, stillRelevant)
    .all<WindowMatch>()

  if (results.length === 0) return 0

  const compCode = results[0].comp_code
  const slug = compCode ? FOOTBALL_DATA_TO_ESPN[compCode] : undefined
  if (!slug) {
    console.info(
      `[espn-fallback] Competição ${compId} (código ${compCode}) sem mapeamento ESPN — fallback não se aplica.`,
    )
    return 0
  }

  // A ESPN agrupa os eventos por dia norte-americano: um jogo às 00:30Z entra no
  // scoreboard da data UTC do dia ANTERIOR (validado ao vivo — São Paulo×Cruzeiro
  // 2026-10-08T00:30Z aparece em dates=20261007). Por isso buscamos o dia UTC de
  // cada jogo E o anterior; com qualquer fronteira de fuso fixa [X-k, X+k), esses
  // dois dias cobrem todos os eventos cujo kickoff cai na data UTC do jogo.
  const dates = new Set<string>()
  for (const m of results) {
    const day = m.start_time.slice(0, 10)
    dates.add(day.replaceAll('-', ''))
    dates.add(
      new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS)
        .toISOString()
        .slice(0, 10)
        .replaceAll('-', ''),
    )
  }

  const telemetry = createProviderHttpObserver(ae, { context: 'fallback', competitionId: compId })
  const onAttempt: ProviderHttpObserver = (attempt) => {
    onHttpAttempt?.(attempt)
    telemetry?.(attempt)
  }
  const eventsArrays = await Promise.all(
    Array.from(dates).map((date) => fetchEspnScoreboard(slug, date, onAttempt)),
  )
  const events = eventsArrays.flat()

  let updated = 0
  let skipped = 0
  const updateStmt = db.prepare(
    `UPDATE matches SET home_score = ?, away_score = ?, status = 'finished', postponed = 0,
       scored_at = CASE WHEN home_score IS NOT ? OR away_score IS NOT ?
                        THEN NULL ELSE scored_at END
     WHERE id = ? AND status != 'finished'`,
  )
  const statements: D1PreparedStatement[] = []

  for (const m of results) {
    const candidates = events.filter((ev) => matchesEvent(m, ev))
    // Casa ambígua (ou nenhuma) → pula: nunca pontuar na dúvida.
    if (candidates.length !== 1) {
      skipped++
      continue
    }
    const ev = candidates[0]
    // Adiado chega como STATUS_POSTPONED, state 'post', completed false e 0-0.
    if (!isEspnFinal(ev.status?.type)) {
      skipped++
      continue
    }
    const { home, away } = espnScores(ev)
    if (home === null || away === null) {
      skipped++
      continue
    }
    // Uma linha regredida pode já ter scored_at: placar corrigido precisa passar
    // de novo pelo scoring. O guard protege resultados finalizados pelo primário.
    // O jogo disputado deixa de ser adiado: a football-data pode seguir com
    // POSTPONED ou SUSPENDED atrasado, e o upsert não regride a linha encerrada.
    statements.push(updateStmt.bind(home, away, home, away, m.id))
    updated++
  }

  const batches = []
  for (let i = 0; i < statements.length; i += 100) {
    batches.push(db.batch(statements.slice(i, i + 100)))
  }
  await Promise.all(batches)

  logEvent(ae, 'match_results_fallback', {
    blobs: [compId],
    doubles: [updated, skipped],
  })

  return updated
}

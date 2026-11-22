import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import {
  createProviderHttpObserver,
  type ProviderHttpObserver,
} from '../observability/providerHttp'
import { runInBatches } from '../d1Batch'
import { normalizeName } from '../normalizeName'
import {
  fetchEspnScoreboard,
  isEspnFinal,
  parseNonNegativeInt,
  requireScoreboardEvents,
  type EspnCompetitor,
  type EspnGate,
  type EspnScoreboardEvent,
} from '../providers/espn'
import { CallBudgetExhaustedError } from './callBudget'
import type { DrainBudget, ItemBudget } from './drainBudget'
import { createEspnGate, ESPN_REQUEST_CALLS, isEspnRefusal } from './espnAccess'
import { espnDatesAround, resultWindowBounds, type ResultWindowBounds } from './matchPollingWindow'


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

const KICKOFF_TOLERANCE_MS = 150 * 60 * 1000

/**
 * Datas do scoreboard de uma competição, no máximo. Os jogos consultados começaram
 * entre 24 h e 115 min atrás, menos de 24 h de intervalo, então caem em até 2 dias
 * UTC; cada dia pede ele e o anterior, e os dois dias juntos pedem 3 datas.
 */
export const FALLBACK_MAX_DATES = 3

/**
 * Custo completo do fallback de uma competição, que ela reserva antes de começar
 * quando o chamador passa um saldo: a consulta dos jogos (1), cada data (vaga,
 * `fetch` e registro da resposta, `ESPN_REQUEST_CALLS`) e a gravação (1 batch).
 */
export const FALLBACK_COMPETITION_CALLS = 1 + ESPN_REQUEST_CALLS * FALLBACK_MAX_DATES + 1

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
  /**
   * Reserva vaga no orçamento compartilhado da ESPN e respeita o bloqueio e a
   * suspensão do acesso (ADR-027). O poller liga; sem a flag a chamada fica
   * fora do orçamento.
   */
  coordinate?: boolean
  /**
   * Saldo de subrequests do chamador (o poller). Cada competição reserva o custo
   * completo (`FALLBACK_COMPETITION_CALLS`) antes de começar; sem ele livre, espera
   * outra competição devolver o que reservou e não gastou. A consulta, as tentativas
   * e a gravação saem pelo D1 e pelo porteiro da competição, que recusam sem chamar o
   * que passaria do saldo, e o `fetch` é cobrado pelo porteiro (sem `onHttpAttempt`,
   * para não contar duas vezes). Com saldo, a chamada é sempre coordenada. A
   * competição que não cabe espera o tick seguinte, sem erro nem fila: o fallback é
   * complementar e o D1 o replaneja.
   */
  budget?: DrainBudget
}

function namesRelated(a: string, b: string): boolean {
  if (!a || !b) return false
  return a.includes(b) || b.includes(a)
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
  // adiados fora da janela ativa.
  const bounds = resultWindowBounds(opts.now ?? Date.now())
  const { budget } = opts
  const gate = opts.coordinate && !budget ? createEspnGate(db, ae) : undefined

  await Promise.all(
    compIds.map(async (compId) => {
      const span = budget ? await admitCompetition(budget) : undefined
      try {
        if (span === null) throw new CallBudgetExhaustedError()
        const updated = await scoreCompetitionWindow(
          span?.db ?? db,
          ae,
          compId,
          bounds,
          opts.onHttpAttempt,
          span ? createEspnGate(span.db, ae, span) : gate,
        )
        updatedByComp.set(compId, updated)
      } catch (err) {
        // Erro de fetch/parsing isola a competição — as demais continuam. Devolve
        // 0 para o mapa cobrir todas as comps pedidas (0 = nada atualizado).
        updatedByComp.set(compId, 0)
        if (isEspnRefusal(err)) {
          console.info(`[espn-fallback] ESPN indisponível comp=${compId}: ${err.message}`)
          return
        }
        if (err instanceof CallBudgetExhaustedError) {
          console.info(
            `[espn-fallback] Sem saldo de chamadas comp=${compId}: espera o próximo tick.`,
          )
          return
        }
        logError(ae, 'match_results_fallback', `[espn-fallback] Falhou comp=${compId}:`, err, {
          blobs: [compId],
        })
      } finally {
        span?.close()
      }
    }),
  )

  return updatedByComp
}

/**
 * Reserva o custo completo de uma competição no saldo. Sem ele livre, espera outra
 * competição em andamento terminar, que devolve o que reservou e não gastou, e tenta
 * de novo; sem nenhuma em andamento, devolve `null`: o que falta não cabe no tick.
 */
async function admitCompetition(budget: DrainBudget): Promise<ItemBudget | null> {
  for (;;) {
    const span = budget.open(FALLBACK_COMPETITION_CALLS)
    if (span || !budget.hasInFlight()) return span
    await budget.nextRelease()
  }
}

async function scoreCompetitionWindow(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  compId: string,
  { earliestOver, rescueFloor, stillRelevant }: ResultWindowBounds,
  onHttpAttempt: ProviderHttpObserver | undefined,
  gate: EspnGate | undefined,
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

  const dates = new Set<string>()
  for (const m of results) {
    const utcDay = Date.parse(`${m.start_time.slice(0, 10)}T00:00:00Z`)
    // Dia do jogo antes do anterior: a ordem decide a fila de requisições, a
    // sequência da telemetria e qual erro chega primeiro ao log.
    for (const date of espnDatesAround(utcDay, -1, 2).reverse()) dates.add(date)
  }

  const telemetry = createProviderHttpObserver(ae, { context: 'fallback', competitionId: compId })
  const onAttempt: ProviderHttpObserver = (attempt) => {
    onHttpAttempt?.(attempt)
    telemetry?.(attempt)
  }
  const settled = await Promise.allSettled(
    Array.from(dates).map((date) => fetchEspnScoreboard(slug, date, onAttempt, gate)),
  )
  const failed = settled.find((outcome) => outcome.status === 'rejected')
  if (failed) throw failed.reason
  const scoreboards = settled.map(
    (outcome) =>
      (outcome as PromiseFulfilledResult<Awaited<ReturnType<typeof fetchEspnScoreboard>>>).value,
  )
  // Resposta sem a lista de eventos falha a competição: não é "sem resultado".
  const events = scoreboards.flatMap((scoreboard) => requireScoreboardEvents(scoreboard, slug))

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
    statements.push(updateStmt.bind(home, away, home, away, m.id))
    updated++
  }

  await runInBatches(db, statements)

  logEvent(ae, 'match_results_fallback', {
    blobs: [compId],
    doubles: [updated, skipped],
  })

  return updated
}

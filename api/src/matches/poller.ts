import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { scoreWindowFromEspn } from './espnFallback'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

// Até quando o poller ainda busca resultado de um jogo que passou da janela ativa.
const RESCUE_WINDOW_MS = 24 * 60 * 60 * 1000

type ActiveRound = {
  comp_id: string
  external_id: string
  provider?: string
  season: string
  round: string
}

type SyncTask = {
  comp: ActiveRound
  round: string
}

function buildSyncTasks(rows: ActiveRound[]): {
  compCount: number
  tasks: SyncTask[]
} {
  const byComp = new Map<string, { comp: ActiveRound; rounds: Set<string> }>()
  for (const row of rows) {
    const entry = byComp.get(row.comp_id)
    if (entry) {
      entry.rounds.add(row.round)
    } else {
      byComp.set(row.comp_id, { comp: row, rounds: new Set([row.round]) })
    }
  }

  const tasks: SyncTask[] = []
  for (const { comp, rounds } of byComp.values()) {
    if (comp.provider === 'espn') {
      const firstRound = rounds.values().next().value ?? ''
      tasks.push({ comp, round: firstRound })
      continue
    }
    for (const round of rounds) {
      tasks.push({ comp, round })
    }
  }

  return { compCount: byComp.size, tasks }
}

/**
 * Polls football-data.org and ESPN for results of matches currently inside
 * their active window, then scores them. Designed to run on a Cron Trigger
 * (every 30 min).
 *
 * Active window per match (see ADR-007):
 *   start_time + 115min  ≤ now ≤  start_time + 200min
 *
 * 115 min = 45 + 5 (stoppage) + 15 (interval) + 45 + 5 (stoppage) — the earliest
 * a match can realistically be over. 200 min upper bound covers knockout extra
 * time + penalties, and stops polling matches that never resolve (abnormal cases).
 *
 * Resgate (até 24 h após o início): jogos que saíram da janela ativa sem status
 * final (resultado atrasado no provedor, falha nos dois ticks) e jogos finalizados
 * ainda sem pontuação continuam entrando na consulta. Jogos adiados
 * (`postponed = 1`) ficam de fora do resgate, para não gastar quota da
 * football-data com partidas que não terminam. O failover da ESPN cobre só a
 * janela ativa de competições cujo provider é `football-data`.
 */
export async function pollActiveMatches(
  db: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
): Promise<void> {
  const startedAt = Date.now()

  // start_time is stored as ISO 8601 with `T`/`Z` (e.g. "2026-06-16T22:00:00Z").
  // Compute the bounds the same way so the TEXT comparison stays lexicographic.
  // SQLite's datetime('now', ...) would produce "2026-06-16 23:21:20" (space, no Z)
  // and string-compare wrong against the stored format.
  const now = Date.now()
  const earliestOver = new Date(now - 115 * 60 * 1000).toISOString() // started ≥ 115 min ago
  const stillRelevant = new Date(now - 200 * 60 * 1000).toISOString() // started ≤ 200 min ago
  const rescueFloor = new Date(now - RESCUE_WINDOW_MS).toISOString() // started ≤ 24 h ago

  const rows = await db
    .prepare(
      `SELECT DISTINCT
         c.id          AS comp_id,
         c.external_id AS external_id,
         c.provider    AS provider,
         c.season      AS season,
         m.round       AS round
       FROM matches m
       JOIN competitions c ON c.id = m.competition_id
       WHERE m.start_time <= ?
         AND m.start_time >= ?
         AND c.provider IN ('football-data', 'espn')
         AND (
           (m.status != 'finished' AND (m.start_time >= ? OR m.postponed = 0))
           OR (m.status = 'finished' AND m.scored_at IS NULL
               AND m.home_score IS NOT NULL AND m.away_score IS NOT NULL)
         )`,
    )
    .bind(earliestOver, rescueFloor, stillRelevant)
    .all<ActiveRound>()

  if (rows.results.length === 0) {
    console.info('[poller] Nenhum jogo na janela ativa.')
    logEvent(ae, 'poller_run', {
      blobs: ['ok'],
      doubles: [0, 0, 0, Date.now() - startedAt], // matches_checked, fixtures_updated, api_calls, duration_ms
    })
    return
  }

  const { compCount, tasks } = buildSyncTasks(rows.results)

  const syncResults = await Promise.all(
    tasks.map(async ({ comp, round }) => {
      const matchday = parseInt(round, 10)
      const matchdayParam =
        comp.provider === 'espn' || Number.isNaN(matchday) ? undefined : matchday

      try {
        const result = await syncFixtures({
          competitionCode: comp.external_id,
          season: Number(comp.season),
          matchday: matchdayParam,
          apiKey,
          db,
        })
        return { success: true as const, comp, round, matches: result?.matches ?? 0 }
      } catch (err) {
        return { success: false as const, comp, round, err }
      }
    }),
  )

  let footballApiCalls = 0
  let fixturesUpdated = 0
  let hadError = false
  const syncedComps = new Set<string>()
  const failedCompIds = new Set<string>()

  for (const res of syncResults) {
    footballApiCalls++
    if (res.success) {
      fixturesUpdated += res.matches
      syncedComps.add(res.comp.comp_id)
    } else {
      hadError = true
      if (res.comp.provider !== 'espn') {
        failedCompIds.add(res.comp.comp_id)
      }
      logError(
        ae,
        'football_api_error',
        `[poller] Sync falhou comp=${res.comp.comp_id} round=${res.round}:`,
        res.err,
        {
          blobs: [res.comp.comp_id, res.round],
        },
      )
    }
  }

  if (failedCompIds.size > 0) {
    try {
      const updatedByComp = await scoreWindowFromEspn(db, ae, Array.from(failedCompIds), { now })
      for (const [compId, updated] of updatedByComp) {
        if (updated > 0) syncedComps.add(compId)
      }
    } catch (err) {
      logError(ae, 'match_results_fallback', '[poller] Fallback ESPN falhou:', err)
    }
  }

  const scoreResults = await Promise.all(
    Array.from(syncedComps).map(async (compId) => {
      try {
        await scoreUnprocessedMatches(compId, db)
        return { success: true as const, compId }
      } catch (err) {
        return { success: false as const, compId, err }
      }
    }),
  )

  for (const res of scoreResults) {
    if (!res.success) {
      throw res.err
    }
  }

  logEvent(ae, 'poller_run', {
    blobs: [hadError ? 'error' : 'ok'],
    doubles: [rows.results.length, fixturesUpdated, footballApiCalls, Date.now() - startedAt],
  })

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron pollActiveMatches',
      competitions: compCount,
      rounds: rows.results.length,
      total_ms: Date.now() - startedAt,
    }),
  )
}

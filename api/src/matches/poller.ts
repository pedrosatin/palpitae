import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { scoreWindowFromEspn } from './espnFallback'
import { FD_MAX_CONCURRENT_REQUESTS, runWithConcurrency } from './footballDataQuota'
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
  utc_day: string
}

type SyncTask = {
  comp: ActiveRound
  round: string
  dates?: string[]
}

function buildSyncTasks(rows: ActiveRound[]): {
  compCount: number
  tasks: SyncTask[]
} {
  const byComp = new Map<string, { comp: ActiveRound; rounds: Set<string>; dates: Set<string> }>()
  for (const row of rows) {
    let entry = byComp.get(row.comp_id)
    if (!entry) {
      entry = { comp: row, rounds: new Set(), dates: new Set() }
      byComp.set(row.comp_id, entry)
    }
    entry.rounds.add(row.round)
    if (row.provider === 'espn') {
      // A ESPN indexa o dia local. Um jogo após meia-noite UTC pode estar no dia anterior.
      const day = Date.parse(`${row.utc_day}T00:00:00Z`)
      for (const offset of [-1, 0]) {
        entry.dates.add(
          new Date(day + offset * 86_400_000).toISOString().slice(0, 10).replaceAll('-', ''),
        )
      }
    }
  }

  const tasks: SyncTask[] = []
  for (const { comp, rounds, dates } of byComp.values()) {
    if (comp.provider === 'espn') {
      const firstRound = rounds.values().next().value ?? ''
      tasks.push({ comp, round: firstRound, dates: Array.from(dates).sort() })
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
  now = Date.now(),
): Promise<void> {
  const startedAt = Date.now()

  // start_time is stored as ISO 8601 with `T`/`Z` (e.g. "2026-06-16T22:00:00Z").
  // Compute the bounds the same way so the TEXT comparison stays lexicographic.
  // SQLite's datetime('now', ...) would produce "2026-06-16 23:21:20" (space, no Z)
  // and string-compare wrong against the stored format.
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
         m.round       AS round,
         substr(m.start_time, 1, 10) AS utc_day
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

  type SyncOutcome =
    | { success: true; comp: ActiveRound; round: string; matches: number }
    | { success: false; comp: ActiveRound; round: string; err: unknown }

  const runSyncTask = async ({ comp, round, dates }: SyncTask): Promise<SyncOutcome> => {
    const matchday = parseInt(round, 10)
    const matchdayParam =
      comp.provider === 'espn' || Number.isNaN(matchday) ? undefined : matchday

    try {
      const result = await syncFixtures({
        competitionCode: comp.external_id,
        season: Number(comp.season),
        matchday: matchdayParam,
        dates,
        apiKey,
        db,
      })
      return { success: true as const, comp, round, matches: result?.matches ?? 0 }
    } catch (err) {
      return { success: false as const, comp, round, err }
    }
  }

  // football-data compartilha 10 req/min; ESPN não consome essa cota.
  const fdTasks = tasks.filter((task) => task.comp.provider === 'football-data')
  const espnTasks = tasks.filter((task) => task.comp.provider === 'espn')
  const [fdResults, espnResults] = await Promise.all([
    runWithConcurrency(FD_MAX_CONCURRENT_REQUESTS, fdTasks, runSyncTask),
    Promise.all(espnTasks.map(runSyncTask)),
  ])
  const syncResults = [...fdResults, ...espnResults]

  // Requests primárias planejadas, sem retries nem chamadas do fallback.
  const plannedApiRequests = tasks.reduce((count, task) => count + (task.dates?.length ?? 1), 0)
  let fixturesUpdated = 0
  let hadError = false
  const syncedComps = new Set<string>()
  const failedCompIds = new Set<string>()

  for (const res of syncResults) {
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
    doubles: [rows.results.length, fixturesUpdated, plannedApiRequests, Date.now() - startedAt],
  })

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron pollActiveMatches',
      competitions: compCount,
      round_days: rows.results.length,
      sync_tasks: tasks.length,
      api_requests_planned: plannedApiRequests,
      total_ms: Date.now() - startedAt,
    }),
  )
}

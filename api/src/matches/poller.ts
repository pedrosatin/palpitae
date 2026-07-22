import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

type ActiveRound = {
  comp_id: string
  external_id: string
  season: string
  round: string
}

/**
 * Polls football-data.org for results of matches currently inside their active
 * window, then scores them. Designed to run on a Cron Trigger (every 30 min).
 *
 * Active window per match (see ADR-007):
 *   start_time + 115min  ≤ now ≤  start_time + 200min
 *
 * 115 min = 45 + 5 (stoppage) + 15 (interval) + 45 + 5 (stoppage) — the earliest
 * a match can realistically be over. 200 min upper bound covers knockout extra
 * time + penalties, and stops polling matches that never resolve (abnormal cases).
 *
 * Only numeric rounds (group-stage matchdays) get a `matchday` filter so the API
 * call is scoped to the active round. Non-numeric rounds (knockout phases) fall
 * back to a full-competition fetch.
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

  const rows = await db
    .prepare(
      `SELECT DISTINCT
         c.id          AS comp_id,
         c.external_id AS external_id,
         c.season      AS season,
         m.round       AS round
       FROM matches m
       JOIN competitions c ON c.id = m.competition_id
       WHERE m.start_time <= ?
         AND m.start_time >= ?
         AND m.status != 'finished'
         AND c.provider = 'football-data'`,
    )
    .bind(earliestOver, stillRelevant)
    .all<ActiveRound>()

  if (rows.results.length === 0) {
    console.info('[poller] Nenhum jogo na janela ativa.')
    logEvent(ae, 'poller_run', {
      blobs: ['ok'],
      doubles: [0, 0, 0, Date.now() - startedAt], // matches_checked, fixtures_updated, api_calls, duration_ms
    })
    return
  }

  // Group rounds by competition — usually one, but a late-running matchday can
  // overlap the start of the next, so we may sync more than one round per comp.
  const byComp = new Map<string, { comp: ActiveRound; rounds: Set<string> }>()
  for (const row of rows.results) {
    const entry = byComp.get(row.comp_id)
    if (entry) {
      entry.rounds.add(row.round)
    } else {
      byComp.set(row.comp_id, { comp: row, rounds: new Set([row.round]) })
    }
  }

  // Métricas agregadas do run — viram um único evento `poller_run` no fim.
  let footballApiCalls = 0
  let fixturesUpdated = 0
  let hadError = false

  for (const { comp, rounds } of byComp.values()) {
    let synced = false

    for (const round of rounds) {
      const matchday = parseInt(round, 10)
      // Non-numeric round = knockout stage — no matchday filter
      const matchdayParam = Number.isNaN(matchday) ? undefined : matchday

      try {
        footballApiCalls++ // cada syncFixtures faz exatamente 1 fetch à API Football
        const result = await syncFixtures({
          competitionCode: comp.external_id,
          season: Number(comp.season),
          matchday: matchdayParam,
          apiKey,
          db,
        })
        fixturesUpdated += result?.matches ?? 0
        synced = true
      } catch (err) {
        hadError = true
        logError(
          ae,
          'football_api_error',
          `[poller] Sync falhou comp=${comp.comp_id} round=${round}:`,
          err,
          {
            blobs: [comp.comp_id, round],
          },
        )
      }
    }

    if (synced) {
      await scoreUnprocessedMatches(comp.comp_id, db)
    }
  }

  // matches_checked = nº de (comp, round) na janela ativa — proxy de quantos jogos
  // o run avaliou. Ver convenção de doubles em observability/events.ts.
  logEvent(ae, 'poller_run', {
    blobs: [hadError ? 'error' : 'ok'],
    doubles: [rows.results.length, fixturesUpdated, footballApiCalls, Date.now() - startedAt],
  })

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron pollActiveMatches',
      competitions: byComp.size,
      rounds: rows.results.length,
      total_ms: Date.now() - startedAt,
    }),
  )
}

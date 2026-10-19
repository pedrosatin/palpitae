import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { FD_MAX_CONCURRENT_REQUESTS, runWithConcurrency } from './footballDataQuota'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

type ActiveCompetition = {
  id: string
  external_id: string
  season: string
  provider: string
}

/**
 * Descobre jogos novos das competições ativas. Roda 1x/dia de madrugada via Cron
 * Trigger (ver wrangler.toml), num horário sem jogos pra não competir com o poller.
 *
 * football-data consulta o calendário inteiro, sem matchday. ESPN consulta nove
 * datas individuais, de ontem UTC até hoje UTC + 7 dias, mesmo sem jogos no banco.
 * O upsert atualiza confrontos e horários sem remover jogos fora desse horizonte.
 *
 * Custo sem retries: 1 request por competição football-data e 9 por competição
 * ESPN. As três copas ESPN planejam 27 requests por execução.
 */
export async function discoverFixtures(
  db: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
  now = Date.now(),
): Promise<void> {
  const startedAt = Date.now()

  // Competições não-terminais com provider sincronizável. 'finished' fica de fora —
  // torneio acabado não ganha jogos novos, não vale gastar chamada da API.
  const rows = await db
    .prepare(
      `SELECT id, external_id, season, provider
         FROM competitions
        WHERE status != 'finished'
          AND provider IN ('football-data', 'espn')
          AND external_id IS NOT NULL`,
    )
    .all<ActiveCompetition>()

  if (rows.results.length === 0) {
    console.info('[discovery] Nenhuma competição ativa.')
    logEvent(ae, 'fixture_discovery_run', {
      blobs: ['ok'],
      doubles: [0, 0, 0, Date.now() - startedAt], // competitions, fixtures_updated, api_calls, duration_ms
    })
    return
  }

  const utcDay = new Date(now).setUTCHours(0, 0, 0, 0)
  const espnDates = Array.from({ length: 9 }, (_, i) =>
    new Date(utcDay + (i - 1) * 86_400_000).toISOString().slice(0, 10).replaceAll('-', ''),
  )
  // Requests primárias planejadas, excluindo retries do provedor.
  let plannedApiRequests = 0
  let fixturesUpdated = 0
  let hadError = false

  for (const comp of rows.results) {
    plannedApiRequests += comp.provider === 'espn' ? espnDates.length : 1
  }

  const syncCompetition = async (comp: ActiveCompetition): Promise<void> => {
    try {
      const result = await syncFixtures({
        competitionCode: comp.external_id,
        season: Number(comp.season),
        dates: comp.provider === 'espn' ? espnDates : undefined,
        apiKey,
        db,
      })
      fixturesUpdated += result?.matches ?? 0
      // Pontua jogos que ficaram 'finished' sem scored_at (ex: re-score após
      // correção de placar que o upsert do sync zerou).
      await scoreUnprocessedMatches(comp.id, db)
    } catch (err) {
      hadError = true
      logError(ae, 'football_api_error', `[discovery] Sync falhou comp=${comp.id}:`, err, {
        blobs: ['fixture_discovery', comp.id],
      })
    }
  }

  // Mesmo teto do poller para football-data; ESPN não consome a cota FD.
  const fdComps = rows.results.filter((comp) => comp.provider === 'football-data')
  const espnComps = rows.results.filter((comp) => comp.provider === 'espn')
  await Promise.all([
    runWithConcurrency(FD_MAX_CONCURRENT_REQUESTS, fdComps, syncCompetition),
    Promise.all(espnComps.map(syncCompetition)),
  ])

  logEvent(ae, 'fixture_discovery_run', {
    blobs: [hadError ? 'error' : 'ok'],
    doubles: [rows.results.length, fixturesUpdated, plannedApiRequests, Date.now() - startedAt],
  })

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron discoverFixtures',
      competitions: rows.results.length,
      fixtures_updated: fixturesUpdated,
      sync_tasks: rows.results.length,
      api_requests_planned: plannedApiRequests,
      espn_dates: espnDates,
      total_ms: Date.now() - startedAt,
    }),
  )
}

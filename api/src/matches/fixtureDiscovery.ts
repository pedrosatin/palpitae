import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { createProviderHttpObserver } from '../observability/providerHttp'
import { ESPN_MIN_INTERVAL_MS } from '../providers/espn'
import { reconcileCompetitionStatus } from './competitionLifecycle'
import { ESPN_MAX_CONCURRENT_COMPETITIONS } from './espnQuota'
import { FD_MAX_CONCURRENT_REQUESTS, runWithConcurrency } from './footballDataQuota'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

/**
 * Teto de `match_missing_from_feed` por execução, somando as competições (cada
 * uma tem o próprio teto em `MISSING_EVENTS_PER_COMPETITION`). Mantém a descoberta
 * longe do limite de `writeDataPoint` por invocação; o total real vai em `double6`.
 */
export const MISSING_EVENTS_PER_DISCOVERY = 30

type ActiveCompetition = {
  id: string
  external_id: string
  season: string
  provider: string
}

/**
 * Avança o status da competição depois do sync. Falha do D1 aqui vira
 * `competition_status_error`, separada dos erros de provedor; o status fica
 * como estava e a próxima descoberta tenta de novo. Devolve `false` na falha.
 */
async function advanceCompetitionStatus(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  competitionId: string,
  now: number,
  tbdDiscarded: number,
): Promise<boolean> {
  try {
    const status = await reconcileCompetitionStatus(db, competitionId, now, tbdDiscarded)
    if (status === 'finished') {
      console.info(`[discovery] Competição ${competitionId} encerrada; sai da descoberta diária.`)
    }
    return true
  } catch (err) {
    logError(
      ae,
      'competition_status_error',
      `[discovery] Status da competição não avançou comp=${competitionId}:`,
      err,
      { blobs: [competitionId] },
    )
    return false
  }
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
 * ESPN. Dez competições ESPN-primárias planejam 90 requests por execução, com
 * teto de syncs paralelas (`ESPN_MAX_CONCURRENT_COMPETITIONS`) e pacing HTTP
 * no cliente (~1,3s entre inícios).
 */
export async function discoverFixtures(
  db: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
  now = Date.now(),
): Promise<void> {
  const startedAt = Date.now()

  // Competições não-terminais com provider sincronizável. 'finished' fica de fora:
  // torneio acabado não ganha jogos novos, não vale gastar chamada da API. A
  // coluna só vira 'finished' dias depois do último jogo (`reconcileCompetitionStatus`),
  // e esses dias são a janela de correção do calendário.
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
      // competitions, fixtures_updated, api_calls, duration_ms, events_discarded, matches_missing
      doubles: [0, 0, 0, Date.now() - startedAt, 0, 0],
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
  const missingEvents = { remaining: MISSING_EVENTS_PER_DISCOVERY }
  let eventsDiscarded = 0
  let matchesMissing = 0
  let hadError = false

  for (const comp of rows.results) {
    plannedApiRequests += comp.provider === 'espn' ? espnDates.length : 1
  }

  const syncCompetition = async (comp: ActiveCompetition): Promise<void> => {
    let tbdDiscarded = 0
    try {
      const result = await syncFixtures({
        competitionCode: comp.external_id,
        season: Number(comp.season),
        dates: comp.provider === 'espn' ? espnDates : undefined,
        apiKey,
        db,
        onHttpAttempt: createProviderHttpObserver(ae, {
          context: 'discovery',
          competitionId: comp.id,
        }),
        ae,
        missingEvents,
      })
      fixturesUpdated += result?.matches ?? 0
      eventsDiscarded += result?.discarded ?? 0
      matchesMissing += result?.missing ?? 0
      // Pontua jogos que ficaram 'finished' sem scored_at (ex: re-score após
      // correção de placar que o upsert do sync zerou).
      await scoreUnprocessedMatches(comp.id, db)
      tbdDiscarded = result?.discardedTbd ?? 0
    } catch (err) {
      hadError = true
      logError(ae, 'football_api_error', `[discovery] Sync falhou comp=${comp.id}:`, err, {
        blobs: ['fixture_discovery', comp.id],
      })
      return
    }
    // Só depois de um sync bem-sucedido: o status avança com o calendário atualizado.
    if (!(await advanceCompetitionStatus(db, ae, comp.id, now, tbdDiscarded))) hadError = true
  }

  // football-data compartilha 10 req/min; ESPN tem teto próprio + pacing HTTP.
  const fdComps = rows.results.filter((comp) => comp.provider === 'football-data')
  const espnComps = rows.results.filter((comp) => comp.provider === 'espn')
  await Promise.all([
    runWithConcurrency(FD_MAX_CONCURRENT_REQUESTS, fdComps, syncCompetition),
    runWithConcurrency(ESPN_MAX_CONCURRENT_COMPETITIONS, espnComps, syncCompetition),
  ])

  logEvent(ae, 'fixture_discovery_run', {
    blobs: [hadError ? 'error' : 'ok'],
    doubles: [
      rows.results.length,
      fixturesUpdated,
      plannedApiRequests,
      Date.now() - startedAt,
      eventsDiscarded,
      matchesMissing,
    ],
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
      espn_max_concurrent: ESPN_MAX_CONCURRENT_COMPETITIONS,
      espn_min_interval_ms: ESPN_MIN_INTERVAL_MS,
      total_ms: Date.now() - startedAt,
    }),
  )
}

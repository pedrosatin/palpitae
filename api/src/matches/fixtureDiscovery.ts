import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { createProviderHttpObserver } from '../observability/providerHttp'
import { ESPN_MIN_INTERVAL_MS } from '../providers/espn'
import { ESPN_MAX_CONCURRENT_COMPETITIONS } from './espnQuota'
import { MISSING_EVENTS_PER_DISCOVERY, advanceCompetitionStatus } from './fdWork'
import { espnDatesAround } from './matchPollingWindow'
import { deferProviderWork } from './providerWork'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'
import { runSyncTasks } from './syncTasks'

export { MISSING_EVENTS_PER_DISCOVERY }

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
 * Orçamento compartilhado (ADR-027): toda tentativa football-data reserva vaga
 * na janela de um minuto; o que o orçamento ou a cota recusarem vira item
 * pendente na fila durável, e o cron drenador retoma no mesmo dia — uma
 * competição que falhou não espera a descoberta de amanhã. A ESPN segue direto,
 * com o teto e o pacing próprios.
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
  const espnDates = espnDatesAround(utcDay, -1, 9)
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
        // A tentativa football-data reserva vaga no orçamento compartilhado
        // (ADR-027); a ESPN tem teto e pacing próprios.
        coordinate: comp.provider !== 'espn',
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
      // Qualquer falha vira trabalho pendente: o dreno retoma no mesmo dia, e
      // o progresso da descoberta não espera a de amanhã. Sem vaga ou com cota
      // bloqueada, o prazo segue o reset; nas demais falhas, a espera
      // conservadora.
      await deferProviderWork(
        db,
        {
          kind: 'discovery',
          competitionCode: comp.external_id,
          season: comp.season,
          round: '',
          competitionId: comp.id,
        },
        err,
      )
      hadError = true
      logError(ae, 'football_api_error', `[discovery] Sync falhou comp=${comp.id}:`, err, {
        blobs: ['fixture_discovery', comp.id],
      })
      return
    }
    // Só depois de um sync bem-sucedido: o status avança com o calendário atualizado.
    if (!(await advanceCompetitionStatus(db, ae, comp.id, now, tbdDiscarded))) hadError = true
  }

  await runSyncTasks(rows.results, (comp) => comp.provider, syncCompetition)

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

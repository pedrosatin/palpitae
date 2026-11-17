import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { createProviderHttpObserver } from '../observability/providerHttp'
import { ESPN_MIN_INTERVAL_MS } from '../providers/espn'
import { createEspnDiscoveryGate, isEspnRefusal, readEspnAccessPause } from './espnAccess'
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
 * Controle de acesso da ESPN (ADR-027, adendo do ticket 03): a descoberta é consumidor
 * parcialmente integrado. Cada request da ESPN segue custando 1 chamada, sem reservar
 * vaga por request nem fila, mas a execução lê o estado de acesso antes (1 consulta) e
 * pula a ESPN suspensa ou bloqueada, e só as respostas 401, 403, 429 e 451 são
 * registradas no gate (nenhuma escrita a cada sucesso). A descoberta seguinte tenta
 * de novo. O limite de 50 subrequests por invocação segue sem orçamento aqui.
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

  // ESPN suspensa ou com bloqueio vigente: a execução não a chama (1 consulta, só se há
  // competição da ESPN). Não é erro nem vai para a fila: a descoberta seguinte tenta de novo.
  const espnPause = rows.results.some((comp) => comp.provider === 'espn')
    ? await readEspnAccessPause(db)
    : null
  const espnGate = createEspnDiscoveryGate(db, ae)
  let espnSkipped = 0

  const syncCompetition = async (comp: ActiveCompetition): Promise<void> => {
    if (comp.provider === 'espn' && espnPause) {
      espnSkipped += 1
      console.info(
        `[discovery] ESPN ${espnPause.reason === 'suspended' ? 'suspensa' : 'bloqueada'}: comp=${comp.id} fica para a próxima descoberta.`,
      )
      return
    }
    let tbdDiscarded = 0
    try {
      const result = await syncFixtures({
        competitionCode: comp.external_id,
        season: Number(comp.season),
        dates: comp.provider === 'espn' ? espnDates : undefined,
        apiKey,
        db,
        // A tentativa football-data reserva vaga no orçamento compartilhado
        // (ADR-027); a ESPN tem teto e pacing próprios, e o gate dela só registra as
        // respostas de erro no controle de acesso.
        coordinate: comp.provider !== 'espn',
        espnGate: comp.provider === 'espn' ? espnGate : undefined,
        onHttpAttempt: createProviderHttpObserver(ae, {
          context: 'discovery',
          competitionId: comp.id,
        }),
        ae,
        missingEvents,
      })
      // Data da ESPN que não chegou: a competição inteira falha, como o fetch que lança.
      if (result?.pending) throw result.pending.error
      fixturesUpdated += result?.matches ?? 0
      eventsDiscarded += result?.discarded ?? 0
      matchesMissing += result?.missing ?? 0
      // Pontua jogos que ficaram 'finished' sem scored_at (ex: re-score após
      // correção de placar que o upsert do sync zerou).
      await scoreUnprocessedMatches(comp.id, db)
      tbdDiscarded = result?.discardedTbd ?? 0
    } catch (err) {
      // A ESPN recusou o acesso (o gate registrou a proibição ou já havia bloqueio): não é falha
      // do sync, nem vai para a fila; a descoberta seguinte tenta de novo.
      if (isEspnRefusal(err)) {
        espnSkipped += 1
        console.info(`[discovery] ESPN indisponível comp=${comp.id}: ${err.message}`)
        return
      }
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
      espn_skipped: espnSkipped,
      espn_max_concurrent: ESPN_MAX_CONCURRENT_COMPETITIONS,
      espn_min_interval_ms: ESPN_MIN_INTERVAL_MS,
      total_ms: Date.now() - startedAt,
    }),
  )
}

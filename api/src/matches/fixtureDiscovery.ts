import type { D1Database } from '@cloudflare/workers-types'
import { logError, logEvent } from '../observability/events'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

type ActiveCompetition = {
  id: string
  external_id: string
  season: string
}

/**
 * Descobre jogos novos das competições ativas. Roda 1x/dia de madrugada via Cron
 * Trigger (ver wrangler.toml), num horário sem jogos pra não competir com o poller.
 *
 * Diferente do poller (que busca por matchday da janela ativa), aqui o sync é
 * SEM filtro de matchday: busca o torneio inteiro de cada competição não-terminal.
 * O upsert de `syncFixtures` é idempotente (`ON CONFLICT` por external_id), então:
 *   - confrontos do mata-mata definidos ontem entram como linhas novas hoje
 *   - horários remarcados de jogos já existentes são atualizados
 *   - nada é duplicado
 *
 * Por que sync completo (e não "esperar a rodada acabar"): em torneios curtos os
 * confrontos da próxima fase são agendados gradualmente conforme cada grupo termina.
 * Esperar o último grupo deixaria os primeiros jogos do mata-mata sem tempo de palpite;
 * um jogo adiado travaria a descoberta indefinidamente. O sync diário incondicional
 * pega tudo assim que a API Football disponibiliza, com o máximo de antecedência.
 *
 * Custo: 1 chamada à API Football por competição ativa por dia.
 */
export async function discoverFixtures(
  db: D1Database,
  apiKey: string,
  ae?: AnalyticsEngineDataset,
): Promise<void> {
  const startedAt = Date.now()

  // Competições não-terminais com provider sincronizável. 'finished' fica de fora —
  // torneio acabado não ganha jogos novos, não vale gastar chamada da API.
  const rows = await db
    .prepare(
      `SELECT id, external_id, season
         FROM competitions
        WHERE status != 'finished'
          AND provider = 'football-data'
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

  let footballApiCalls = 0
  let fixturesUpdated = 0
  let hadError = false

  for (const comp of rows.results) {
    try {
      footballApiCalls++ // cada syncFixtures faz exatamente 1 fetch à API Football
      const result = await syncFixtures({
        competitionCode: comp.external_id,
        season: Number(comp.season),
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

  logEvent(ae, 'fixture_discovery_run', {
    blobs: [hadError ? 'error' : 'ok'],
    doubles: [rows.results.length, fixturesUpdated, footballApiCalls, Date.now() - startedAt],
  })

  console.info(
    '[perf]',
    JSON.stringify({
      route: 'cron discoverFixtures',
      competitions: rows.results.length,
      fixtures_updated: fixturesUpdated,
      total_ms: Date.now() - startedAt,
    }),
  )
}

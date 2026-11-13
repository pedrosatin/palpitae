/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RESULT_POLLER_CRON } from '../crons'
import worker from '../index'
import { D1_CALLS_PER_INVOCATION, limitD1Calls } from '../testing/d1CallLimit'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

/**
 * Pontuação sob o limite de 50 chamadas ao D1 por invocação do plano Free. O
 * cron de resultados roda inteiro (`scheduled`: limpeza, planejamento, sync,
 * fallback e pontuação) sobre o SQLite em memória, com um D1 que rejeita a
 * chamada 51. Antes, uma competição com cerca de 4,7 mil palpites passava do
 * limite em todo ciclo, nenhum jogo recebia `scored_at` e a outra competição do
 * mesmo ciclo também ficava sem pontuação.
 */

const KICKOFF = '2026-11-08T15:30:00Z'
/** Dentro da janela ativa do poller (115 a 200 min após o início). */
const NOW = Date.parse(KICKOFF) + 120 * 60_000
const TICK_MS = 30 * 60_000

type Competition = { code: string; id: number; name: string }
const BIG: Competition = { code: 'PPL', id: 2017, name: 'Primeira Liga' }
const SMALL: Competition = { code: 'PD', id: 2014, name: 'La Liga' }

type Seed = Competition & { matches: number; groups: number; members: number }

/** Jogos que a football-data devolve para a competição: agendados ou encerrados. */
function fdMatches(comp: Seed, finished: boolean) {
  return Array.from({ length: comp.matches }, (_, i) => {
    const team = (n: number) => ({
      id: comp.id * 1000 + n,
      name: `Time ${comp.code} ${n}`,
      shortName: `Time ${comp.code} ${n}`,
      tla: 'TIM',
    })
    return {
      id: comp.id * 1000 + i,
      utcDate: KICKOFF,
      status: finished ? 'FINISHED' : 'TIMED',
      matchday: 10,
      stage: 'REGULAR_SEASON',
      group: null,
      homeTeam: team(2 * i),
      awayTeam: team(2 * i + 1),
      score: {
        duration: 'REGULAR',
        fullTime: finished ? { home: i % 3, away: i % 2 } : { home: null, away: null },
      },
    }
  })
}

/** A football-data responde os jogos de cada competição; a ESPN do fallback, nenhum evento. */
function stubProvider(seeds: Seed[]) {
  const provider = { finished: false }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname !== 'api.football-data.org') return Response.json({ events: [] })
      // O sync manual pede pelo código; o poller, pelo id da competição no provedor.
      const comp = seeds.find((seed) =>
        [seed.code, String(seed.id)].some((key) => url.pathname.includes(`/competitions/${key}/`)),
      )
      if (!comp) return Response.json({ matches: [] })
      return Response.json({
        competition: { id: comp.id, code: comp.code, name: comp.name },
        matches: fdMatches(comp, provider.finished),
      })
    }),
  )
  return provider
}

const handles: DatabaseSync[] = []

beforeEach(() => {
  // O poller imprime uma linha `[perf]` por tick.
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Banco com os jogos agendados de cada competição e, em cada uma, `groups`
 * grupos de `members` pessoas com palpite em todos os jogos. Os ids dos
 * palpites saem do id do jogo no provedor, então dois bancos com a mesma
 * semente são comparáveis linha a linha.
 */
async function seedDatabase(seeds: Seed[]) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const ids: Record<string, string> = {}
  for (const seed of seeds) {
    const synced = await syncFixtures({
      competitionCode: seed.code,
      season: 2026,
      db,
      apiKey: 'test',
    })
    const compId = synced.competitionId
    ids[seed.code] = compId
    const code = seed.code
    sqlite.exec(`
      CREATE TEMP TABLE seed_g AS
        WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${seed.groups})
        SELECT i FROM n;
      CREATE TEMP TABLE seed_u AS
        WITH RECURSIVE n(j) AS (SELECT 1 UNION ALL SELECT j + 1 FROM n WHERE j < ${seed.members})
        SELECT j FROM n;
      INSERT INTO users (id, email, provider, provider_id)
        SELECT 'u-${code}-' || i || '-' || j, 'u-${code}-' || i || '-' || j || '@example.test',
               'google', 'g-${code}-' || i || '-' || j
          FROM seed_g, seed_u;
      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, points_exact, points_winner)
        SELECT 'g-${code}-' || i, 'Bolão ' || i, '${compId}', 'u-${code}-' || i || '-1',
               'INV-${code}-' || i,
               CASE WHEN i % 5 = 0 THEN 5 ELSE 3 END, CASE WHEN i % 5 = 0 THEN 2 ELSE 1 END
          FROM seed_g;
      INSERT INTO group_members (id, group_id, user_id)
        SELECT 'gm-${code}-' || i || '-' || j, 'g-${code}-' || i, 'u-${code}-' || i || '-' || j
          FROM seed_g, seed_u;
      INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
        SELECT 'p-' || m.external_id || '-' || i || '-' || j, 'u-${code}-' || i || '-' || j,
               'g-${code}-' || i, m.id,
               (i + j + CAST(m.external_id AS INTEGER)) % 3,
               (i * j + CAST(m.external_id AS INTEGER)) % 2
          FROM matches m, seed_g, seed_u
         WHERE m.competition_id = '${compId}';
      DROP TABLE seed_g;
      DROP TABLE seed_u;
    `)
  }
  return { sqlite, db, ids }
}

type AePoint = { blobs: string[]; doubles: number[] }

function makeEnv(db: D1Database) {
  const writeDataPoint = vi.fn()
  const env = {
    DB: db,
    AE: { writeDataPoint },
    EVENTS: {},
    FOOTBALL_API_KEY: 'test',
    FRONTEND_URL: 'http://localhost:5173',
    JWT_SECRET: 'jwt-secret',
    PROXY_SHARED_SECRET: 'proxy-secret',
    BASE_URL: 'https://api.example.test',
    CF_ACCOUNT_ID: 'account',
    AE_SQL_TOKEN: 'token',
  } as unknown as Env
  /** Eventos do tipo, como `{ blobs, doubles }` sem o tipo em `blobs[0]`. */
  const events = (type: string): AePoint[] =>
    writeDataPoint.mock.calls
      .map(([point]) => point as AePoint)
      .filter((point) => point.blobs[0] === type)
      .map((point) => ({ blobs: point.blobs.slice(1), doubles: point.doubles }))
  return { env, events, clearEvents: () => writeDataPoint.mockClear() }
}

/** Uma invocação do cron de resultados. Devolve as mensagens das rotinas que falharam. */
async function runCycle(env: Env, now: number): Promise<string[]> {
  const pending: Promise<unknown>[] = []
  const ctx = {
    waitUntil: (promise: Promise<unknown>) => void pending.push(promise),
  } as unknown as ExecutionContext
  const controller = { cron: RESULT_POLLER_CRON, scheduledTime: now } as ScheduledController
  await worker.scheduled!(controller, env, ctx)
  const settled = await Promise.allSettled(pending)
  return settled.flatMap((result) =>
    result.status === 'rejected'
      ? [String((result.reason as Error)?.message ?? result.reason)]
      : [],
  )
}

function unscoredMatches(sqlite: DatabaseSync, competitionId: string): number {
  const row = sqlite
    .prepare(`SELECT COUNT(*) AS n FROM matches WHERE competition_id = ? AND scored_at IS NULL`)
    .get(competitionId) as { n: number }
  return row.n
}

/** `scored_at` de cada jogo já pontuado, pelo id do provedor. */
function scoredAt(sqlite: DatabaseSync): Record<string, string> {
  const rows = sqlite
    .prepare(`SELECT external_id, scored_at FROM matches WHERE scored_at IS NOT NULL`)
    .all() as { external_id: string; scored_at: string }[]
  return Object.fromEntries(rows.map((row) => [row.external_id, row.scored_at]))
}

/** Jogos pontuados, pontos de cada palpite e ranking, sem horários nem ids gerados. */
function readScores(sqlite: DatabaseSync) {
  return {
    matches: sqlite
      .prepare(
        `SELECT external_id, scored_at IS NOT NULL AS scored FROM matches ORDER BY external_id`,
      )
      .all(),
    predictions: sqlite
      .prepare(
        `SELECT id, points_awarded, penalty_points, classified_points FROM predictions ORDER BY id`,
      )
      .all(),
    ranking: sqlite
      .prepare(
        `SELECT group_id, user_id, total_points, exact_hits FROM leaderboard
          ORDER BY group_id, user_id`,
      )
      .all(),
  }
}

/** A mesma semente em outro banco, pontuada de uma vez, sem limite de chamadas. */
async function scoreWithoutLimit(seeds: Seed[], provider: { finished: boolean }) {
  provider.finished = false
  const control = await seedDatabase(seeds)
  provider.finished = true
  for (const seed of seeds) {
    await syncFixtures({ competitionCode: seed.code, season: 2026, db: control.db, apiKey: 'test' })
    await scoreUnprocessedMatches(control.ids[seed.code], control.db)
  }
  return readScores(control.sqlite)
}

describe('cron de resultados com 50 chamadas ao D1 por invocação', () => {
  it('competição com 5 mil palpites termina em ciclos sucessivos e a pequena é pontuada no primeiro', async () => {
    const seeds: Seed[] = [
      { ...BIG, matches: 40, groups: 25, members: 5 },
      { ...SMALL, matches: 1, groups: 1, members: 3 },
    ]
    const provider = stubProvider(seeds)
    const { sqlite, db, ids } = await seedDatabase(seeds)
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM predictions`).get()).toEqual({ n: 5003 })
    provider.finished = true

    const limited = limitD1Calls(db)
    const { env } = makeEnv(limited.db)
    const pendingAfterCycle: number[] = []
    let scoredInFirstCycle: Record<string, string> = {}
    for (let cycle = 0; cycle < 6; cycle++) {
      limited.startInvocation()
      const failures = await runCycle(env, NOW + cycle * TICK_MS)

      expect(failures).toEqual([])
      expect(limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
      pendingAfterCycle.push(unscoredMatches(sqlite, ids.PPL))
      if (cycle === 0) {
        // A competição pequena não espera a grande.
        expect(unscoredMatches(sqlite, ids.PD)).toBe(0)
        expect(
          sqlite.prepare(`SELECT COUNT(*) AS n FROM leaderboard WHERE group_id = 'g-PD-1'`).get(),
        ).toEqual({ n: 3 })
        scoredInFirstCycle = scoredAt(sqlite)
      }
      if (pendingAfterCycle[cycle] === 0) break
    }

    // O primeiro ciclo grava parte dos jogos, e os seguintes terminam o resto.
    expect(pendingAfterCycle[0]).toBeGreaterThan(0)
    expect(pendingAfterCycle[0]).toBeLessThan(40)
    expect(pendingAfterCycle.at(-1)).toBe(0)
    // Jogo pontuado num ciclo não é refeito no seguinte.
    expect(scoredAt(sqlite)).toMatchObject(scoredInFirstCycle)

    const unlimited = await scoreWithoutLimit(seeds, provider)
    expect(readScores(sqlite)).toEqual(unlimited)
  })

  it('rodada de 10 jogos com 471 grupos (4,7 mil palpites) é pontuada inteira no primeiro ciclo', async () => {
    const seeds: Seed[] = [
      { ...BIG, matches: 10, groups: 471, members: 1 },
      { ...SMALL, matches: 1, groups: 1, members: 3 },
    ]
    const provider = stubProvider(seeds)
    const { sqlite, db, ids } = await seedDatabase(seeds)
    provider.finished = true

    const limited = limitD1Calls(db)
    const failures = await runCycle(makeEnv(limited.db).env, NOW)

    expect(failures).toEqual([])
    expect(limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
    expect(unscoredMatches(sqlite, ids.PPL)).toBe(0)
    expect(unscoredMatches(sqlite, ids.PD)).toBe(0)

    const unlimited = await scoreWithoutLimit(seeds, provider)
    expect(readScores(sqlite)).toEqual(unlimited)
  })

  it('erro na pontuação de uma competição fica registrado e não impede a outra; o jogo que segue pendente vira evento', async () => {
    const seeds: Seed[] = [
      { ...BIG, matches: 2, groups: 1, members: 2 },
      { ...SMALL, matches: 1, groups: 1, members: 3 },
    ]
    const provider = stubProvider(seeds)
    const { sqlite, db, ids } = await seedDatabase(seeds)
    provider.finished = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // O D1 falha ao gravar os pontos dos palpites de uma das competições.
    sqlite.exec(`
      CREATE TEMP TRIGGER pontuacao_quebrada BEFORE UPDATE OF points_awarded ON predictions
        WHEN OLD.group_id = 'g-PPL-1'
        BEGIN SELECT RAISE(ABORT, 'D1_ERROR: disco cheio'); END;
    `)
    const limited = limitD1Calls(db)
    const { env, events, clearEvents } = makeEnv(limited.db)

    // Ciclo 1: os jogos encerram agora. A falha é de uma competição só.
    expect(await runCycle(env, NOW)).toEqual(['D1_ERROR: disco cheio'])
    expect(unscoredMatches(sqlite, ids.PD)).toBe(0)
    expect(unscoredMatches(sqlite, ids.PPL)).toBe(2)
    expect(events('match_scoring_error')).toEqual([
      { blobs: [ids.PPL, 'D1_ERROR: disco cheio'], doubles: [] },
    ])
    expect(events('poller_run').map((point) => point.blobs)).toEqual([['error']])
    // Ainda não passou um ciclo inteiro desde o resultado.
    expect(events('match_unscored')).toEqual([])

    // Ciclo 2: os dois jogos seguem sem pontuação, 150 minutos depois do início.
    clearEvents()
    limited.startInvocation()
    expect(await runCycle(env, NOW + TICK_MS)).toEqual(['D1_ERROR: disco cheio'])
    expect(events('match_unscored')).toEqual([{ blobs: [ids.PPL], doubles: [2, 150] }])

    // Ciclo 3: o D1 volta, a competição é pontuada e o evento para.
    sqlite.exec(`DROP TRIGGER pontuacao_quebrada`)
    clearEvents()
    limited.startInvocation()
    expect(await runCycle(env, NOW + 2 * TICK_MS)).toEqual([])
    expect(unscoredMatches(sqlite, ids.PPL)).toBe(0)
    expect(events('match_unscored')).toEqual([])
    expect(events('poller_run').map((point) => point.blobs)).toEqual([['ok']])
  })
})

describe('scoreUnprocessedMatches com teto de chamadas', () => {
  /**
   * Mata-mata: ida Flamengo 1-0 e volta Palmeiras 0-0, as duas já pontuadas com o
   * Flamengo classificado. A ida é corrigida para 0-1 (classifica o Palmeiras) e
   * volta a ficar sem `scored_at`. Ana palpitou o Flamengo, Beto o Palmeiras; o
   * classificado vale 2 pontos na volta. Três jogos de liga com 200 palpites cada
   * também esperam pontuação.
   */
  function setupTieAndLeague() {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    sqlite.exec(`
      INSERT INTO competitions (id, name, slug, external_id, provider, season, status)
        VALUES ('c1', 'Copa', 'copa', '9901', 'football-data', '2026', 'ongoing');
      INSERT INTO teams (id, name, slug, external_id, provider) VALUES
        ('t-fla', 'Flamengo', 'flamengo', '101', 'football-data'),
        ('t-pal', 'Palmeiras', 'palmeiras', '102', 'football-data');
      INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id,
          start_time, status, home_score, away_score, phase, round, leg, scored_at) VALUES
        ('leg1', 'c1', 'e1', 'football-data', 't-fla', 't-pal', '2026-08-10T22:00:00Z',
          'finished', 0, 1, 'LAST_16', 'LAST_16', 1, NULL),
        ('leg2', 'c1', 'e2', 'football-data', 't-pal', 't-fla', '2026-08-17T22:00:00Z',
          'finished', 0, 0, 'LAST_16', 'LAST_16', 2, '2026-08-18T00:00:00Z'),
        ('liga1', 'c1', 'e3', 'football-data', 't-fla', 't-pal', '2026-08-20T22:00:00Z',
          'finished', 1, 0, 'REGULAR_SEASON', '1', NULL, NULL),
        ('liga2', 'c1', 'e4', 'football-data', 't-fla', 't-pal', '2026-08-21T22:00:00Z',
          'finished', 1, 0, 'REGULAR_SEASON', '2', NULL, NULL),
        ('liga3', 'c1', 'e5', 'football-data', 't-fla', 't-pal', '2026-08-22T22:00:00Z',
          'finished', 1, 0, 'REGULAR_SEASON', '3', NULL, NULL);
      WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200)
      INSERT INTO users (id, email, provider, provider_id)
        SELECT printf('u%03d', i), printf('u%03d@example.test', i), 'google', printf('g%03d', i)
          FROM n;
      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, points_classified)
        VALUES ('g1', 'Bolão', 'c1', 'u001', 'INV1', 2);
      INSERT INTO group_members (id, group_id, user_id) SELECT id, 'g1', id FROM users;
      INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score,
          predicted_away_score, points_awarded, classified_points) VALUES
        ('a1', 'u001', 'g1', 'leg1', 1, 0, 3, 0), ('a2', 'u001', 'g1', 'leg2', 0, 0, 3, 2),
        ('b1', 'u002', 'g1', 'leg1', 0, 1, 0, 0), ('b2', 'u002', 'g1', 'leg2', 0, 0, 3, 0);
      INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
        SELECT m.id || '-' || u.id, u.id, 'g1', m.id, 1, 0
          FROM matches m, users u WHERE m.id LIKE 'liga%';
    `)
    return { sqlite, db }
  }

  const classified = (sqlite: DatabaseSync) =>
    sqlite
      .prepare(`SELECT id, classified_points FROM predictions WHERE match_id = 'leg2' ORDER BY id`)
      .all()
  const scoredIds = (sqlite: DatabaseSync) =>
    (
      sqlite.prepare(`SELECT id FROM matches WHERE scored_at IS NOT NULL ORDER BY id`).all() as {
        id: string
      }[]
    ).map((row) => row.id)

  it('para quando a próxima gravação não cabe e repontua a volta junto com a ida corrigida', async () => {
    const { sqlite, db } = setupTieAndLeague()
    const counted = limitD1Calls(db, null)

    // Cabe o planejamento e uma gravação: a da ida corrigida, que é o jogo mais
    // antigo, com a volta e o primeiro jogo de liga (206 palpites).
    const first = await scoreUnprocessedMatches('c1', counted.db, 4)

    expect(first).toEqual({ scored: 3, complete: false })
    expect(counted.calls()).toBeLessThanOrEqual(4)
    expect(scoredIds(sqlite)).toEqual(['leg1', 'leg2', 'liga1'])
    // A volta saiu com o classificado da ida corrigida na mesma gravação.
    expect(classified(sqlite)).toEqual([
      { id: 'a2', classified_points: 0 },
      { id: 'b2', classified_points: 2 },
    ])
    expect(
      sqlite
        .prepare(`SELECT user_id, total_points FROM leaderboard ORDER BY user_id LIMIT 2`)
        .all(),
    ).toEqual([
      // Os dois cravam o 0-0 da volta e o 1-0 da liga; só Beto crava a ida e acerta o classificado.
      { user_id: 'u001', total_points: 3 + 3 },
      { user_id: 'u002', total_points: 3 + 3 + 3 + 2 },
    ])

    // A execução seguinte continua de onde a anterior parou e termina.
    const second = await scoreUnprocessedMatches('c1', db)

    expect(second).toEqual({ scored: 2, complete: true })
    expect(scoredIds(sqlite)).toEqual(['leg1', 'leg2', 'liga1', 'liga2', 'liga3'])
    expect(classified(sqlite)).toEqual([
      { id: 'a2', classified_points: 0 },
      { id: 'b2', classified_points: 2 },
    ])
  })

  it('sem chamadas para planejar e gravar uma vez, não consulta o D1', async () => {
    const { sqlite, db } = setupTieAndLeague()
    const counted = limitD1Calls(db, null)

    const outcome = await scoreUnprocessedMatches('c1', counted.db, 3)

    expect(outcome).toEqual({ scored: 0, complete: false })
    expect(counted.calls()).toBe(0)
    expect(scoredIds(sqlite)).toEqual(['leg2'])
  })
})

/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { discoverFixtures } from './fixtureDiscovery'
import { pollActiveMatches } from './poller'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

/**
 * Discovery (06:00 UTC) e poller (:00 e :30) disparam no mesmo minuto e os dois
 * pontuam a mesma competição. Os testes rodam a pontuação de verdade sobre o
 * mesmo SQLite e seguram cada execução antes de gravar pontos, para escolher a
 * ordem das gravações.
 */

const KICKOFF = '2026-11-08T15:30:00Z'
/** Dentro da janela ativa do poller (115 a 200 min após o início). */
const NOW = Date.parse(KICKOFF) + 120 * 60_000

function fdMatch(status: string, home: number | null = null, away: number | null = null) {
  return {
    id: 567348,
    utcDate: KICKOFF,
    status,
    matchday: 10,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: { id: 1, name: 'GD Estoril Praia', shortName: 'Estoril', tla: 'EST' },
    awayTeam: { id: 2, name: 'CS Marítimo', shortName: 'Marítimo', tla: 'MAR' },
    score: { duration: 'REGULAR', fullTime: { home, away } },
  }
}

/** football-data responde `provider.match`; a ESPN do fallback, nenhum evento. */
function stubProvider() {
  const provider = { match: fdMatch('TIMED') }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      if (new URL(String(input)).hostname !== 'api.football-data.org') {
        return Response.json({ events: [] })
      }
      return Response.json({
        competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
        matches: [provider.match],
      })
    }),
  )
  return provider
}

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

/** Jogo agendado no banco e um palpite por placar em `picks`, no mesmo grupo. */
async function setup(picks: [number, number][]) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const provider = stubProvider()
  await syncFixtures({ competitionCode: 'PPL', season: 2026, db, apiKey: 'test' })
  const { id, competition_id } = sqlite.prepare('SELECT id, competition_id FROM matches').get() as {
    id: string
    competition_id: string
  }
  sqlite.exec(`
    WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ${picks.length})
    INSERT INTO users (id, email, provider, provider_id)
      SELECT printf('u%03d', i), printf('u%03d@example.com', i), 'google', printf('g%03d', i) FROM n;
    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
      VALUES ('g1', 'Bolão', '${competition_id}', 'u001', 'INV1');
    INSERT INTO group_members (id, group_id, user_id) SELECT id, 'g1', id FROM users;
  `)
  const insert = sqlite.prepare(
    `INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
     VALUES (?, ?, 'g1', ?, ?, ?)`,
  )
  picks.forEach(([home, away], i) => {
    const n = String(i + 1).padStart(3, '0')
    insert.run(`p${n}`, `u${n}`, id, home, away)
  })
  return { sqlite, db, provider }
}

/** Placar, marcador, pontos de cada palpite e ranking, sem horários. */
function readState(sqlite: DatabaseSync) {
  return {
    match: sqlite
      .prepare(
        `SELECT status, home_score, away_score, scored_at IS NOT NULL AS scored FROM matches`,
      )
      .get(),
    points: sqlite
      .prepare(`SELECT user_id, points_awarded FROM predictions ORDER BY user_id`)
      .all(),
    ranking: sqlite
      .prepare(`SELECT user_id, total_points, exact_hits FROM leaderboard ORDER BY user_id`)
      .all(),
  }
}

/**
 * Segura a execução no primeiro batch que grava pontos de palpite. `reached`
 * resolve quando ela chega lá; `release` deixa seguir.
 */
function checkpoint() {
  let arrive!: () => void
  let release!: () => void
  const reached = new Promise<void>((resolve) => (arrive = resolve))
  const released = new Promise<void>((resolve) => (release = resolve))
  const wait = () => {
    arrive()
    return released
  }
  return { reached, release, wait }
}

/**
 * Segunda conexão ao mesmo banco. Antes do primeiro batch que grava pontos de
 * palpite, espera o checkpoint. Os demais batches passam direto.
 */
function connection(db: D1Database, gate: ReturnType<typeof checkpoint>): D1Database {
  const pointWrites = new WeakSet<object>()
  let held = false
  const wrap = (statement: D1PreparedStatement, writesPoints: boolean): D1PreparedStatement => {
    const wrapped = {
      ...statement,
      bind: (...args: unknown[]) => wrap(statement.bind(...args), writesPoints),
    } as D1PreparedStatement
    if (writesPoints) pointWrites.add(wrapped)
    return wrapped
  }
  return {
    prepare: (sql: string) =>
      wrap(db.prepare(sql), sql.trimStart().startsWith('UPDATE predictions SET points_awarded')),
    batch: async (statements: D1PreparedStatement[]) => {
      if (!held && statements.some((statement) => pointWrites.has(statement))) {
        held = true
        await gate.wait()
      }
      return db.batch(statements)
    },
  } as unknown as D1Database
}

/** Falha simulada do D1 dentro do batch: o SQLite aborta a instrução e o batch volta atrás. */
function failWrites(sqlite: DatabaseSync, table: 'predictions' | 'leaderboard', when = '1') {
  for (const op of ['INSERT', 'UPDATE']) {
    sqlite.exec(`CREATE TEMP TRIGGER fail_${table}_${op.toLowerCase()} BEFORE ${op} ON ${table}
      WHEN ${when} BEGIN SELECT RAISE(ABORT, 'falha simulada'); END`)
  }
}

function stopFailing(sqlite: DatabaseSync, table: 'predictions' | 'leaderboard') {
  sqlite.exec(`DROP TRIGGER fail_${table}_insert; DROP TRIGGER fail_${table}_update`)
}

/** Ana crava 1-0, Beto crava 2-0, Caio aposta no visitante. */
const PICKS: [number, number][] = [
  [1, 0],
  [2, 0],
  [0, 1],
]

const SCORED_1_0 = {
  match: { status: 'finished', home_score: 1, away_score: 0, scored: 1 },
  points: [
    { user_id: 'u001', points_awarded: 3 },
    { user_id: 'u002', points_awarded: 1 },
    { user_id: 'u003', points_awarded: 0 },
  ],
  ranking: [
    { user_id: 'u001', total_points: 3, exact_hits: 1 },
    { user_id: 'u002', total_points: 1, exact_hits: 0 },
    { user_id: 'u003', total_points: 0, exact_hits: 0 },
  ],
}

const SCORED_2_0 = {
  match: { status: 'finished', home_score: 2, away_score: 0, scored: 1 },
  points: [
    { user_id: 'u001', points_awarded: 1 },
    { user_id: 'u002', points_awarded: 3 },
    { user_id: 'u003', points_awarded: 0 },
  ],
  ranking: [
    { user_id: 'u001', total_points: 1, exact_hits: 0 },
    { user_id: 'u002', total_points: 3, exact_hits: 1 },
    { user_id: 'u003', total_points: 0, exact_hits: 0 },
  ],
}

describe('pontuação com discovery e poller ao mesmo tempo', () => {
  it('duas execuções que leram o mesmo resultado dão os pontos e o ranking de uma', async () => {
    const { sqlite, db, provider } = await setup(PICKS)
    provider.match = fdMatch('FINISHED', 1, 0)
    const poller = checkpoint()
    const discovery = checkpoint()

    const runs = Promise.all([
      pollActiveMatches(connection(db, poller), 'test', undefined, NOW),
      discoverFixtures(connection(db, discovery), 'test', undefined, NOW),
    ])
    // Barreira: as duas leram o jogo sem scored_at antes de qualquer gravação.
    await Promise.all([poller.reached, discovery.reached])
    poller.release()
    discovery.release()
    await runs

    expect(readState(sqlite)).toEqual(SCORED_1_0)
  })

  it('correção pontuada pelo discovery no meio do poller fica com os pontos do placar corrigido', async () => {
    const { sqlite, db, provider } = await setup(PICKS)
    provider.match = fdMatch('FINISHED', 1, 0)
    const poller = checkpoint()

    const polling = pollActiveMatches(connection(db, poller), 'test', undefined, NOW)
    await poller.reached // o poller leu 1-0 e ainda não gravou
    provider.match = fdMatch('FINISHED', 2, 0)
    await discoverFixtures(db, 'test', undefined, NOW) // corrige para 2-0 e pontua
    poller.release()
    await polling

    expect(readState(sqlite)).toEqual(SCORED_2_0)
  })

  it('correção que chega antes da gravação do poller deixa o jogo pendente para o próximo tick', async () => {
    const { sqlite, db, provider } = await setup(PICKS)
    provider.match = fdMatch('FINISHED', 1, 0)
    const poller = checkpoint()

    const polling = pollActiveMatches(connection(db, poller), 'test', undefined, NOW)
    await poller.reached // o poller leu 1-0 e ainda não gravou
    provider.match = fdMatch('FINISHED', 2, 0)
    await syncFixtures({ competitionCode: 'PPL', season: 2026, db, apiKey: 'test' }) // só a correção
    poller.release()
    await polling

    expect(readState(sqlite).match).toEqual({
      status: 'finished',
      home_score: 2,
      away_score: 0,
      scored: 0,
    })

    await pollActiveMatches(db, 'test', undefined, NOW)
    expect(readState(sqlite)).toEqual(SCORED_2_0)
  })
})

describe('pontuação após falha parcial', () => {
  it('falha num lote de pontos não marca o jogo, e o retry pontua todos os palpites', async () => {
    // Os pontos dos 120 palpites, o scored_at e o ranking vão na mesma gravação.
    const { sqlite, db, provider } = await setup(Array.from({ length: 120 }, () => [1, 0]))
    provider.match = fdMatch('FINISHED', 1, 0)
    failWrites(sqlite, 'predictions', `OLD.id = 'p001'`)

    await expect(pollActiveMatches(db, 'test', undefined, NOW)).rejects.toThrow('falha simulada')
    expect(readState(sqlite).match).toEqual({
      status: 'finished',
      home_score: 1,
      away_score: 0,
      scored: 0,
    })

    stopFailing(sqlite, 'predictions')
    await pollActiveMatches(db, 'test', undefined, NOW)

    const state = readState(sqlite)
    expect(state.match).toMatchObject({ scored: 1 })
    expect(state.points.filter((row) => row.points_awarded === 3)).toHaveLength(120)
    expect(state.ranking.filter((row) => row.total_points === 3)).toHaveLength(120)
  })

  it('correção de placar com falha no ranking fica pendente, e o retry recalcula tudo', async () => {
    const { sqlite, db, provider } = await setup(PICKS)
    provider.match = fdMatch('FINISHED', 1, 0)
    await pollActiveMatches(db, 'test', undefined, NOW)
    expect(readState(sqlite)).toEqual(SCORED_1_0)

    provider.match = fdMatch('FINISHED', 2, 0)
    failWrites(sqlite, 'leaderboard')
    await discoverFixtures(db, 'test', undefined, NOW) // a falha fica no log da rotina

    const pending = readState(sqlite)
    expect(pending.match).toEqual({ status: 'finished', home_score: 2, away_score: 0, scored: 0 })
    expect(pending.ranking).toEqual(SCORED_1_0.ranking)

    stopFailing(sqlite, 'leaderboard')
    await discoverFixtures(db, 'test', undefined, NOW)

    expect(readState(sqlite)).toEqual(SCORED_2_0)
  })
})

describe('correção da ida enquanto a volta é pontuada', () => {
  /**
   * Ida Flamengo 1-0, volta Palmeiras 0-0: classifica o Flamengo. A correção
   * da ida para 0-1 classifica o Palmeiras. Ana palpitou o Flamengo, Beto o
   * Palmeiras; o classificado vale 2 pontos na volta.
   */
  function setupTie() {
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
          'finished', 1, 0, 'LAST_16', 'LAST_16', 1, '2026-08-11T00:00:00Z'),
        ('leg2', 'c1', 'e2', 'football-data', 't-pal', 't-fla', '2026-08-17T22:00:00Z',
          'finished', 0, 0, 'LAST_16', 'LAST_16', 2, NULL);
      INSERT INTO users (id, email, provider, provider_id) VALUES
        ('u001', 'ana@example.com', 'google', 'g1'), ('u002', 'beto@example.com', 'google', 'g2');
      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, points_classified)
        VALUES ('g1', 'Bolão', 'c1', 'u001', 'INV1', 2);
      INSERT INTO group_members (id, group_id, user_id) SELECT id, 'g1', id FROM users;
      INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score) VALUES
        ('a1', 'u001', 'g1', 'leg1', 1, 0), ('a2', 'u001', 'g1', 'leg2', 0, 0),
        ('b1', 'u002', 'g1', 'leg1', 0, 1), ('b2', 'u002', 'g1', 'leg2', 0, 0);
    `)
    return { sqlite, db }
  }

  it.each([
    ['a execução que leu a ida antiga', true],
    ['a execução que leu a ida corrigida', false],
  ])(
    'o classificado segue a ida corrigida quando %s grava por último',
    async (_last, staleLast) => {
      const { sqlite, db } = setupTie()
      const stale = checkpoint()
      const fresh = checkpoint()

      const staleRun = scoreUnprocessedMatches('c1', connection(db, stale)) // lê a volta com a ida 1-0
      await stale.reached
      // Efeito do upsert do sync numa correção: placar novo e scored_at nulo.
      sqlite.exec(
        `UPDATE matches SET home_score = 0, away_score = 1, scored_at = NULL WHERE id = 'leg1'`,
      )
      const freshRun = scoreUnprocessedMatches('c1', connection(db, fresh)) // lê ida e volta
      await fresh.reached

      const order = staleLast
        ? ([
            [fresh, freshRun],
            [stale, staleRun],
          ] as const)
        : ([
            [stale, staleRun],
            [fresh, freshRun],
          ] as const)
      for (const [gate, run] of order) {
        gate.release()
        await run
      }

      expect(
        sqlite
          .prepare(
            `SELECT id, classified_points FROM predictions WHERE match_id = 'leg2' ORDER BY id`,
          )
          .all(),
      ).toEqual([
        { id: 'a2', classified_points: 0 },
        { id: 'b2', classified_points: 2 },
      ])
      expect(
        sqlite.prepare(`SELECT id, scored_at IS NOT NULL AS scored FROM matches ORDER BY id`).all(),
      ).toEqual([
        { id: 'leg1', scored: 1 },
        { id: 'leg2', scored: 1 },
      ])
      // Os dois cravam o 0-0 da volta; só Beto crava a ida corrigida e acerta o classificado.
      expect(
        sqlite.prepare(`SELECT user_id, total_points FROM leaderboard ORDER BY user_id`).all(),
      ).toEqual([
        { user_id: 'u001', total_points: 3 },
        { user_id: 'u002', total_points: 3 + 3 + 2 },
      ])
    },
  )
})

/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EspnScoreboardEvent } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import { pollActiveMatches } from './poller'
import { scoreUnprocessedMatches } from './scoring'
import { syncFixtures } from './sync'

const KICKOFF = '2026-05-30T19:00:00Z'
/** Dentro da janela ativa do poller (115 a 200 min após o início). */
const NOW = Date.parse(KICKOFF) + 130 * 60_000

type FdScore = {
  winner?: string | null
  duration: string
  fullTime: { home: number | null; away: number | null }
  regularTime?: { home: number; away: number }
  extraTime?: { home: number; away: number }
  penalties?: { home: number; away: number }
}

/** Final da Liga dos Campeões na football-data, jogo único com pênaltis. */
function fdFinal(status: string, score: FdScore) {
  return Response.json({
    competition: { id: 2001, code: 'CL', name: 'UEFA Champions League' },
    matches: [
      {
        id: 600001,
        utcDate: KICKOFF,
        status,
        matchday: null,
        stage: 'FINAL',
        group: null,
        homeTeam: { id: 108, name: 'FC Internazionale Milano', shortName: 'Inter', tla: 'INT' },
        awayTeam: { id: 524, name: 'Paris Saint-Germain FC', shortName: 'PSG', tla: 'PSG' },
        score,
      },
    ],
  })
}

/** A ESPN já encerrou a final empatada; o fallback só lê o placar. */
function espnFinalTied(): EspnScoreboardEvent {
  const type = { name: 'STATUS_FINAL_PEN', state: 'post', completed: true }
  return {
    id: '700001',
    date: KICKOFF,
    status: { type },
    competitions: [
      {
        status: { type },
        competitors: [
          { homeAway: 'home', team: { displayName: 'Internazionale' }, score: '1' },
          { homeAway: 'away', team: { displayName: 'Paris Saint-Germain' }, score: '1' },
        ],
      },
    ],
  } as EspnScoreboardEvent
}

type FootballData = () => Response

function stubProviders(providers: { fd: FootballData }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.football-data.org') return providers.fd()
      const events = url.searchParams.get('dates') === '20260530' ? [espnFinalTied()] : []
      return Response.json({ events })
    }),
  )
}

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

/**
 * Grupo com 2 pontos de classificado e 1 de pênaltis. Ana palpita 1-1 com a Inter
 * nos pênaltis; Beto palpita 2-0 para a Inter.
 */
function seedGroup(sqlite: DatabaseSync, competitionId: string, matchId: string) {
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id) VALUES
      ('u-ana', 'ana@example.com', 'google', 'g-ana'),
      ('u-beto', 'beto@example.com', 'google', 'g-beto');
    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, points_penalty, points_classified)
      VALUES ('g1', 'Bolão', '${competitionId}', 'u-ana', 'INV1', 1, 2);
    INSERT INTO group_members (id, group_id, user_id, role) VALUES
      ('gm-ana', 'g1', 'u-ana', 'owner'), ('gm-beto', 'g1', 'u-beto', 'member');
    INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner)
      VALUES ('p-ana', 'u-ana', 'g1', '${matchId}', 1, 1, 'home'),
             ('p-beto', 'u-beto', 'g1', '${matchId}', 2, 0, NULL);
  `)
}

function readFinal(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `SELECT status, home_score, away_score, penalty_winner, scored_at IS NOT NULL AS scored
         FROM matches`,
    )
    .get()
}

function readPoints(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `SELECT p.user_id, p.points_awarded, p.penalty_points, p.classified_points,
              l.total_points
         FROM predictions p
         LEFT JOIN leaderboard l ON l.group_id = p.group_id AND l.user_id = p.user_id
        ORDER BY p.user_id`,
    )
    .all()
}

describe('mata-mata decisivo empatado sem vencedor dos pênaltis', () => {
  it('fallback da ESPN encerra a final empatada e a pontuação espera o vencedor da football-data', async () => {
    const providers: { fd: FootballData } = {
      fd: () => fdFinal('TIMED', { duration: 'REGULAR', fullTime: { home: null, away: null } }),
    }
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    stubProviders(providers)
    await syncFixtures({ competitionCode: 'CL', season: 2026, db, apiKey: 'test' })
    const match = sqlite.prepare('SELECT id, competition_id FROM matches').get() as {
      id: string
      competition_id: string
    }
    seedGroup(sqlite, match.competition_id, match.id)

    // A football-data ainda mostra o jogo em andamento; a ESPN já tem o 1-1 final.
    providers.fd = () =>
      fdFinal('IN_PLAY', { duration: 'EXTRA_TIME', fullTime: { home: 1, away: 1 } })
    await pollActiveMatches(db, 'test', undefined, NOW)

    expect(readFinal(sqlite)).toEqual({
      status: 'finished',
      home_score: 1,
      away_score: 1,
      penalty_winner: null,
      scored: 0,
    })
    expect(readPoints(sqlite)).toEqual([
      {
        user_id: 'u-ana',
        points_awarded: 0,
        penalty_points: 0,
        classified_points: 0,
        total_points: null,
      },
      {
        user_id: 'u-beto',
        points_awarded: 0,
        penalty_points: 0,
        classified_points: 0,
        total_points: null,
      },
    ])

    // O jogo segue na janela do poller e a football-data traz a disputa de pênaltis.
    providers.fd = () =>
      fdFinal('FINISHED', {
        winner: 'HOME_TEAM',
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 5, away: 4 },
        regularTime: { home: 1, away: 1 },
        extraTime: { home: 0, away: 0 },
        penalties: { home: 4, away: 3 },
      })
    await pollActiveMatches(db, 'test', undefined, NOW + 10 * 60_000)

    const credited = [
      {
        user_id: 'u-ana',
        points_awarded: 3,
        penalty_points: 1,
        classified_points: 2,
        total_points: 6,
      },
      {
        user_id: 'u-beto',
        points_awarded: 0,
        penalty_points: 0,
        classified_points: 2,
        total_points: 2,
      },
    ]
    expect(readFinal(sqlite)).toMatchObject({ penalty_winner: 'home', scored: 1 })
    expect(readPoints(sqlite)).toEqual(credited)

    // Nova pontuação do mesmo resultado não credita de novo.
    await scoreUnprocessedMatches(match.competition_id, db)
    expect(readPoints(sqlite)).toEqual(credited)
  })

  it('volta com agregado empatado espera o vencedor; fase de grupos, ida e volta decidida pontuam', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    sqlite.exec(`
      INSERT INTO competitions (id, name, slug, status, type, penalty_phases, external_id, season, provider)
        VALUES ('c1', 'Copa', 'copa', 'ongoing', 'cup', '["FINAL"]', '9901', '2026', 'football-data');
      INSERT INTO teams (id, name, slug) VALUES
        ('t-a', 'A', 'a'), ('t-b', 'B', 'b'), ('t-c', 'C', 'c'), ('t-d', 'D', 'd');
      INSERT INTO users (id, email, provider, provider_id) VALUES ('u-ana', 'ana@example.com', 'google', 'g-ana');
      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, points_penalty, points_classified)
        VALUES ('g1', 'Bolão', 'c1', 'u-ana', 'INV1', 1, 2);
      INSERT INTO group_members (id, group_id, user_id, role) VALUES ('gm-ana', 'g1', 'u-ana', 'owner');
    `)
    const insertMatch = sqlite.prepare(`INSERT INTO matches
      (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status,
       phase, round, home_score, away_score, locked_at)
      VALUES (?, 'c1', ?, 'football-data', ?, ?, ?, 'finished', ?, ?, ?, ?, ?)`)
    const finished = (
      id: string,
      home: string,
      away: string,
      start: string,
      phase: string,
      score: [number, number],
    ) => insertMatch.run(id, id, home, away, start, phase, phase, score[0], score[1], start)
    finished('grupo', 't-a', 't-b', '2026-03-01T19:00:00Z', 'GROUP_STAGE', [1, 1])
    // A-B: 2-1 na ida, B 1-0 na volta, agregado 2-2.
    finished('ab-ida', 't-a', 't-b', '2026-04-01T19:00:00Z', 'LAST_16', [2, 1])
    finished('ab-volta', 't-b', 't-a', '2026-04-08T19:00:00Z', 'LAST_16', [1, 0])
    // C-D: 1-0 na ida, 1-1 na volta, C avança no agregado.
    finished('cd-ida', 't-c', 't-d', '2026-04-02T19:00:00Z', 'LAST_16', [1, 0])
    finished('cd-volta', 't-d', 't-c', '2026-04-09T19:00:00Z', 'LAST_16', [1, 1])
    const insertPick = sqlite.prepare(`INSERT INTO predictions
      (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score, predicted_penalty_winner)
      VALUES (?, 'u-ana', 'g1', ?, ?, ?, ?)`)
    insertPick.run('p-grupo', 'grupo', 1, 1, null)
    insertPick.run('p-ab-ida', 'ab-ida', 2, 1, null)
    insertPick.run('p-ab-volta', 'ab-volta', 1, 0, 'home')
    insertPick.run('p-cd-ida', 'cd-ida', 1, 0, null)
    insertPick.run('p-cd-volta', 'cd-volta', 1, 1, null)

    const scored = () =>
      Object.fromEntries(
        (
          sqlite.prepare('SELECT id, scored_at IS NOT NULL AS scored FROM matches').all() as {
            id: string
            scored: number
          }[]
        ).map((m) => [m.id, m.scored]),
      )
    const total = () =>
      (
        sqlite.prepare("SELECT total_points FROM leaderboard WHERE user_id = 'u-ana'").get() as {
          total_points: number
        }
      ).total_points

    await scoreUnprocessedMatches('c1', db)

    expect(scored()).toEqual({
      grupo: 1,
      'ab-ida': 1,
      'ab-volta': 0,
      'cd-ida': 1,
      'cd-volta': 1,
    })
    // Placar exato em grupo, ab-ida, cd-ida e cd-volta, mais o classificado de C-D.
    expect(total()).toBe(3 * 4 + 2)

    // B vence nos pênaltis: a volta credita placar, pênaltis e classificado uma vez.
    sqlite.exec("UPDATE matches SET penalty_winner = 'home' WHERE id = 'ab-volta'")
    await scoreUnprocessedMatches('c1', db)
    await scoreUnprocessedMatches('c1', db)

    expect(scored()['ab-volta']).toBe(1)
    expect(
      sqlite
        .prepare(
          "SELECT points_awarded, penalty_points, classified_points FROM predictions WHERE id = 'p-ab-volta'",
        )
        .get(),
    ).toEqual({ points_awarded: 3, penalty_points: 1, classified_points: 2 })
    expect(total()).toBe(3 * 4 + 2 + 3 + 1 + 2)
  })
})

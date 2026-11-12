/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { competitionStatusSql } from './competitionStatus'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

type MatchSeed = {
  phase: string | null
  status: 'scheduled' | 'live' | 'finished'
  leg?: 1 | 2
  startTime?: string
}

type CompetitionSeed = {
  id: string
  type: 'cup' | 'league'
  status: 'upcoming' | 'ongoing' | 'finished'
  provider?: 'football-data' | 'espn'
  matches: MatchSeed[]
}

function openDb() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('alice', 'alice@example.com', 'google', 'g-alice', 'Alice');

    DELETE FROM competitions;

    INSERT INTO teams (id, name, short_name, slug) VALUES
      ('fla', 'Flamengo', 'FLA', 'flamengo'),
      ('pal', 'Palmeiras', 'PAL', 'palmeiras');
  `)
  return { sqlite, db }
}

/** Cria a competição, os jogos e um grupo `group-<id>` com a Alice como membro. */
function seedCompetition(sqlite: DatabaseSync, seed: CompetitionSeed) {
  sqlite
    .prepare(
      `INSERT INTO competitions (id, name, slug, season, status, type, penalty_phases, visibility, provider)
       VALUES (?, ?, ?, '2026', ?, ?, '[]', 'public', ?)`,
    )
    .run(seed.id, seed.id, seed.id, seed.status, seed.type, seed.provider ?? null)

  const insertMatch = sqlite.prepare(
    `INSERT INTO matches (
       id, competition_id, external_id, provider,
       home_team_id, away_team_id, start_time, status, round, phase, postponed, locked_at, leg
     ) VALUES (?, ?, ?, 'football-data', 'fla', 'pal', ?, ?, ?, ?, 0, NULL, ?)`,
  )
  seed.matches.forEach((match, index) => {
    const id = `${seed.id}-m${index}`
    const startTime =
      match.startTime ??
      (match.status === 'finished' ? '2026-06-01T19:00:00Z' : '2099-06-01T19:00:00Z')
    insertMatch.run(
      id,
      seed.id,
      id,
      startTime,
      match.status,
      String(index + 1),
      match.phase,
      match.leg ?? null,
    )
  })

  const groupId = `group-${seed.id}`
  sqlite
    .prepare(
      `INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
       VALUES (?, ?, ?, 'alice', ?)`,
    )
    .run(groupId, groupId, seed.id, `CODE-${seed.id}`)
  sqlite
    .prepare(
      `INSERT INTO group_members (group_id, user_id, joined_at)
       VALUES (?, 'alice', '2026-01-01T00:00:00Z')`,
    )
    .run(groupId)
  return groupId
}

function statusOf(sqlite: DatabaseSync, groupId: string): string | null {
  const row = sqlite
    .prepare(
      `SELECT ${competitionStatusSql('g', 'c')} AS status
       FROM groups g
       LEFT JOIN competitions c ON g.competition_id = c.id
       WHERE g.id = ?`,
    )
    .get(groupId) as { status: string | null }
  return row.status
}

const done = (phase: string | null): MatchSeed => ({ phase, status: 'finished' })
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
/** Jogo encerrado há `days` dias. */
const doneAgo = (phase: string, days: number): MatchSeed => ({
  phase,
  status: 'finished',
  startTime: daysAgo(days),
})
const pending = (phase: string | null): MatchSeed => ({ phase, status: 'scheduled' })

describe('competitionStatusSql', () => {
  it.each<[string, Omit<CompetitionSeed, 'id'>, string]>([
    [
      'copa com a final encerrada',
      { type: 'cup', status: 'upcoming', matches: [done('SEMI_FINALS'), done('THIRD_PLACE'), done('FINAL')] },
      'finished',
    ],
    [
      'copa entre fases, com tudo encerrado e sem final gravada',
      { type: 'cup', status: 'ongoing', matches: [done('QUARTER_FINALS'), done('QUARTER_FINALS')] },
      'ongoing',
    ],
    [
      'copa entre fases com a coluna em upcoming',
      { type: 'cup', status: 'upcoming', matches: [done('GROUP_STAGE'), done('LAST_16')] },
      'upcoming',
    ],
    [
      'Liga dos Campeões depois da fase de liga',
      { type: 'cup', status: 'ongoing', matches: [done('LEAGUE_STAGE'), done('LEAGUE_STAGE')] },
      'ongoing',
    ],
    [
      'final de ida e volta com a volta pendente',
      { type: 'cup', status: 'ongoing', matches: [done('FINAL'), pending('FINAL')] },
      'ongoing',
    ],
    [
      'Gaúcho depois da classificatória',
      { type: 'cup', status: 'ongoing', matches: [done('GROUP_STAGE'), done('RELEGATION_STAGE')] },
      'ongoing',
    ],
    [
      'Gaúcho com o Farroupilha decidido e a final do título por gravar',
      { type: 'cup', status: 'ongoing', matches: [done('SEMI_FINALS'), done('FARROUPILHA_FINAL')] },
      'ongoing',
    ],
    [
      'Mineiro com a final dos playoffs encerrada',
      { type: 'cup', status: 'ongoing', matches: [done('TROFEU_INCONFIDENCIA_FINAL'), done('PLAYOFFS_FINAL')] },
      'finished',
    ],
    [
      'Carioca com a final da Taça Guanabara encerrada',
      { type: 'cup', status: 'ongoing', matches: [done('TACA_RIO_FINAL'), done('TACA_GUANABARA_FINAL')] },
      'finished',
    ],
    [
      'liga sem jogo pendente',
      { type: 'league', status: 'upcoming', matches: [done('REGULAR_SEASON'), done('REGULAR_SEASON')] },
      'finished',
    ],
    [
      'liga com jogo pendente',
      { type: 'league', status: 'ongoing', matches: [done('REGULAR_SEASON'), pending('REGULAR_SEASON')] },
      'ongoing',
    ],
    [
      'final de ida e volta com só a ida gravada',
      {
        type: 'cup',
        status: 'ongoing',
        matches: [done('SEMI_FINALS'), { ...done('FINAL'), leg: 1 }],
      },
      'ongoing',
    ],
    [
      'final de ida e volta com a volta encerrada',
      {
        type: 'cup',
        status: 'ongoing',
        matches: [{ ...done('FINAL'), leg: 1 }, { ...done('FINAL'), leg: 2 }],
      },
      'finished',
    ],
    [
      'liga da ESPN numa pausa do calendário',
      {
        type: 'league',
        status: 'ongoing',
        provider: 'espn',
        matches: [doneAgo('REGULAR_SEASON', 20), doneAgo('REGULAR_SEASON', 12)],
      },
      'ongoing',
    ],
    [
      'liga da ESPN sem jogo novo há mais de 60 dias',
      {
        type: 'league',
        status: 'ongoing',
        provider: 'espn',
        matches: [doneAgo('REGULAR_SEASON', 61)],
      },
      'finished',
    ],
    [
      'liga da football-data sem jogo pendente, com o último jogo recente',
      {
        type: 'league',
        status: 'ongoing',
        provider: 'football-data',
        matches: [doneAgo('REGULAR_SEASON', 2)],
      },
      'finished',
    ],
    ['competição sem jogos', { type: 'cup', status: 'upcoming', matches: [] }, 'upcoming'],
    ['coluna em finished', { type: 'cup', status: 'finished', matches: [done('QUARTER_FINALS')] }, 'finished'],
  ])('%s', (_label, seed, expected) => {
    const { sqlite } = openDb()
    const groupId = seedCompetition(sqlite, { id: 'comp', ...seed })
    expect(statusOf(sqlite, groupId)).toBe(expected)
  })

  it('busca os jogos pelo índice da competição, sem varrer a tabela', () => {
    const { sqlite } = openDb()
    const steps = sqlite
      .prepare(
        `EXPLAIN QUERY PLAN
         SELECT g.id, ${competitionStatusSql('g', 'c')} AS status
         FROM groups g
         LEFT JOIN competitions c ON g.competition_id = c.id`,
      )
      .all()
      .map((row) => String((row as { detail: string }).detail))

    const matchSteps = steps.filter((step) => /^(SCAN|SEARCH) m\b/.test(step))
    expect(matchSteps).toHaveLength(4)
    for (const step of matchSteps) {
      expect(step).toMatch(/^SEARCH m USING (COVERING )?INDEX idx_matches_comp_round_start \(competition_id=\?\)/)
    }
  })
})

async function createApi() {
  const { sqlite, db } = openDb()

  // cup-done e league-done têm todos os jogos encerrados e a coluna status em
  // 'upcoming', como em produção.
  const groups = {
    cupDone: seedCompetition(sqlite, {
      id: 'cup-done',
      type: 'cup',
      status: 'upcoming',
      matches: [done('SEMI_FINALS'), done('FINAL')],
    }),
    cupBetweenPhases: seedCompetition(sqlite, {
      id: 'cup-between',
      type: 'cup',
      status: 'ongoing',
      matches: [done('QUARTER_FINALS'), done('QUARTER_FINALS')],
    }),
    leagueDone: seedCompetition(sqlite, {
      id: 'league-done',
      type: 'league',
      status: 'upcoming',
      matches: [done('REGULAR_SEASON'), done('REGULAR_SEASON')],
    }),
    leagueLive: seedCompetition(sqlite, {
      id: 'league-live',
      type: 'league',
      status: 'ongoing',
      matches: [done('REGULAR_SEASON'), pending('REGULAR_SEASON')],
    }),
  }

  const env: Env = {
    DB: db,
    JWT_SECRET: 'test-competition-status-secret',
    ADMIN_EMAIL: 'admin@palpitae.com.br',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    RESEND_API_KEY: 'test-resend',
  }

  const token = await signJwt(
    { sub: 'alice', email: 'alice@example.com', jti: 'jti-alice' },
    env.JWT_SECRET,
    3600,
  )

  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  async function getJson<T>(path: string): Promise<T> {
    const response = await worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method: 'GET',
        headers: { Cookie: `session=${token}`, 'CF-Connecting-IP': '192.0.2.41' },
      }),
      env,
      ctx,
    )
    expect(response.status).toBe(200)
    return (await response.json()) as T
  }

  return { groups, getJson }
}

type Status = { competition_status: string | null }

describe('competition_status dos grupos', () => {
  it('GET /groups e GET /groups/:id concordam no status', async () => {
    const { groups, getJson } = await createApi()

    const list = await getJson<{ groups: Array<Status & { id: string }> }>('/groups')
    const fromList = Object.fromEntries(list.groups.map((g) => [g.id, g.competition_status]))

    const fromDetail: Record<string, string | null> = {}
    for (const id of Object.values(groups)) {
      const detail = await getJson<{ group: Status }>(`/groups/${id}`)
      fromDetail[id] = detail.group.competition_status
    }

    const expected = {
      [groups.cupDone]: 'finished',
      [groups.cupBetweenPhases]: 'ongoing',
      [groups.leagueDone]: 'finished',
      [groups.leagueLive]: 'ongoing',
    }
    expect(fromList).toEqual(expected)
    expect(fromDetail).toEqual(expected)
  })
})

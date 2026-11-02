import { beforeEach, describe, expect, it } from 'vitest'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { createSqliteD1 } from '../testing/sqliteD1'
import { MATCH_UPSERT_SQL } from './sync'

// O sync reenvia a rodada inteira a cada tick. O upsert só pode gravar quando
// algum campo muda, sem perder nenhuma das regras do DO UPDATE.

const NOW = '2026-11-02T20:00:00Z'

type Row = {
  startTime: string
  status: 'scheduled' | 'live' | 'finished'
  homeScore: number | null
  awayScore: number | null
  groupName: string | null
  duration: string | null
  penaltyWinner: string | null
  homePenaltyGoals: number | null
  awayPenaltyGoals: number | null
  postponed: number
  lockedAt: string | null
  leg: number | null
}

const base: Row = {
  startTime: '2026-11-10T19:00:00Z',
  status: 'scheduled',
  homeScore: null,
  awayScore: null,
  groupName: null,
  duration: null,
  penaltyWinner: null,
  homePenaltyGoals: null,
  awayPenaltyGoals: null,
  postponed: 0,
  lockedAt: null,
  leg: null,
}

let sqlite: DatabaseSync

function upsert(row: Row): number {
  const binds: SQLInputValue[] = [
    crypto.randomUUID(),
    'comp-1',
    'ext-1',
    'football-data',
    'team-h',
    'team-a',
    row.startTime,
    row.status,
    row.homeScore,
    row.awayScore,
    'REGULAR_SEASON',
    '1',
    row.groupName,
    row.duration,
    row.penaltyWinner,
    row.homePenaltyGoals,
    row.awayPenaltyGoals,
    row.postponed,
    row.lockedAt,
    row.leg,
    NOW,
  ]
  return Number(sqlite.prepare(MATCH_UPSERT_SQL).run(...binds).changes)
}

function stored() {
  return sqlite
    .prepare(
      `SELECT start_time, status, home_score, away_score, postponed, locked_at, scored_at
       FROM matches WHERE external_id = 'ext-1'`,
    )
    .get() as Record<string, unknown>
}

beforeEach(() => {
  sqlite = createSqliteD1().sqlite
  sqlite.exec(`
    INSERT INTO competitions (id, name, slug, status) VALUES ('comp-1', 'Liga', 'liga', 'ongoing');
    INSERT INTO teams (id, name, short_name, slug, external_id, provider)
      VALUES ('team-h', 'Casa', 'CAS', 'casa', 'h', 'football-data'),
             ('team-a', 'Fora', 'FOR', 'fora', 'a', 'football-data');
  `)
})

describe('MATCH_UPSERT_SQL sem mudança não grava', () => {
  it('reenviar o mesmo jogo agendado não grava', () => {
    expect(upsert(base)).toBe(1)
    expect(upsert(base)).toBe(0)
  })

  it('reenviar o mesmo jogo encerrado e já travado não grava', () => {
    const finished = { ...base, status: 'finished' as const, homeScore: 2, awayScore: 1, lockedAt: NOW }
    upsert(finished)
    sqlite.exec(`UPDATE matches SET scored_at = '${NOW}'`)
    expect(upsert(finished)).toBe(0)
    expect(stored().scored_at).toBe(NOW)
  })

  it('jogo adiado com o placeholder de horário do provider não grava de novo', () => {
    upsert({ ...base, postponed: 1 })
    expect(upsert({ ...base, postponed: 1, startTime: '2026-11-10T00:00:00Z' })).toBe(0)
    expect(stored().start_time).toBe(base.startTime)
  })
})

describe('MATCH_UPSERT_SQL com mudança grava', () => {
  const changes: Array<[string, Partial<Row>]> = [
    ['start_time', { startTime: '2026-11-11T19:00:00Z' }],
    ['status', { status: 'live', lockedAt: NOW }],
    ['postponed', { postponed: 1 }],
    ['placar', { homeScore: 0, awayScore: 0 }],
    ['group_name', { groupName: 'GROUP_A' }],
    ['leg', { leg: 2 }],
    ['duration', { duration: 'PENALTY_SHOOTOUT' }],
    ['penalty_winner', { penaltyWinner: 'home' }],
    ['pênaltis da casa', { homePenaltyGoals: 4 }],
    ['pênaltis de fora', { awayPenaltyGoals: 3 }],
  ]

  it.each(changes)('%s', (_, change) => {
    upsert(base)
    expect(upsert({ ...base, ...change })).toBe(1)
  })

  it('locked_at chega do provider com o resto igual', () => {
    upsert(base)
    expect(upsert({ ...base, lockedAt: NOW })).toBe(1)
    expect(stored().locked_at).toBe(NOW)
  })

  it('jogo já live localmente sem locked_at é travado mesmo sem mudança do provider', () => {
    upsert(base)
    sqlite.exec(`UPDATE matches SET status = 'live'`)
    expect(upsert({ ...base, status: 'live' })).toBe(1)
    expect(stored().locked_at).toBe(NOW)
    expect(upsert({ ...base, status: 'live' })).toBe(0)
  })

  it('correção de placar depois de pontuado limpa scored_at', () => {
    const finished = { ...base, status: 'finished' as const, homeScore: 3, awayScore: 0, lockedAt: NOW }
    upsert(finished)
    sqlite.exec(`UPDATE matches SET scored_at = '${NOW}'`)
    expect(upsert({ ...finished, homeScore: 4 })).toBe(1)
    expect(stored()).toMatchObject({ home_score: 4, scored_at: null })
  })

  it('resposta atrasada não desfaz resultado final', () => {
    const finished = { ...base, status: 'finished' as const, homeScore: 1, awayScore: 1, lockedAt: NOW }
    upsert(finished)
    expect(upsert({ ...base, status: 'live', lockedAt: NOW })).toBe(0)
    expect(stored().status).toBe('finished')
  })
})

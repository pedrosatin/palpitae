/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import adiadoJson from '../providers/__fixtures__/espn-por-1-adiado-scoreboard.json'
import type { EspnCompetitionStatusType, EspnScoreboardEvent } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import { isMatchLocked } from './locking'
import { pollActiveMatches } from './poller'
import { syncFixtures } from './sync'

/**
 * Evento real da ESPN para Estoril × Marítimo, da Primeira Liga, consultado em
 * 10/11/2026 em `por.1` com `dates=20261108`. Ele chega como STATUS_POSTPONED,
 * com state 'post', completed false e placar 0-0. Em produção o fallback gravou
 * esse jogo como finished 0-0 e a pontuação rodou.
 */
const ADIADO = (adiadoJson as { events: EspnScoreboardEvent[] }).events[0]

const KICKOFF = '2026-11-08T15:30:00Z'
const NEW_KICKOFF = '2026-12-02T20:15:00Z'

const SCHEDULED: EspnCompetitionStatusType = {
  name: 'STATUS_SCHEDULED',
  state: 'pre',
  completed: false,
}
/** Mesmo `type` de Santa Clara × Gil Vicente, encerrado no scoreboard do mesmo dia. */
const FULL_TIME: EspnCompetitionStatusType = {
  name: 'STATUS_FULL_TIME',
  state: 'post',
  completed: true,
}
/** Cancelado montado pelo formato do adiado; o nome decide mesmo com completed true. */
const canceled = (completed: boolean): EspnCompetitionStatusType => ({
  name: 'STATUS_CANCELED',
  state: 'post',
  completed,
})

/** O evento real com outro status e, na remarcação, outra data. Placar segue 0-0. */
function espnEvent(status: EspnCompetitionStatusType, iso = KICKOFF): EspnScoreboardEvent {
  const ev = structuredClone(ADIADO)
  const date = iso.replace(':00Z', 'Z')
  ev.date = date
  ev.status = { type: status }
  const comp = ev.competitions?.[0]
  if (comp) {
    comp.date = date
    comp.status = { type: status }
  }
  return ev
}

function fdMatch(status: string, utcDate = KICKOFF) {
  return {
    id: 567348,
    utcDate,
    status,
    matchday: 10,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: { id: 1, name: 'GD Estoril Praia', shortName: 'Estoril', tla: 'EST' },
    awayTeam: { id: 2, name: 'CS Marítimo', shortName: 'Marítimo', tla: 'MAR' },
    score: { duration: 'REGULAR', fullTime: { home: null, away: null } },
  }
}

type Providers = { fd: ReturnType<typeof fdMatch>; espn: EspnScoreboardEvent[] }

/** football-data responde `providers.fd`; a ESPN, os eventos do dia UTC pedido. */
function stubProviders(providers: Providers) {
  const espnDates: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.football-data.org') {
        return Response.json({
          competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
          matches: [providers.fd],
        })
      }
      const day = url.searchParams.get('dates') ?? ''
      espnDates.push(day)
      const events = providers.espn.filter(
        (ev) => String(ev.date).slice(0, 10).replaceAll('-', '') === day,
      )
      return Response.json({ events })
    }),
  )
  return espnDates
}

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  return { sqlite, db }
}

/** Palpite 0-0 num grupo da competição. Ele pontuaria 3 se o adiado virasse 0-0 final. */
function seedPrediction(sqlite: DatabaseSync) {
  const match = sqlite.prepare('SELECT id, competition_id FROM matches').get() as {
    id: string
    competition_id: string
  }
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id) VALUES ('u1', 'u1@example.com', 'google', 'g1');
    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
      VALUES ('g1', 'Bolão', '${match.competition_id}', 'u1', 'INV1');
    INSERT INTO group_members (id, group_id, user_id, role) VALUES ('gm1', 'g1', 'u1', 'owner');
    INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
      VALUES ('p1', 'u1', 'g1', '${match.id}', 0, 0);
  `)
}

type MatchState = {
  start_time: string
  status: string
  postponed: number
  home_score: number | null
  away_score: number | null
  scored_at: string | null
  locked_at: string | null
  points_awarded: number
}

function readMatch(sqlite: DatabaseSync): MatchState {
  return sqlite
    .prepare(
      `SELECT m.start_time, m.status, m.postponed, m.home_score, m.away_score, m.scored_at,
              m.locked_at, p.points_awarded
         FROM matches m JOIN predictions p ON p.match_id = m.id`,
    )
    .get() as MatchState
}

/** Dentro da janela ativa do poller (115 a 200 min após o início). */
const inWindow = (iso: string) => Date.parse(iso) + 120 * 60_000

const OPEN_AND_UNSCORED = {
  status: 'scheduled',
  postponed: 1,
  home_score: null,
  away_score: null,
  scored_at: null,
  locked_at: null,
  points_awarded: 0,
}

function expectOpen(row: MatchState, now: number) {
  expect(row).toMatchObject(OPEN_AND_UNSCORED)
  expect(isMatchLocked(row, new Date(now).toISOString())).toBe(false)
}

const NOT_PLAYED = [
  ['adiado (payload real)', 'POSTPONED', ADIADO],
  ['cancelado', 'CANCELLED', espnEvent(canceled(false))],
  ['cancelado com completed true', 'CANCELLED', espnEvent(canceled(true))],
] as const

describe('jogo adiado na ESPN: fallback de resultados da football-data', () => {
  it.each(NOT_PLAYED)(
    '%s com state post e 0-0 continua aberto e sem pontos',
    async (_label, fdStatus, event) => {
      const { sqlite, db } = setup()
      const providers: Providers = { fd: fdMatch('TIMED'), espn: [event] }
      const espnDates = stubProviders(providers)
      await syncFixtures({ competitionCode: 'PPL', season: 2026, db, apiKey: 'test' })
      seedPrediction(sqlite)

      providers.fd = fdMatch(fdStatus)
      await pollActiveMatches(db, 'test', undefined, inWindow(KICKOFF))

      expect(espnDates).toContain('20261108')
      expectOpen(readMatch(sqlite), inWindow(KICKOFF))
    },
  )

  it('remarcado recebe a data nova e o 0-0 disputado encerra e pontua', async () => {
    const { sqlite, db } = setup()
    const providers: Providers = { fd: fdMatch('TIMED'), espn: [ADIADO] }
    stubProviders(providers)
    const options = { competitionCode: 'PPL', season: 2026, db, apiKey: 'test' }
    await syncFixtures(options)
    seedPrediction(sqlite)
    providers.fd = fdMatch('POSTPONED')
    await pollActiveMatches(db, 'test', undefined, inWindow(KICKOFF))

    providers.fd = fdMatch('TIMED', NEW_KICKOFF)
    await syncFixtures(options)
    expect(readMatch(sqlite)).toMatchObject({
      start_time: NEW_KICKOFF,
      status: 'scheduled',
      postponed: 0,
    })

    // O primário atrasa o resultado; a ESPN já marca fim de jogo 0-0 na data nova.
    providers.espn = [espnEvent(FULL_TIME, NEW_KICKOFF)]
    await pollActiveMatches(db, 'test', undefined, inWindow(NEW_KICKOFF))

    expect(readMatch(sqlite)).toMatchObject({
      status: 'finished',
      home_score: 0,
      away_score: 0,
      scored_at: expect.any(String),
      points_awarded: 3,
    })
  })
})

describe('jogo adiado na ESPN: sync primário ESPN', () => {
  const options = (db: D1Database, day: string) => ({
    competitionCode: 'bra.2',
    season: 2026,
    dates: [day],
    db,
  })

  it.each(NOT_PLAYED)(
    '%s com state post e 0-0 continua aberto, sem travar e sem pontos',
    async (_label, _fdStatus, event) => {
      const { sqlite, db } = setup()
      const providers: Providers = { fd: fdMatch('TIMED'), espn: [espnEvent(SCHEDULED)] }
      const espnDates = stubProviders(providers)
      await syncFixtures(options(db, '20261108'))
      seedPrediction(sqlite)

      providers.espn = [event]
      await pollActiveMatches(db, 'unused-key', undefined, inWindow(KICKOFF))

      expect(espnDates.filter((day) => day === '20261108')).toHaveLength(2)
      expectOpen(readMatch(sqlite), inWindow(KICKOFF))
    },
  )

  it('remarcado recebe a data nova e o 0-0 disputado encerra e pontua', async () => {
    const { sqlite, db } = setup()
    const providers: Providers = { fd: fdMatch('TIMED'), espn: [espnEvent(SCHEDULED)] }
    stubProviders(providers)
    await syncFixtures(options(db, '20261108'))
    seedPrediction(sqlite)
    providers.espn = [ADIADO]
    await pollActiveMatches(db, 'unused-key', undefined, inWindow(KICKOFF))

    providers.espn = [espnEvent(SCHEDULED, NEW_KICKOFF)]
    await syncFixtures(options(db, '20261202'))
    expect(readMatch(sqlite)).toMatchObject({
      start_time: NEW_KICKOFF,
      status: 'scheduled',
      postponed: 0,
      locked_at: null,
    })

    providers.espn = [espnEvent(FULL_TIME, NEW_KICKOFF)]
    await pollActiveMatches(db, 'unused-key', undefined, inWindow(NEW_KICKOFF))

    expect(readMatch(sqlite)).toMatchObject({
      status: 'finished',
      home_score: 0,
      away_score: 0,
      scored_at: expect.any(String),
      locked_at: expect.any(String),
      points_awarded: 3,
    })
  })
})

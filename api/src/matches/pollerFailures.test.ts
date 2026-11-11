/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import adiadoJson from '../providers/__fixtures__/espn-por-1-adiado-scoreboard.json'
import type { EspnScoreboardEvent } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import { pollActiveMatches } from './poller'
import { syncFixtures } from './sync'

const KICKOFF = '2026-11-08T15:30:00Z'
/** Dentro da janela ativa do poller (115 a 200 min após o início). */
const NOW = Date.parse(KICKOFF) + 120 * 60_000

/** Estoril × Marítimo real da ESPN, aqui como jogo encerrado em 0-0. */
function espnFullTime(): EspnScoreboardEvent {
  const ev = structuredClone((adiadoJson as { events: EspnScoreboardEvent[] }).events[0])
  const type = { name: 'STATUS_FULL_TIME', state: 'post', completed: true }
  ev.status = { type }
  const comp = ev.competitions?.[0]
  if (comp) comp.status = { type }
  return ev
}

function fdResponse(status: string, home: number | null, away: number | null) {
  return Response.json({
    competition: { id: 2017, code: 'PPL', name: 'Primeira Liga' },
    matches: [
      {
        id: 567348,
        utcDate: KICKOFF,
        status,
        matchday: 10,
        stage: 'REGULAR_SEASON',
        group: null,
        homeTeam: { id: 1, name: 'GD Estoril Praia', shortName: 'Estoril', tla: 'EST' },
        awayTeam: { id: 2, name: 'CS Marítimo', shortName: 'Marítimo', tla: 'MAR' },
        score: { duration: 'REGULAR', fullTime: { home, away } },
      },
    ],
  })
}

/** Request que nunca responde: só termina se quem chamou abortar pelo `signal`. */
function hangingFetch(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
  })
}

type FootballData = (init?: RequestInit) => Response | Promise<Response>

/** A football-data responde `providers.fd`; a ESPN devolve o jogo encerrado no dia dele. */
function stubProviders(providers: { fd: FootballData }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.football-data.org') return providers.fd(init)
      const events = url.searchParams.get('dates') === '20261108' ? [espnFullTime()] : []
      return Response.json({ events })
    }),
  )
}

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Jogo agendado vindo da football-data e um palpite 0-0 num grupo da competição. */
async function setup(providers: { fd: FootballData }) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  stubProviders(providers)
  await syncFixtures({ competitionCode: 'PPL', season: 2026, db, apiKey: 'test' })
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
  return { sqlite, db }
}

function fakeAe() {
  const writeDataPoint = vi.fn()
  const pollerRuns = () =>
    writeDataPoint.mock.calls
      .map(([point]) => (point as { blobs: string[] }).blobs)
      .filter((blobs) => blobs[0] === 'poller_run')
      .map((blobs) => blobs[1])
  return { ae: { writeDataPoint } as unknown as AnalyticsEngineDataset, pollerRuns }
}

function readMatch(sqlite: DatabaseSync) {
  return sqlite
    .prepare(
      `SELECT m.status, m.home_score, m.away_score, m.scored_at IS NOT NULL AS scored,
              p.points_awarded
         FROM matches m JOIN predictions p ON p.match_id = m.id`,
    )
    .get()
}

describe('poller: falhas que precisam aparecer', () => {
  it('football-data pendurada aborta no timeout e o tick segue para o fallback e a pontuação', async () => {
    const providers: { fd: FootballData } = { fd: () => fdResponse('TIMED', null, null) }
    const { sqlite, db } = await setup(providers)
    const { ae, pollerRuns } = fakeAe()

    // O timeout de produção é de segundos. Aqui todo `AbortSignal.timeout` vence em 20 ms.
    const realTimeout = AbortSignal.timeout.bind(AbortSignal)
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(20))
    providers.fd = hangingFetch

    await pollActiveMatches(db, 'test', ae, NOW)

    expect(readMatch(sqlite)).toEqual({
      status: 'finished',
      home_score: 0,
      away_score: 0,
      scored: 1,
      points_awarded: 3,
    })
    expect(pollerRuns()).toEqual(['error'])
  })

  it('erro de D1 na pontuação grava poller_run com erro antes de relançar', async () => {
    const providers: { fd: FootballData } = { fd: () => fdResponse('TIMED', null, null) }
    const { sqlite, db } = await setup(providers)
    const { ae, pollerRuns } = fakeAe()

    // A pontuação falha no D1 ao gravar os pontos do palpite.
    sqlite.exec(`
      CREATE TRIGGER pontuacao_quebrada BEFORE UPDATE OF points_awarded ON predictions
      BEGIN SELECT RAISE(ABORT, 'D1_ERROR: disco cheio'); END;
    `)
    providers.fd = () => fdResponse('FINISHED', 0, 0)

    await expect(pollActiveMatches(db, 'test', ae, NOW)).rejects.toThrow('D1_ERROR: disco cheio')

    expect(pollerRuns()).toEqual(['error'])
    expect(readMatch(sqlite)).toMatchObject({ status: 'finished', scored: 0, points_awarded: 0 })
  })
})

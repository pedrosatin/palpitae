/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import adiadoJson from '../providers/__fixtures__/espn-por-1-adiado-scoreboard.json'
import suspensoJson from '../providers/__fixtures__/espn-esp-1-suspenso-scoreboard.json'
import canceladoJson from '../providers/__fixtures__/football-data-pd-cancelado-match.json'
import type { EspnCompetitionStatusType, EspnScoreboardEvent } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import { pollActiveMatches } from './poller'
import { syncFixtures } from './sync'

/**
 * Ciclo de vida de uma partida visto pelos dois provedores. Cada cenário passa a
 * mesma sequência de estados pela football-data e pela ESPN primária e compara as
 * colunas que `GET /matches` expõe (status, adiado, travamento, placar e horário).
 * A tabela de transições está em docs/architecture/schema.md.
 */

const KICKOFF = '2026-11-08T15:30:00Z'
const NEW_KICKOFF = '2026-12-02T20:15:00Z'
/** Instante de todos os syncs do ciclo, uma hora antes do kickoff, para que adiado e cancelado sejam vistos antes do horário. */
const SYNC_NOW = '2026-11-08T14:30:00Z'

type Score = [number, number] | null

/** Um estado do jogo, como cada provedor o descreve. */
type Step = {
  label: string
  fd: { status: string; score: Score; utcDate?: string }
  espn: { type: EspnCompetitionStatusType; score: Score; date?: string }
}

const espnType = (name: string, state: string, completed = false) => ({ name, state, completed })

const ESPN_SCHEDULED = espnType('STATUS_SCHEDULED', 'pre')
const ESPN_IN_PLAY = espnType('STATUS_SECOND_HALF', 'in')
const ESPN_EXTRA_TIME = espnType('STATUS_OVERTIME', 'in')
const ESPN_FULL_TIME = espnType('STATUS_FULL_TIME', 'post', true)
const ESPN_POSTPONED = espnType('STATUS_POSTPONED', 'post')
const ESPN_CANCELED = espnType('STATUS_CANCELED', 'post')
const ESPN_SUSPENDED = espnType('STATUS_SUSPENDED', 'post')

const AGENDADO: Step = {
  label: 'agendado',
  fd: { status: 'TIMED', score: null },
  espn: { type: ESPN_SCHEDULED, score: null },
}
const EM_ANDAMENTO: Step = {
  label: 'em andamento 1-0',
  fd: { status: 'IN_PLAY', score: [1, 0] },
  espn: { type: ESPN_IN_PLAY, score: [1, 0] },
}
const PRORROGACAO: Step = {
  label: 'na prorrogação 1-1',
  fd: { status: 'EXTRA_TIME', score: [1, 1] },
  espn: { type: ESPN_EXTRA_TIME, score: [1, 1] },
}
const ENCERRADO_2_1: Step = {
  label: 'encerrado 2-1',
  fd: { status: 'FINISHED', score: [2, 1] },
  espn: { type: ESPN_FULL_TIME, score: [2, 1] },
}
const CORRIGIDO_3_1: Step = {
  label: 'final corrigido para 3-1',
  fd: { status: 'FINISHED', score: [3, 1] },
  espn: { type: ESPN_FULL_TIME, score: [3, 1] },
}
const ENCERRADO_SEM_PLACAR: Step = {
  label: 'encerrado sem placar',
  fd: { status: 'FINISHED', score: null },
  espn: { type: ESPN_FULL_TIME, score: null },
}
/** A football-data manda 0-0 em adiado e cancelado (ver o payload real abaixo). */
const ADIADO_0_0: Step = {
  label: 'adiado com 0-0',
  fd: { status: 'POSTPONED', score: [0, 0], utcDate: '2026-11-08T00:00:00Z' },
  espn: { type: ESPN_POSTPONED, score: [0, 0] },
}
const CANCELADO_0_0: Step = {
  label: 'cancelado com 0-0',
  fd: { status: 'CANCELLED', score: [0, 0] },
  espn: { type: ESPN_CANCELED, score: [0, 0] },
}
const SUSPENSO_0_0: Step = {
  label: 'suspenso com 0-0',
  fd: { status: 'SUSPENDED', score: [0, 0] },
  espn: { type: ESPN_SUSPENDED, score: [0, 0] },
}
const REMARCADO: Step = {
  label: 'remarcado',
  fd: { status: 'TIMED', score: null, utcDate: NEW_KICKOFF },
  espn: { type: ESPN_SCHEDULED, score: null, date: NEW_KICKOFF },
}

type Projection = {
  start_time: string
  status: string
  postponed: number
  locked: boolean
  home_score: number | null
  away_score: number | null
}

const projection = (overrides: Partial<Projection>): Projection => ({
  start_time: KICKOFF,
  status: 'scheduled',
  postponed: 0,
  locked: false,
  home_score: null,
  away_score: null,
  ...overrides,
})

const ESPN_TEMPLATE = (adiadoJson as { events: EspnScoreboardEvent[] }).events[0]

function espnEvent(step: Step['espn']): EspnScoreboardEvent {
  const ev = structuredClone(ESPN_TEMPLATE)
  const date = (step.date ?? KICKOFF).replace(':00Z', 'Z')
  ev.date = date
  ev.status = { type: step.type }
  const comp = ev.competitions?.[0]
  if (comp) {
    comp.date = date
    comp.status = { type: step.type }
    comp.competitors?.forEach((competitor, i) => {
      competitor.score = step.score ? String(step.score[i]) : undefined
    })
  }
  return ev
}

function fdMatch(step: Step['fd']) {
  return {
    id: 567348,
    utcDate: step.utcDate ?? KICKOFF,
    status: step.status,
    matchday: 10,
    stage: 'REGULAR_SEASON',
    group: null,
    homeTeam: { id: 1, name: 'GD Estoril Praia', shortName: 'Estoril', tla: 'EST' },
    awayTeam: { id: 2, name: 'CS Marítimo', shortName: 'Marítimo', tla: 'MAR' },
    score: {
      winner: null,
      duration: 'REGULAR',
      fullTime: { home: step.score?.[0] ?? null, away: step.score?.[1] ?? null },
      halfTime: { home: null, away: null },
    },
  }
}

type Feeds = { fd: unknown[]; espn: EspnScoreboardEvent[]; competition?: unknown }

/** football-data responde `feeds.fd`; a ESPN, os eventos do dia UTC pedido. */
function stubProviders(feeds: Feeds) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.hostname === 'api.football-data.org') {
        return Response.json({
          competition: feeds.competition ?? { id: 2017, code: 'PPL', name: 'Primeira Liga' },
          matches: feeds.fd,
        })
      }
      const day = url.searchParams.get('dates') ?? ''
      const events = feeds.espn.filter(
        (ev) => String(ev.date).slice(0, 10).replaceAll('-', '') === day,
      )
      return Response.json({ events })
    }),
  )
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

type Row = Omit<Projection, 'locked'> & { locked_at: string | null }

function readProjection(sqlite: DatabaseSync): Projection {
  const row = sqlite
    .prepare(
      `SELECT start_time, status, postponed, locked_at, home_score, away_score FROM matches`,
    )
    .get() as Row
  const { locked_at, ...rest } = row
  return { ...rest, locked: locked_at !== null }
}

const espnDays = (...steps: Step[]) =>
  Array.from(
    new Set(steps.map((s) => (s.espn.date ?? KICKOFF).slice(0, 10).replaceAll('-', ''))),
  )

async function runFootballData(steps: Step[]): Promise<Projection> {
  const { sqlite, db } = setup()
  const feeds: Feeds = { fd: [], espn: [] }
  stubProviders(feeds)
  for (const step of steps) {
    feeds.fd = [fdMatch(step.fd)]
    await syncFixtures({ competitionCode: 'PPL', season: 2026, db, apiKey: 'k', now: SYNC_NOW })
  }
  return readProjection(sqlite)
}

async function runEspn(steps: Step[]): Promise<Projection> {
  const { sqlite, db } = setup()
  const feeds: Feeds = { fd: [], espn: [] }
  stubProviders(feeds)
  for (const step of steps) {
    feeds.espn = [espnEvent(step.espn)]
    await syncFixtures({
      competitionCode: 'bra.2',
      season: 2026,
      dates: espnDays(step),
      db,
      now: SYNC_NOW,
    })
  }
  return readProjection(sqlite)
}

const SCENARIOS: [string, Step[], Projection][] = [
  ['agendado', [AGENDADO], projection({})],
  [
    'em andamento: trava e não grava o placar parcial',
    [AGENDADO, EM_ANDAMENTO],
    projection({ locked: true }),
  ],
  [
    'na prorrogação: trava e não grava o placar parcial',
    [AGENDADO, PRORROGACAO],
    projection({ locked: true }),
  ],
  [
    'encerrado com placar',
    [AGENDADO, EM_ANDAMENTO, ENCERRADO_2_1],
    projection({ status: 'finished', locked: true, home_score: 2, away_score: 1 }),
  ],
  [
    'encerrado sem placar continua sem resultado, travado',
    [AGENDADO, ENCERRADO_SEM_PLACAR],
    projection({ locked: true }),
  ],
  [
    'resposta atrasada não desfaz o final',
    [AGENDADO, ENCERRADO_2_1, EM_ANDAMENTO],
    projection({ status: 'finished', locked: true, home_score: 2, away_score: 1 }),
  ],
  [
    'final sem placar não apaga o placar gravado',
    [AGENDADO, ENCERRADO_2_1, ENCERRADO_SEM_PLACAR],
    projection({ status: 'finished', locked: true, home_score: 2, away_score: 1 }),
  ],
  [
    'correção do final',
    [AGENDADO, ENCERRADO_2_1, CORRIGIDO_3_1],
    projection({ status: 'finished', locked: true, home_score: 3, away_score: 1 }),
  ],
  [
    'adiado antes do início: aberto, sem placar e com o horário original',
    [AGENDADO, ADIADO_0_0],
    projection({ postponed: 1 }),
  ],
  [
    'cancelado antes do início: aberto e sem placar',
    [AGENDADO, CANCELADO_0_0],
    projection({ postponed: 1 }),
  ],
  [
    'suspenso depois do início: segue travado e sem placar',
    [AGENDADO, EM_ANDAMENTO, SUSPENSO_0_0],
    projection({ postponed: 1, locked: true }),
  ],
  [
    'adiado e remarcado: data nova, aberto',
    [AGENDADO, ADIADO_0_0, REMARCADO],
    projection({ start_time: NEW_KICKOFF }),
  ],
  [
    'cancelado e remarcado: volta ao calendário com a data nova',
    [AGENDADO, CANCELADO_0_0, REMARCADO],
    projection({ start_time: NEW_KICKOFF }),
  ],
]

describe('ciclo da partida: os dois provedores gravam a mesma projeção', () => {
  it.each(SCENARIOS)('%s', async (_label, steps, expected) => {
    const footballData = await runFootballData(steps)
    const espn = await runEspn(steps)

    expect(footballData).toEqual(expected)
    expect(espn).toEqual(expected)
  })
})

describe('ciclo da partida: payloads reais', () => {
  /**
   * Rayo Vallecano × Athletic, LaLiga, jogo 564698 da football-data, consultado
   * em 12/11/2026. Marcado para 10/10/2026 12:00Z, chega como CANCELLED, com
   * placar 0-0, vencedor DRAW e a data nova de 09/12. Em produção a linha estava
   * `scheduled`, `postponed = 1` e com placar 0-0.
   */
  it('cancelado da football-data não grava o 0-0 do provedor', async () => {
    const { sqlite, db } = setup()
    const original = structuredClone(canceladoJson.matches[0])
    const feeds: Feeds = {
      competition: canceladoJson.competition,
      fd: [{ ...original, status: 'TIMED', utcDate: '2026-10-10T12:00:00Z' }],
      espn: [],
    }
    stubProviders(feeds)
    const options = { competitionCode: 'PD', season: 2026, db, apiKey: 'k' }
    await syncFixtures({ ...options, now: '2026-10-09T12:00:00Z' })

    feeds.fd = canceladoJson.matches
    await syncFixtures({ ...options, now: '2026-11-12T12:00:00Z' })

    expect(readProjection(sqlite)).toEqual({
      start_time: '2026-10-10T12:00:00Z',
      status: 'scheduled',
      postponed: 1,
      locked: true,
      home_score: null,
      away_score: null,
    })
  })

  /**
   * O mesmo jogo na ESPN (`esp.1`, `dates=20261209`, consultado em 12/11/2026):
   * STATUS_SUSPENDED aos 33 minutos, state 'post', 0-0 e a data de 09/12, quando
   * a partida é retomada. O cancelamento da football-data não é terminal.
   */
  it('o mesmo jogo suspenso na ESPN fica travado e sem placar', async () => {
    const { sqlite, db } = setup()
    stubProviders({ fd: [], espn: (suspensoJson as { events: EspnScoreboardEvent[] }).events })
    await syncFixtures({
      competitionCode: 'bra.2',
      season: 2026,
      dates: ['20261209'],
      db,
      now: '2026-11-12T12:00:00Z',
    })

    expect(readProjection(sqlite)).toMatchObject({
      status: 'scheduled',
      postponed: 1,
      locked: true,
      home_score: null,
      away_score: null,
    })
  })
})

describe('ciclo da partida: fallback de resultados', () => {
  /** Dentro da janela ativa do poller (115 a 200 min após o início). */
  const inWindow = Date.parse(KICKOFF) + 120 * 60_000

  it('a ESPN encerra o jogo que a football-data ainda dá como adiado e tira o adiado', async () => {
    const { sqlite, db } = setup()
    const feeds: Feeds = { fd: [fdMatch(AGENDADO.fd)], espn: [] }
    stubProviders(feeds)
    await syncFixtures({ competitionCode: 'PPL', season: 2026, db, apiKey: 'k', now: SYNC_NOW })

    feeds.fd = [fdMatch({ status: 'POSTPONED', score: null })]
    feeds.espn = [espnEvent(ENCERRADO_2_1.espn)]
    await pollActiveMatches(db, 'k', undefined, inWindow)

    expect(readProjection(sqlite)).toMatchObject({
      status: 'finished',
      postponed: 0,
      home_score: 2,
      away_score: 1,
    })
  })
})

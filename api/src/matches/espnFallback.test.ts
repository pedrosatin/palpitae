import type { D1Database } from '@cloudflare/workers-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FOOTBALL_DATA_TO_ESPN, scoreWindowFromEspn } from './espnFallback'

// ---------------------------------------------------------------------------
// Fake D1 que serve a ÚNICA query de janela do fallback (SELECT com JOIN em
// teams/competitions) e grava os binds de cada UPDATE. Sem SQLite de verdade,
// o guard `AND status != 'finished'` do UPDATE é coberto por asserção de shape.
// ---------------------------------------------------------------------------

type WindowRow = {
  id: string
  start_time: string
  home_name: string
  away_name: string
  comp_code: string | null
}

function buildFakeDb(rows: WindowRow[]) {
  const captured = {
    updates: [] as unknown[][],
    updateSql: '',
    windowSql: '',
    windowParams: [] as unknown[],
  }
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = []
      const stmt = {
        bind(...args: unknown[]) {
          bound = args
          return stmt
        },
        async all<T>(): Promise<{ results: T[] }> {
          captured.windowSql = sql
          captured.windowParams = bound
          return { results: rows as unknown as T[] }
        },
        async run() {
          if (sql.includes('UPDATE matches')) {
            captured.updateSql = sql
            captured.updates.push(bound)
          }
          return { success: true }
        },
      }
      return stmt
    },
  }
  return { db: db as unknown as D1Database, captured }
}

function buildFakeAe() {
  return { writeDataPoint: vi.fn() }
}

// Fábrica de evento ESPN no shape real do scoreboard (validado ao vivo):
// date ISO (pode vir sem segundos, ex. "2026-10-05T22:30Z"), status.type.state,
// competitions[0].competitors[] com homeAway/team.displayName/score string.
function espnEvent(opts: {
  date: string
  state?: string
  home?: string
  away?: string
  homeScore?: string
  awayScore?: string
}) {
  return {
    date: opts.date,
    status: { type: { state: opts.state ?? 'post' } },
    competitions: [
      {
        competitors: [
          { homeAway: 'home', team: { displayName: opts.home ?? 'Flamengo' }, score: opts.homeScore ?? '2' },
          { homeAway: 'away', team: { displayName: opts.away ?? 'Corinthians' }, score: opts.awayScore ?? '1' },
        ],
      },
    ],
  }
}

/** Mock do fetch que responde por URL (slug/dates) com os eventos informados. */
function mockFetch(byDate: Record<string, unknown[]>) {
  const fetchMock = vi.fn(async (url: string | URL) => {
    const u = url.toString()
    const date = u.match(/dates=(\d{8})/)?.[1] ?? ''
    const events = byDate[date] ?? []
    return {
      ok: true,
      status: 200,
      async json() {
        return { events }
      },
      async text() {
        return ''
      },
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const NOW = Date.parse('2026-10-05T22:00:00Z')

/** Kickoff dentro da janela do poller (start+115..200min ≤ now). */
const IN_WINDOW_START = '2026-10-05T19:45:00Z' // now - 135min

function row(overrides: Partial<WindowRow> = {}): WindowRow {
  return {
    id: 'm1',
    start_time: IN_WINDOW_START,
    home_name: 'CR Flamengo',
    away_name: 'SC Corinthians Paulista',
    comp_code: 'BSA',
    ...overrides,
  }
}

describe('scoreWindowFromEspn', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('casa nomes com prefixo e com acento (CR Flamengo×Flamengo, São Paulo×Sao Paulo) e atualiza placar de evento post', async () => {
    // Interno (football-data): 'CR Flamengo' × 'São Paulo FC'.
    // ESPN: 'Flamengo' × 'Sao Paulo' — prefixo de um lado, acento do outro.
    mockFetch({
      '20261005': [
        espnEvent({
          date: '2026-10-05T19:45:00Z',
          home: 'Flamengo',
          away: 'Sao Paulo',
          homeScore: '3',
          awayScore: '0',
        }),
      ],
    })
    const { db, captured } = buildFakeDb([row({ home_name: 'CR Flamengo', away_name: 'São Paulo FC' })])
    const ae = buildFakeAe()

    const result = await scoreWindowFromEspn(db, ae, ['c1'], { now: NOW })

    expect(result.get('c1')).toBe(1)
    expect(captured.updates).toHaveLength(1)
    expect(captured.updates[0]).toEqual([3, 0, 'm1'])

    const points = ae.writeDataPoint.mock.calls.map((c) => c[0]).filter((p) => p.blobs?.[0] === 'match_results_fallback')
    expect(points).toHaveLength(1)
    expect(points[0].blobs[1]).toBe('c1')
    expect(points[0].doubles).toEqual([1, 0])
  })

  it('busca o scoreboard da data UTC de cada jogo E do dia anterior (bucket da ESPN é dia ET)', async () => {
    const fetchMock = mockFetch({})
    const { db } = buildFakeDb([row()])

    await scoreWindowFromEspn(db, undefined, ['c1'], { now: NOW })

    const calledDates = fetchMock.mock.calls
      .map((c) => (c[0] as string).match(/dates=(\d{8})/)?.[1])
      .sort()
    expect(calledDates).toEqual(['20261004', '20261005'])
  })

  it('usa o slug ESPN mapeado do código football-data da competição', async () => {
    const fetchMock = mockFetch({})
    const { db } = buildFakeDb([row({ comp_code: 'CL' })])

    await scoreWindowFromEspn(db, undefined, ['c1'], { now: NOW })

    expect(fetchMock.mock.calls[0][0]).toContain('/soccer/uefa.champions/scoreboard')
    expect(FOOTBALL_DATA_TO_ESPN.EL).toBe('uefa.europa')
    expect(FOOTBALL_DATA_TO_ESPN.BSA).toBe('bra.1')
  })

  it('tolera kickoff até ±150min entre start_time interno e date do evento', async () => {
    // exatamente 150min de diferença (pra menos) — ainda casa
    mockFetch({ '20261005': [espnEvent({ date: '2026-10-05T17:15:00Z' })] }) // start - 150min
    const { db, captured } = buildFakeDb([row()])

    await scoreWindowFromEspn(db, undefined, ['c1'], { now: NOW })
    expect(captured.updates).toHaveLength(1)

    // 151min de diferença — não casa mais, jogo pulado
    mockFetch({ '20261005': [espnEvent({ date: '2026-10-05T22:16:00Z' })] }) // start + 151min
    const db2 = buildFakeDb([row()])
    const result = await scoreWindowFromEspn(db2.db, undefined, ['c1'], { now: NOW })
    expect(db2.captured.updates).toHaveLength(0)
    expect(result.get('c1')).toBe(0)
  })

  it('não atualiza evento em estado pre ou in', async () => {
    for (const state of ['pre', 'in']) {
      vi.unstubAllGlobals()
      mockFetch({ '20261005': [espnEvent({ date: IN_WINDOW_START, state })] })
      const { db, captured } = buildFakeDb([row()])
      const ae = buildFakeAe()

      const result = await scoreWindowFromEspn(db, ae, ['c1'], { now: NOW })

      expect(captured.updates).toHaveLength(0)
      expect(result.get('c1')).toBe(0)
      const points = ae.writeDataPoint.mock.calls
        .map((c) => c[0])
        .filter((p) => p.blobs?.[0] === 'match_results_fallback')
      expect(points[0].doubles).toEqual([0, 1])
    }
  })

  it('pula o jogo quando o casamento é ambíguo (dois eventos casam)', async () => {
    mockFetch({
      '20261005': [
        espnEvent({ date: '2026-10-05T19:45:00Z', homeScore: '1', awayScore: '0' }),
        espnEvent({ date: '2026-10-05T19:50:00Z', homeScore: '2', awayScore: '2' }),
      ],
    })
    const { db, captured } = buildFakeDb([row()])

    const result = await scoreWindowFromEspn(db, undefined, ['c1'], { now: NOW })

    expect(captured.updates).toHaveLength(0)
    expect(result.get('c1')).toBe(0)
  })

  it('pula o jogo quando nenhum evento casa (nome de time diferente)', async () => {
    mockFetch({
      '20261005': [
        espnEvent({ date: IN_WINDOW_START, home: 'Palmeiras', away: 'Botafogo' }),
      ],
    })
    const { db, captured } = buildFakeDb([row()])

    const result = await scoreWindowFromEspn(db, undefined, ['c1'], { now: NOW })

    expect(captured.updates).toHaveLength(0)
    expect(result.get('c1')).toBe(0)
  })

  it('não casa quando mandante/visitante estão invertidos no evento', async () => {
    mockFetch({
      '20261005': [
        espnEvent({ date: IN_WINDOW_START, home: 'Corinthians', away: 'Flamengo' }),
      ],
    })
    const { db, captured } = buildFakeDb([row()])

    await scoreWindowFromEspn(db, undefined, ['c1'], { now: NOW })

    expect(captured.updates).toHaveLength(0)
  })

  it('pula placar não-numérico (fail-closed: nunca gravar lixo)', async () => {
    mockFetch({
      '20261005': [espnEvent({ date: IN_WINDOW_START, homeScore: '-', awayScore: '1' })],
    })
    const { db, captured } = buildFakeDb([row()])

    const result = await scoreWindowFromEspn(db, undefined, ['c1'], { now: NOW })

    expect(captured.updates).toHaveLength(0)
    expect(result.get('c1')).toBe(0)
  })

  it('UPDATE grava placar + status e é condicional a status != finished (shape da SQL)', async () => {
    mockFetch({ '20261005': [espnEvent({ date: IN_WINDOW_START })] })
    const { db, captured } = buildFakeDb([row()])

    await scoreWindowFromEspn(db, undefined, ['c1'], { now: NOW })

    // Guard contra corrida com o caminho primário: só regrava jogo não-finalizado.
    expect(captured.updateSql).toContain("SET home_score = ?, away_score = ?, status = 'finished'")
    expect(captured.updateSql).toContain("AND status != 'finished'")
    expect(captured.updates).toHaveLength(1)
    // A query de janela replica a semântica do poller.
    expect(captured.windowSql).toContain("status != 'finished'")
    expect(captured.windowParams[0]).toBe('c1')
  })

  it('competição sem mapeamento ESPN é pulada sem erro e sem fetch', async () => {
    const fetchMock = mockFetch({})
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { db, captured } = buildFakeDb([row({ comp_code: 'XYZ' })])
    const ae = buildFakeAe()

    const result = await scoreWindowFromEspn(db, ae, ['c1'], { now: NOW })

    expect(result.get('c1')).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(captured.updates).toHaveLength(0)
    expect(ae.writeDataPoint).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('sem mapeamento ESPN'))
    consoleSpy.mockRestore()
  })

  it('janela vazia (nenhum jogo não-finalizado na competição) não faz nada', async () => {
    const fetchMock = mockFetch({})
    const { db } = buildFakeDb([])

    const result = await scoreWindowFromEspn(db, undefined, ['c1'], { now: NOW })

    expect(result.get('c1')).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lista de comps vazia não faz nada', async () => {
    const fetchMock = mockFetch({})
    const { db } = buildFakeDb([row()])

    const result = await scoreWindowFromEspn(db, undefined, [], { now: NOW })

    expect(result.size).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('erro de fetch isola a competição sem lançar (as demais continuam)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = buildFakeDb([row()])
    const ae = buildFakeAe()

    const result = await scoreWindowFromEspn(db, ae, ['c1', 'c2'], { now: NOW })

    expect(result.get('c1')).toBe(0)
    expect(result.get('c2')).toBe(0)
    const points = ae.writeDataPoint.mock.calls
      .map((c) => c[0])
      .filter((p) => p.blobs?.[0] === 'match_results_fallback')
    expect(points).toHaveLength(2) // um logError por competição
    expect(points[0].blobs?.[2]).toBe('network down')
    consoleSpy.mockRestore()
  })
})

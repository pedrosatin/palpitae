/// <reference types="node" />
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Só a ESPN é simulada: a Wikipedia passa pelo `fetchPageviews` de verdade, com
// um `fetch` que nunca responde, como no job do Actions.
vi.mock('./espnRadar', () => ({ fetchEspnLeaguesAndCounts: vi.fn() }))

import { createSqliteD1 } from '../testing/sqliteD1'
import { fetchEspnLeaguesAndCounts, type ProviderLeague } from './espnRadar'
import { SqlCollector } from './sqlCollector'
import { syncRadar } from './sync'

const snapshotMock = vi.mocked(fetchEspnLeaguesAndCounts)

const LIBERTADORES: ProviderLeague = {
  externalId: 'conmebol.libertadores',
  name: 'CONMEBOL Libertadores',
  country: 'World',
  type: 'Cup',
  logoUrl: null,
  season: '2026',
  startsOn: '2026-02-04',
  endsOn: '2026-11-28',
}

/** Mesmo caminho do workflow: o syncRadar gera o SQL no coletor e o arquivo é aplicado inteiro. */
async function runSync(sqlite: ReturnType<typeof createSqliteD1>['sqlite'], day: string) {
  const collector = new SqlCollector()
  const result = await syncRadar(collector as never, undefined, new Date(`${day}T07:00:00Z`))
  if (collector.size > 0) sqlite.exec(collector.toSql())
  return result
}

describe('radar: Wikipedia que não responde preserva os pageviews do snapshot anterior', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    snapshotMock.mockReset()
    snapshotMock.mockResolvedValue({ leagues: [LIBERTADORES], counts: new Map(), failed: [] })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('o timeout vira coleta parcial e os pageviews gravados continuam no banco', async () => {
    const { sqlite } = createSqliteD1()
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(JSON.stringify({ items: [{ timestamp: '2026081600', views: 900 }] }))),
      )
      expect((await runSync(sqlite, '2026-08-17')).status).toBe('ok')

      // Dia seguinte: a Wikipedia pendura. O timeout de produção é de segundos;
      // aqui `AbortSignal.timeout` vence em 20 ms.
      const realTimeout = AbortSignal.timeout.bind(AbortSignal)
      vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(20))
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
            }),
        ),
      )
      const result = await runSync(sqlite, '2026-08-18')

      expect(result).toMatchObject({ status: 'partial', pageviewErrors: 1 })
      const rows = sqlite
        .prepare(`SELECT day, pageviews FROM competition_radar_daily WHERE pageviews IS NOT NULL`)
        .all()
      expect(rows).toEqual([{ day: '2026-08-16', pageviews: 900 }])
      const current = sqlite.prepare(`SELECT is_current FROM competition_radar`).all()
      expect(current).toEqual([{ is_current: 1 }])
    } finally {
      sqlite.close()
    }
  })
})

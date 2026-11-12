/// <reference types="node" />
import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./espnRadar', () => ({ fetchEspnLeaguesAndCounts: vi.fn() }))
vi.mock('./wikipedia', () => ({ fetchPageviews: vi.fn() }))

import { signJwt } from '../auth/jwt'
import { metricsRouter } from '../observability/metricsRouter'
import { createSqliteD1 } from '../testing/sqliteD1'
import { withSessionAccounts } from '../testing/session'
import type { AppContext, Env } from '../types'
import { fetchEspnLeaguesAndCounts, type ProviderLeague } from './espnRadar'
import { SqlCollector } from './sqlCollector'
import { syncRadar } from './sync'
import { fetchPageviews } from './wikipedia'

const snapshotMock = vi.mocked(fetchEspnLeaguesAndCounts)
const pageviewsMock = vi.mocked(fetchPageviews)

const JWT_SECRET = 'test-secret-radar-parcial'
const ADMIN = 'admin@palpitae.com.br'

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
const SERIE_A: ProviderLeague = {
  externalId: 'bra.1',
  name: 'Serie A',
  country: 'Brazil',
  type: 'League',
  logoUrl: null,
  season: '2026',
  startsOn: '2026-03-28',
  endsOn: '2026-12-06',
}

/**
 * Caminho de produção: o syncRadar gera o SQL no coletor e o arquivo é aplicado
 * inteiro no banco, como o `wrangler d1 execute --file` do workflow.
 */
async function runSync(sqlite: ReturnType<typeof createSqliteD1>['sqlite'], day: string) {
  const collector = new SqlCollector()
  const result = await syncRadar(collector as never, undefined, new Date(`${day}T07:00:00Z`))
  if (collector.size > 0) sqlite.exec(collector.toSql())
  return result
}

async function radarIds(db: D1Database): Promise<string[]> {
  const app = new Hono<AppContext>()
  app.route('/metrics', metricsRouter)
  const token = await signJwt({ sub: ADMIN, email: ADMIN }, JWT_SECRET, 3600)
  const env = {
    JWT_SECRET,
    ADMIN_EMAIL: ADMIN,
    DB: withSessionAccounts(db, (id) => id),
  } as unknown as Env
  const res = await app.request('/metrics/radar', { headers: { Cookie: `session=${token}` } }, env)
  expect(res.status).toBe(200)
  const body = (await res.json()) as { items: { id: string }[] }
  return body.items.map((item) => item.id).sort()
}

describe('radar: falha parcial da ESPN preserva o último snapshot válido', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    snapshotMock.mockReset()
    pageviewsMock.mockReset()
    pageviewsMock.mockResolvedValue(new Map())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('liga de slug sem resposta continua no radar; rebaixa só quando a ESPN responde sem temporada', async () => {
    const { sqlite, db } = createSqliteD1()
    try {
      const both = ['espn:bra.1:2026', 'espn:conmebol.libertadores:2026']

      snapshotMock.mockResolvedValueOnce({
        leagues: [LIBERTADORES, SERIE_A],
        counts: new Map(),
        failed: [],
      })
      expect((await runSync(sqlite, '2026-08-17')).status).toBe('ok')
      expect(await radarIds(db)).toEqual(both)

      // Dia seguinte: a ESPN não responde para a Libertadores.
      snapshotMock.mockResolvedValueOnce({
        leagues: [SERIE_A],
        counts: new Map(),
        failed: ['conmebol.libertadores'],
      })
      const partial = await runSync(sqlite, '2026-08-18')
      expect(partial).toMatchObject({ status: 'partial', failedSlugs: ['conmebol.libertadores'] })
      expect(await radarIds(db)).toEqual(both)

      // A ESPN responde e a Libertadores não tem temporada corrente: aí sim sai.
      snapshotMock.mockResolvedValueOnce({ leagues: [SERIE_A], counts: new Map(), failed: [] })
      expect((await runSync(sqlite, '2026-08-19')).status).toBe('ok')
      expect(await radarIds(db)).toEqual(['espn:bra.1:2026'])
    } finally {
      sqlite.close()
    }
  })

  it('falha total não grava nada e devolve erro', async () => {
    const { sqlite, db } = createSqliteD1()
    try {
      snapshotMock.mockResolvedValueOnce({ leagues: [SERIE_A], counts: new Map(), failed: [] })
      await runSync(sqlite, '2026-08-17')

      snapshotMock.mockRejectedValueOnce(new Error('ESPN falhou em todos os slugs'))
      expect((await runSync(sqlite, '2026-08-18')).status).toBe('error')
      expect(await radarIds(db)).toEqual(['espn:bra.1:2026'])
    } finally {
      sqlite.close()
    }
  })
})

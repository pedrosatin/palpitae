/// <reference types="node" />
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import { competitionsRouter } from '../competitions/router'
import { metricsRouter } from '../observability/metricsRouter'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { AppContext, Env } from '../types'

const JWT_SECRET = 'test-secret-lote2-radar'
const ADMIN = 'admin@palpitae.com.br'
const ORDINARY = 'comum@example.com'

/** As cinco do lote 2: radar (país/nome do provider) → slug seedado nas migrations. */
const LOTE2 = [
  { id: 'pd', name: 'La Liga', country: 'Spain', slug: 'la-liga-2026' },
  { id: 'sa', name: 'Serie A', country: 'Italy', slug: 'serie-a-2026' },
  { id: 'bl1', name: 'Bundesliga', country: 'Germany', slug: 'bundesliga-2026' },
  { id: 'ppl', name: 'Primeira Liga', country: 'Portugal', slug: 'primeira-liga-2026' },
  { id: 'bra2', name: 'Serie B', country: 'Brazil', slug: 'brasileirao-serie-b-2026' },
] as const

function makeEnv(db: Env['DB']): Env {
  return { JWT_SECRET, ADMIN_EMAIL: ADMIN, DB: db } as unknown as Env
}

async function cookie(email: string) {
  const token = await signJwt({ sub: `user-${email}`, email }, JWT_SECRET, 3600)
  return { Cookie: `session=${token}` }
}

describe('lote 2: radar suportadas e piloto', () => {
  it('marca as cinco seedadas como supported no radar e as mantém fora do GET /competitions do usuário comum', async () => {
    const { sqlite, db } = createSqliteD1()
    try {
      for (const row of LOTE2) {
        sqlite
          .prepare(
            `INSERT INTO competition_radar
            (id, provider, external_id, name, country, season, is_current)
            VALUES (?, 'test', ?, ?, ?, '2026', 1)`,
          )
          .run(row.id, row.id, row.name, row.country)
      }

      const seeded = sqlite
        .prepare(
          `SELECT slug, visibility FROM competitions
            WHERE slug IN (${LOTE2.map(() => '?').join(',')})
            ORDER BY slug`,
        )
        .all(...LOTE2.map((r) => r.slug)) as { slug: string; visibility: string }[]
      expect(seeded).toEqual(
        [...LOTE2]
          .map((r) => ({ slug: r.slug, visibility: 'pilot' }))
          .sort((a, b) => a.slug.localeCompare(b.slug)),
      )

      const radarApp = new Hono<AppContext>()
      radarApp.route('/metrics', metricsRouter)
      const radarRes = await radarApp.request(
        '/metrics/radar',
        { headers: await cookie(ADMIN) },
        makeEnv(db),
      )
      expect(radarRes.status).toBe(200)
      const radarBody = (await radarRes.json()) as {
        items: { id: string; supported: boolean; internalGroups: number }[]
      }
      expect(radarBody.items).toEqual(
        expect.arrayContaining(
          LOTE2.map((row) =>
            expect.objectContaining({
              id: row.id,
              supported: true,
              internalGroups: 0,
            }),
          ),
        ),
      )

      const compsApp = new Hono<AppContext>()
      compsApp.route('/competitions', competitionsRouter)
      const ordinaryRes = await compsApp.request(
        '/competitions',
        { headers: await cookie(ORDINARY) },
        makeEnv(db),
      )
      expect(ordinaryRes.status).toBe(200)
      const ordinaryBody = (await ordinaryRes.json()) as {
        competitions: { slug: string }[]
      }
      const ordinarySlugs = ordinaryBody.competitions.map((c) => c.slug)
      for (const row of LOTE2) {
        expect(ordinarySlugs).not.toContain(row.slug)
      }

      const adminRes = await compsApp.request(
        '/competitions',
        { headers: await cookie(ADMIN) },
        makeEnv(db),
      )
      expect(adminRes.status).toBe(200)
      const adminSlugs = (
        (await adminRes.json()) as { competitions: { slug: string }[] }
      ).competitions.map((c) => c.slug)
      for (const row of LOTE2) {
        expect(adminSlugs).toContain(row.slug)
      }
    } finally {
      sqlite.close()
    }
  })
})

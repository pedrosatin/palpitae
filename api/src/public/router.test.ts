import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { publicRouter } from './router'
import type { AppContext } from '../types'

type Row = { group_name: string; competition_name: string | null; member_count: number }

function createDbMock(rows: Record<string, Row>) {
  const prepare = vi.fn((sql: string) => ({
    bind(code: string) {
      return {
        async first() {
          if (sql.includes('FROM groups g') && sql.includes('invite_code = ?')) {
            return rows[code] ?? null
          }
          return null
        },
      }
    },
  }))

  return { db: { prepare } as unknown as D1Database, prepare }
}

function request(path: string, db: D1Database) {
  const app = new Hono<AppContext>()
  app.route('/public', publicRouter)
  return app.request(path, {}, { DB: db } as AppContext['Bindings'])
}

const VALID: Record<string, Row> = {
  'ABCD-EF23': { group_name: 'Os Craques', competition_name: 'Brasileirão 2026', member_count: 7 },
}

describe('GET /public/invites/:code', () => {
  it('returns only group name, competition name and member count for a valid code', async () => {
    const { db } = createDbMock(VALID)

    const res = await request('/public/invites/ABCD-EF23', db)

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
    const body = (await res.json()) as { invite: Record<string, unknown> }
    expect(body).toEqual({
      invite: {
        group_name: 'Os Craques',
        competition_name: 'Brasileirão 2026',
        member_count: 7,
      },
    })
    // Nada de ids, dono, membros, limite de vagas ou o próprio código.
    expect(Object.keys(body)).toEqual(['invite'])
    expect(Object.keys(body.invite).sort()).toEqual([
      'competition_name',
      'group_name',
      'member_count',
    ])
  })

  it('does not select internal or personal columns from the database', async () => {
    const { db, prepare } = createDbMock(VALID)

    await request('/public/invites/ABCD-EF23', db)

    const sql = prepare.mock.calls[0]?.[0] ?? ''
    const aliases = [...sql.matchAll(/\bAS (\w+)/g)].map((m) => m[1])
    expect(aliases).toEqual(['group_name', 'competition_name', 'member_count'])
    expect(sql).not.toMatch(/owner|email|nickname|max_members|users/)
    expect(sql).toContain('deleted_at IS NULL')
  })

  it('normalizes a lowercase code before the lookup', async () => {
    const { db } = createDbMock(VALID)

    const res = await request('/public/invites/abcd-ef23', db)

    expect(res.status).toBe(200)
  })

  it('returns 404 for a well-formed code that does not exist', async () => {
    const { db } = createDbMock(VALID)

    const res = await request('/public/invites/ZZZZ-ZZZZ', db)

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Convite não encontrado' })
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60')
  })

  it.each([
    'ABC',
    'ABCDEFGH',
    'ABCD_EF23',
    "ABCD-EF2'",
    'ABCD-EF23-XX',
    '%27%20OR%201%3D1',
    // Fora do alfabeto do gerador (sem I, O, 0 e 1).
    'ABCD-EF01',
    'IOAB-CD23',
  ])('rejects malformed code %s with 404 without querying the database', async (code) => {
    const { db, prepare } = createDbMock(VALID)

    const res = await request(`/public/invites/${code}`, db)

    expect(res.status).toBe(404)
    expect(prepare).not.toHaveBeenCalled()
  })

  it('falls back to null competition and numeric member count', async () => {
    const { db } = createDbMock({
      'ABCD-EF23': {
        group_name: 'Sem campeonato',
        competition_name: null,
        member_count: '3' as unknown as number,
      },
    })

    const res = await request('/public/invites/ABCD-EF23', db)

    expect(await res.json()).toEqual({
      invite: { group_name: 'Sem campeonato', competition_name: null, member_count: 3 },
    })
  })

  it('returns 500 without caching when the database fails', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          first: () => Promise.reject(new Error('D1 down')),
        }),
      }),
    } as unknown as D1Database
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await request('/public/invites/ABCD-EF23', db)

    expect(res.status).toBe(500)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    spy.mockRestore()
  })

  it('does not require a session cookie', async () => {
    const { db } = createDbMock(VALID)

    const res = await request('/public/invites/ABCD-EF23', db)

    expect(res.status).not.toBe(401)
  })
})

import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { publicAdminName, publicRouter } from './router'
import type { AppContext } from '../types'

type Row = {
  group_name: string
  competition_name: string | null
  member_count: number
  admin_name?: string | null
  points_exact?: number | null
  points_winner?: number | null
}

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
  'ABCD-EF23': {
    group_name: 'Os Craques',
    competition_name: 'Brasileirão 2026',
    member_count: 7,
    admin_name: 'Pedro Satin',
    points_exact: 3,
    points_winner: 1,
  },
}

describe('GET /public/invites/:code', () => {
  it('devolve só os campos do convite para um código válido', async () => {
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
        admin_name: 'Pedro',
        points_exact: 3,
        points_winner: 1,
      },
    })
    // Nada de ids, e-mails, demais membros, limite de vagas ou o próprio código.
    expect(Object.keys(body)).toEqual(['invite'])
    expect(Object.keys(body.invite).sort()).toEqual([
      'admin_name',
      'competition_name',
      'group_name',
      'member_count',
      'points_exact',
      'points_winner',
    ])
  })

  it('does not select internal or personal columns from the database', async () => {
    const { db, prepare } = createDbMock(VALID)

    await request('/public/invites/ABCD-EF23', db)

    const sql = prepare.mock.calls[0]?.[0] ?? ''
    const aliases = [...sql.matchAll(/\bAS (\w+)/g)].map((m) => m[1])
    expect(aliases).toEqual([
      'group_name',
      'competition_name',
      'member_count',
      'admin_name',
      'points_exact',
      'points_winner',
    ])
    expect(sql).not.toMatch(/email|max_members|avatar|g\.id AS|u\.id AS/)
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
      invite: {
        group_name: 'Sem campeonato',
        competition_name: null,
        member_count: 3,
        admin_name: null,
        points_exact: null,
        points_winner: null,
      },
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

describe('publicAdminName', () => {
  it('mantém só o primeiro nome', () => {
    expect(publicAdminName('  Pedro   Satin ')).toBe('Pedro')
    expect(publicAdminName('Ana')).toBe('Ana')
  })

  it.each([null, undefined, '', '   ', 'pedro@example.com', 'pe***@example.com Silva'])(
    'esconde %s',
    (raw) => {
      expect(publicAdminName(raw)).toBeNull()
    },
  )
})

describe('GET /public/invites/:code com SQL real', () => {
  function seedInvite(nickname: string | null, userName: string | null) {
    const { sqlite, db } = createSqliteD1()
    sqlite
      .prepare(
        `INSERT INTO users (id, email, provider, provider_id, user_name)
         VALUES ('dono', 'dono.secreto@example.com', 'google', 'g-dono', ?),
                ('membro', 'membro.secreto@example.com', 'google', 'g-membro', 'Maria Membro')`,
      )
      .run(userName)
    sqlite.prepare(`INSERT INTO profiles (user_id, nickname) VALUES ('dono', ?)`).run(nickname)
    sqlite.exec(`
      INSERT INTO competitions (id, name, slug, season, status, penalty_phases, visibility)
      VALUES ('comp-x', 'Brasileirão X', 'brasileirao-x', '2026', 'ongoing', '[]', 'public');
      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code, points_exact, points_winner)
      VALUES ('g1', 'Realidade do BR', 'comp-x', 'dono', 'ABCD-EF23', 5, 2);
      INSERT INTO group_members (id, group_id, user_id, role) VALUES
        ('m1', 'g1', 'dono', 'owner'),
        ('m2', 'g1', 'membro', 'member');
    `)
    return { sqlite, db }
  }

  it.each([
    ['usa o apelido', 'Pedro Satin', 'Outro Nome', 'Pedro'],
    ['cai no nome do Google sem apelido', null, 'Ana Souza', 'Ana'],
    ['ignora apelido em branco', '   ', 'Ana Souza', 'Ana'],
    ['devolve null sem nome, sem recorrer ao e-mail', null, null, null],
  ])('%s', async (_label, nickname, userName, expected) => {
    const { sqlite, db } = seedInvite(nickname, userName)
    try {
      const res = await request('/public/invites/ABCD-EF23', db)

      expect(res.status).toBe(200)
      const raw = await res.text()
      expect(JSON.parse(raw)).toEqual({
        invite: {
          group_name: 'Realidade do BR',
          competition_name: 'Brasileirão X',
          member_count: 2,
          admin_name: expected,
          points_exact: 5,
          points_winner: 2,
        },
      })
      expect(raw).not.toContain('@')
      expect(raw).not.toContain('Maria')
    } finally {
      sqlite.close()
    }
  })
})

describe('POST /public/invite-opens', () => {
  const SECRET = 'segredo-do-proxy'

  function post(
    env: Partial<AppContext['Bindings']>,
    headers: Record<string, string> = {},
    marker: Record<string, string> = { 'X-Palpitae-Invite-Open': '1' },
  ) {
    const app = new Hono<AppContext>()
    app.route('/public', publicRouter)
    return app.request(
      '/public/invite-opens',
      { method: 'POST', headers: { ...marker, ...headers } },
      env as AppContext['Bindings'],
    )
  }

  function aeMock() {
    const writeDataPoint = vi.fn()
    return { writeDataPoint, ae: { writeDataPoint } as unknown as AnalyticsEngineDataset }
  }

  it('grava só o tipo do evento: sem código, grupo, e-mail, IP ou user-agent', async () => {
    const { ae, writeDataPoint } = aeMock()

    const res = await post(
      { PROXY_SHARED_SECRET: SECRET, AE: ae },
      {
        'X-Palpitae-Proxy-Secret': SECRET,
        'X-Palpitae-Client-IP': '203.0.113.9',
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)',
      },
    )

    expect(res.status).toBe(204)
    expect(writeDataPoint).toHaveBeenCalledTimes(1)
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ['invite_opened'],
      blobs: ['invite_opened'],
      doubles: [],
    })
  })

  it.each([
    ['sem o header', {}],
    ['com o segredo errado', { 'X-Palpitae-Proxy-Secret': 'outro' }],
  ])('recusa %s e não conta a abertura', async (_label, headers) => {
    const { ae, writeDataPoint } = aeMock()

    const res = await post({ PROXY_SHARED_SECRET: SECRET, AE: ae }, headers)

    expect(res.status).toBe(403)
    expect(writeDataPoint).not.toHaveBeenCalled()
  })

  it('recusa o segredo sem a marca da Function, que é como chega quem passa pelo proxy', async () => {
    const { ae, writeDataPoint } = aeMock()

    const res = await post(
      { PROXY_SHARED_SECRET: SECRET, AE: ae },
      { 'X-Palpitae-Proxy-Secret': SECRET },
      {},
    )

    expect(res.status).toBe(403)
    expect(writeDataPoint).not.toHaveBeenCalled()
  })

  it('fica fechada quando o Worker não tem o segredo', async () => {
    const { ae, writeDataPoint } = aeMock()

    const res = await post({ AE: ae }, { 'X-Palpitae-Proxy-Secret': SECRET })

    expect(res.status).toBe(403)
    expect(writeDataPoint).not.toHaveBeenCalled()
  })

  it('a leitura do convite não conta abertura', async () => {
    const { ae, writeDataPoint } = aeMock()
    const { db } = createDbMock(VALID)
    const app = new Hono<AppContext>()
    app.route('/public', publicRouter)

    await app.request('/public/invites/ABCD-EF23', {}, {
      DB: db,
      AE: ae,
    } as AppContext['Bindings'])

    expect(writeDataPoint).not.toHaveBeenCalled()
  })
})

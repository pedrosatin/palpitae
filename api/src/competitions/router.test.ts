import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import { withSessionAccounts } from '../testing/session'
import { createSqliteD1 } from '../testing/sqliteD1'
import { competitionsRouter } from './router'
import type { AppContext } from '../types'

// Contas dos tokens deste arquivo: id → e-mail gravado.
const ACCOUNTS = {
  'test-user': 'test@example.com',
  'u-ordinary': 'comum@example.com',
  'u-guest': 'convidado@example.com',
  'u-admin': 'admin@palpitae.com.br',
}

function fakeEnv(
  db: D1Database,
  overrides: Partial<AppContext['Bindings']> = {},
): AppContext['Bindings'] {
  return {
    JWT_SECRET: 'secret',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'http://localhost:8787',
    FRONTEND_URL: 'http://localhost:5173',
    FOOTBALL_API_KEY: 'test-api-key',
    RESEND_API_KEY: 'test-resend-key',
    DB: withSessionAccounts(db, ACCOUNTS),
    ...overrides,
  }
}

function createDbMock(competitions: Record<string, unknown>[], throwError = false): D1Database {
  return {
    prepare: vi.fn().mockImplementation((sql: string) => {
      if (sql.includes('FROM revoked_sessions'))
        return { bind: () => ({ first: async () => null }) }
      if (throwError) {
        throw new Error('Database connection failed')
      }
      return {
        all: vi.fn().mockResolvedValue({ results: competitions }),
      }
    }),
  } as unknown as D1Database
}

describe('competitions router', () => {
  it('returns competitions and correctly derives has_penalty_phases', async () => {
    const app = new Hono<AppContext>()
    app.route('/competitions', competitionsRouter)

    const competitions = [
      { id: '1', name: 'Comp 1', penalty_phases: '["FINAL"]' },
      { id: '2', name: 'Comp 2', penalty_phases: '[]' },
      { id: '3', name: 'Comp 3', penalty_phases: null },
      { id: '4', name: 'Comp 4', penalty_phases: 'invalid json' },
    ]

    const token = await signJwt({ sub: 'test-user', email: 'test@example.com' }, 'secret', 3600)
    const response = await app.fetch(
      new Request('http://localhost/competitions', {
        headers: {
          Cookie: `session=${token}`,
        },
      }),
      fakeEnv(createDbMock(competitions)),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')

    const body = await response.json()
    expect(body).toEqual({
      competitions: [
        { id: '1', name: 'Comp 1', has_penalty_phases: true },
        { id: '2', name: 'Comp 2', has_penalty_phases: false },
        { id: '3', name: 'Comp 3', has_penalty_phases: false },
        { id: '4', name: 'Comp 4', has_penalty_phases: false },
      ],
    })
  })

  it('passes through the derived status column as status', async () => {
    const app = new Hono<AppContext>()
    app.route('/competitions', competitionsRouter)

    const competitions = [
      { id: 'wc', name: 'Copa do Mundo', penalty_phases: '[]', status: 'finished' },
      { id: 'br', name: 'Brasileirão', penalty_phases: '[]', status: 'ongoing' },
      { id: 'cl', name: 'Champions League', penalty_phases: '[]', status: 'upcoming' },
    ]

    const token = await signJwt({ sub: 'test-user', email: 'test@example.com' }, 'secret', 3600)
    const response = await app.fetch(
      new Request('http://localhost/competitions', {
        headers: { Cookie: `session=${token}` },
      }),
      fakeEnv(createDbMock(competitions)),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      competitions: [
        { id: 'wc', name: 'Copa do Mundo', status: 'finished', has_penalty_phases: false },
        { id: 'br', name: 'Brasileirão', status: 'ongoing', has_penalty_phases: false },
        { id: 'cl', name: 'Champions League', status: 'upcoming', has_penalty_phases: false },
      ],
    })
  })

  it('hides pilot competitions from ordinary users and shows them to admin and pilot guests', async () => {
    const app = new Hono<AppContext>()
    app.route('/competitions', competitionsRouter)

    const competitions = [
      { id: 'br', name: 'Brasileirão', penalty_phases: '[]', visibility: 'public' },
      { id: 'cl', name: 'Champions League', penalty_phases: '["FINAL"]', visibility: 'pilot' },
    ]

    const env = fakeEnv(createDbMock(competitions), {
      ADMIN_EMAIL: 'admin@palpitae.com.br',
      PILOT_EMAILS: 'convidado@example.com',
    })

    const ordinaryToken = await signJwt(
      { sub: 'u-ordinary', email: 'comum@example.com' },
      'secret',
      3600,
    )
    const ordinaryRes = await app.fetch(
      new Request('http://localhost/competitions', {
        headers: { Cookie: `session=${ordinaryToken}` },
      }),
      env,
    )
    expect(await ordinaryRes.json()).toEqual({
      competitions: [{ id: 'br', name: 'Brasileirão', has_penalty_phases: false }],
    })

    const guestToken = await signJwt(
      { sub: 'u-guest', email: 'convidado@example.com' },
      'secret',
      3600,
    )
    const guestRes = await app.fetch(
      new Request('http://localhost/competitions', {
        headers: { Cookie: `session=${guestToken}` },
      }),
      env,
    )
    expect(await guestRes.json()).toEqual({
      competitions: [
        { id: 'br', name: 'Brasileirão', has_penalty_phases: false },
        { id: 'cl', name: 'Champions League', has_penalty_phases: true },
      ],
    })

    const adminToken = await signJwt(
      { sub: 'u-admin', email: 'admin@palpitae.com.br' },
      'secret',
      3600,
    )
    const adminRes = await app.fetch(
      new Request('http://localhost/competitions', {
        headers: { Cookie: `session=${adminToken}` },
      }),
      env,
    )
    expect(await adminRes.json()).toEqual({
      competitions: [
        { id: 'br', name: 'Brasileirão', has_penalty_phases: false },
        { id: 'cl', name: 'Champions League', has_penalty_phases: true },
      ],
    })
  })

  /**
   * O CASE de status derivado é a parte mais arriscada do query — rodá-lo num
   * SQLite real (mesma migrations de produção) cobre os ramos que o mock de D1
   * não executa. Cada competição abaixo exercita um ramo do CASE.
   */
  it('deriva status a partir das partidas, executando o SQL em SQLite real', async () => {
    const { sqlite, db } = createSqliteD1()
    // A descoberta da ESPN só enxerga 7 dias adiante; a pausa conta do relógio do SQLite.
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    try {
      sqlite.exec(`
        DELETE FROM competitions;
        INSERT INTO teams (id, name, slug, provider) VALUES
          ('t-h', 'Mandante', 'mandante', 'espn'),
          ('t-a', 'Visitante', 'visitante', 'espn');
        INSERT INTO competitions (id, name, slug, season, status, provider, type) VALUES
          ('c-concluida', 'Concluída', 'deriva-concluida', '2026', 'upcoming', 'football-data', 'league'), -- liga de calendário completo, todas encerradas → finished
          ('c-rolando',   'Rolando',   'deriva-rolando',   '2026', 'upcoming', 'espn', 'league'), -- encerrada + pendente → ongoing
          ('c-futura',    'Futura',    'deriva-futura',    '2027', 'upcoming', 'espn', 'league'), -- só futuras → coluna
          ('c-coluna',    'Coluna',    'deriva-coluna',    '2027', 'finished', 'espn', 'league'), -- sem jogos, coluna finished → finished
          ('c-live',      'Ao vivo',   'deriva-live',      '2026', 'upcoming', 'espn', 'league'), -- finished + live → ongoing
          ('c-bateria',   'Bateria',   'deriva-bateria',   '2027', 'upcoming', 'espn', 'league'), -- live + futura, sem finished → coluna
          ('c-entre',     'Entre fases', 'deriva-entre',  '2026', 'upcoming', 'espn', 'cup'),    -- copa, tudo encerrado, sem final → ongoing
          ('c-final',     'Com final', 'deriva-final',    '2026', 'upcoming', 'espn', 'cup'),    -- copa com final encerrada → finished
          ('c-pausa',     'Pausa',     'deriva-pausa',    '2026', 'ongoing', 'espn', 'league');  -- liga da ESPN em data FIFA → ongoing
        INSERT INTO matches (id, competition_id, external_id, provider, home_team_id, away_team_id, start_time, status, round, home_score, away_score) VALUES
          ('m-a1', 'c-concluida', 'x1', 'espn', 't-h', 't-a', '2026-10-01T12:00:00Z', 'finished', '1', 1, 0),
          ('m-a2', 'c-concluida', 'x2', 'espn', 't-h', 't-a', '2026-10-02T12:00:00Z', 'finished', '1', 1, 0),
          ('m-b1', 'c-rolando',   'x3', 'espn', 't-h', 't-a', '2026-10-01T12:00:00Z', 'finished', '1', 1, 0),
          ('m-b2', 'c-rolando',   'x4', 'espn', 't-h', 't-a', '2027-01-01T12:00:00Z', 'scheduled', '1', NULL, NULL),
          ('m-c1', 'c-futura',    'x5', 'espn', 't-h', 't-a', '2027-01-01T12:00:00Z', 'scheduled', '1', NULL, NULL),
          ('m-e1', 'c-live',      'x6', 'espn', 't-h', 't-a', '2026-10-01T12:00:00Z', 'finished', '1', 1, 0),
          ('m-e2', 'c-live',      'x7', 'espn', 't-h', 't-a', '2026-10-02T12:00:00Z', 'live', '1', NULL, NULL),
          ('m-f1', 'c-bateria',   'x8', 'espn', 't-h', 't-a', '2027-01-01T12:00:00Z', 'live', '1', NULL, NULL),
          ('m-f2', 'c-bateria',   'x9', 'espn', 't-h', 't-a', '2027-01-02T12:00:00Z', 'scheduled', '1', NULL, NULL),
          ('m-g1', 'c-entre',     'y1', 'espn', 't-h', 't-a', '2026-10-01T12:00:00Z', 'finished', '1', 1, 0),
          ('m-g2', 'c-entre',     'y2', 'espn', 't-h', 't-a', '2026-10-02T12:00:00Z', 'finished', '1', 1, 0),
          ('m-h1', 'c-final',     'y3', 'espn', 't-h', 't-a', '2026-10-01T12:00:00Z', 'finished', '1', 1, 0),
          ('m-h2', 'c-final',     'y4', 'espn', 't-h', 't-a', '2026-10-02T12:00:00Z', 'finished', '1', 1, 0),
          ('m-i1', 'c-pausa',     'y5', 'espn', 't-h', 't-a', '${tenDaysAgo}', 'finished', '1', 1, 0);
        UPDATE matches SET phase = 'SEMI_FINALS' WHERE id IN ('m-g1', 'm-g2', 'm-h1');
        UPDATE matches SET phase = 'FINAL' WHERE id = 'm-h2';
      `)

      const app = new Hono<AppContext>()
      app.route('/competitions', competitionsRouter)

      const token = await signJwt({ sub: 'test-user', email: 'test@example.com' }, 'secret', 3600)
      const response = await app.fetch(
        new Request('http://localhost/competitions', {
          headers: { Cookie: `session=${token}` },
        }),
        fakeEnv(db),
      )

      expect(response.status).toBe(200)
      const body = (await response.json()) as {
        competitions: { id: string; status: string }[]
      }
      const statusById = Object.fromEntries(
        body.competitions.map((c) => [c.id, c.status]),
      )

      expect(statusById['c-concluida']).toBe('finished')
      expect(statusById['c-rolando']).toBe('ongoing')
      expect(statusById['c-futura']).toBe('upcoming')
      expect(statusById['c-coluna']).toBe('finished')
      // 'live' é pendente: encerrada + ao vivo → ongoing.
      expect(statusById['c-live']).toBe('ongoing')
      // Ao vivo + futura, sem nenhuma encerrada → mantém a coluna.
      expect(statusById['c-bateria']).toBe('upcoming')
      // Copa entre fases não tem final gravada: segue em andamento.
      expect(statusById['c-entre']).toBe('ongoing')
      expect(statusById['c-final']).toBe('finished')
      expect(statusById['c-pausa']).toBe('ongoing')
    } finally {
      sqlite.close()
    }
  })

  it('returns 500 on database error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const app = new Hono<AppContext>()
    app.route('/competitions', competitionsRouter)

    const token = await signJwt({ sub: 'test-user', email: 'test@example.com' }, 'secret', 3600)
    const response = await app.fetch(
      new Request('http://localhost/competitions', {
        headers: {
          Cookie: `session=${token}`,
        },
      }),
      fakeEnv(createDbMock([], true)),
    )

    expect(response.status).toBe(500)

    const body = await response.json()
    expect(body).toEqual({ error: 'Erro ao carregar competições' })

    consoleSpy.mockRestore()
  })

  describe('POST /competitions/:id/promote', () => {
    function createPromoteDbMock(found: { id: string; slug: string } | null) {
      const updateRun = vi.fn().mockResolvedValue({ success: true })
      const db = {
        prepare: vi.fn((sql: string) => ({
          bind: () => ({
            first: async () => {
              if (sql.includes('FROM revoked_sessions')) return null
              if (sql.includes('FROM competitions WHERE id = ? OR slug = ?')) return found
              return null
            },
            run: updateRun,
          }),
        })),
      } as unknown as D1Database
      return { db, updateRun }
    }

    it('rejects non-admin users with 403', async () => {
      const app = new Hono<AppContext>()
      app.route('/competitions', competitionsRouter)
      const { db, updateRun } = createPromoteDbMock({ id: 'cl', slug: 'champions-league' })

      const token = await signJwt(
        { sub: 'u-guest', email: 'convidado@example.com' },
        'secret',
        3600,
      )
      const res = await app.fetch(
        new Request('http://localhost/competitions/cl/promote', {
          method: 'POST',
          headers: { Cookie: `session=${token}` },
        }),
        fakeEnv(db, {
          ADMIN_EMAIL: 'admin@palpitae.com.br',
          PILOT_EMAILS: 'convidado@example.com',
        }),
      )

      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({
        error: 'Apenas o administrador pode promover competições',
      })
      expect(updateRun).not.toHaveBeenCalled()
    })

    it('returns 404 when competition does not exist', async () => {
      const app = new Hono<AppContext>()
      app.route('/competitions', competitionsRouter)
      const { db, updateRun } = createPromoteDbMock(null)

      const token = await signJwt(
        { sub: 'u-admin', email: 'admin@palpitae.com.br' },
        'secret',
        3600,
      )
      const res = await app.fetch(
        new Request('http://localhost/competitions/inexistente/promote', {
          method: 'POST',
          headers: { Cookie: `session=${token}` },
        }),
        fakeEnv(db, { ADMIN_EMAIL: 'admin@palpitae.com.br' }),
      )

      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: 'Competição não encontrada' })
      expect(updateRun).not.toHaveBeenCalled()
    })

    it('promotes competition to public when called by admin', async () => {
      const app = new Hono<AppContext>()
      app.route('/competitions', competitionsRouter)
      const { db, updateRun } = createPromoteDbMock({
        id: 'cl-2026',
        slug: 'champions-league-2025-26',
      })

      const token = await signJwt(
        { sub: 'u-admin', email: 'admin@palpitae.com.br' },
        'secret',
        3600,
      )
      const res = await app.fetch(
        new Request('http://localhost/competitions/champions-league-2025-26/promote', {
          method: 'POST',
          headers: { Cookie: `session=${token}` },
        }),
        fakeEnv(db, { ADMIN_EMAIL: 'admin@palpitae.com.br' }),
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        ok: true,
        competition: {
          id: 'cl-2026',
          slug: 'champions-league-2025-26',
          visibility: 'public',
        },
      })
      expect(updateRun).toHaveBeenCalledOnce()
    })
  })
})

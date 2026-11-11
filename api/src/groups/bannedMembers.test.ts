import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import { predictionsRouter } from '../predictions/router'
import type { AppContext } from '../types'
import { groupsRouter } from './router'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('owner','owner@test.com','google','owner'), ('member','member@test.com','google','member'),
      ('other','other@test.com','google','other');
    INSERT INTO competitions (id,name,slug,status) VALUES ('c','C','test-c','ongoing');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code)
      VALUES ('g','Grupo','c','owner','ABCD-EFGH');
    INSERT INTO group_members (id,group_id,user_id,role) VALUES
      ('o','g','owner','owner'), ('m','g','member','member');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
      VALUES ('locked','c','locked','test','h','v','2000-01-01T00:00:00Z','finished','1'),
             ('open','c','open','test','h','v','2099-01-01T00:00:00Z','scheduled','1');
    INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
      VALUES ('p1','member','g','locked',2,1), ('p2','member','g','open',3,0),
             ('p3','owner','g','locked',1,0);
  `)
  let pause: { reached: () => void; resume: Promise<void> } | undefined
  const wrapped = {
    ...db,
    prepare(sql: string) {
      const statement = db.prepare(sql)
      if (!sql.startsWith('SELECT user_id FROM group_bans')) return statement
      return {
        bind(...values: unknown[]) {
          const bound = statement.bind(...values)
          return {
            ...bound,
            async first() {
              const result = await bound.first()
              const barrier = pause
              pause = undefined
              if (barrier) {
                barrier.reached()
                await barrier.resume
              }
              return result
            },
          }
        },
      }
    },
  } as D1Database
  const app = new Hono<AppContext>()
  app.route('/groups', groupsRouter)
  app.route('/predictions', predictionsRouter)
  async function request(user: string, path: string, method = 'GET') {
    const token = await signJwt({ sub: user, email: `${user}@test.com` }, 'secret', 3600)
    const response = await app.fetch(
      new Request(`https://test${path}`, {
        method,
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ invite_code: 'ABCD-EFGH' }) } : {}),
      }),
      { DB: wrapped, JWT_SECRET: 'secret' } as AppContext['Bindings'],
    )
    const body = (await response.json()) as Record<string, unknown>
    console.log(method, path, user, response.status, JSON.stringify(body))
    return { status: response.status, body }
  }
  function barrier() {
    let release!: () => void
    let reached!: () => void
    const ready = new Promise<void>((resolve) => {
      reached = resolve
    })
    const resume = new Promise<void>((resolve) => {
      release = resolve
    })
    pause = { reached, resume }
    return { ready, release }
  }
  const members = () =>
    sqlite.prepare('SELECT user_id, role FROM group_members ORDER BY user_id').all()
  return { sqlite, request, barrier, members }
}

describe('Admissão e banimento com SQLite real', () => {
  it('recusa join que leu ausência de ban antes da remoção pelo dono', async () => {
    const { request, barrier, members, sqlite } = setup()
    const gate = barrier()
    const joining = request('member', '/groups/join', 'POST')
    await gate.ready
    try {
      expect(await request('owner', '/groups/g/members/member', 'DELETE')).toEqual({
        status: 200,
        body: { success: true },
      })
    } finally {
      gate.release()
    }
    expect(await joining).toEqual({
      status: 403,
      body: { error: 'Acesso revogado pelo administrador' },
    })
    expect(members()).toEqual([{ user_id: 'owner', role: 'owner' }])
    expect(sqlite.prepare('SELECT user_id FROM group_bans').all()).toEqual([{ user_id: 'member' }])
    expect((await request('member', '/groups/join', 'POST')).status).toBe(403)
  })

  it.each(['convite', 'exclusão'])('recusa entrada se %s mudou durante o join', async (change) => {
    const { request, barrier, sqlite, members } = setup()
    const gate = barrier()
    const joining = request('other', '/groups/join', 'POST')
    await gate.ready
    if (change === 'convite')
      sqlite.exec("UPDATE groups SET invite_code = 'NOVO-CODI' WHERE id = 'g'")
    else sqlite.exec("UPDATE groups SET deleted_at = '2026-01-01' WHERE id = 'g'")
    gate.release()
    expect(await joining).toEqual({ status: 404, body: { error: 'Código de convite inválido' } })
    expect(members()).toHaveLength(2)
  })

  it('saída voluntária permite voltar como membro e preserva o dono', async () => {
    const { request, members } = setup()
    expect((await request('member', '/groups/g/members/member', 'DELETE')).status).toBe(200)
    expect((await request('member', '/groups/join', 'POST')).status).toBe(200)
    expect(members()).toEqual([
      { user_id: 'member', role: 'member' },
      { user_id: 'owner', role: 'owner' },
    ])
    expect((await request('owner', '/groups/g/members/owner', 'DELETE')).status).toBe(400)
    expect((await request('member', '/groups/g/members/owner', 'DELETE')).status).toBe(403)
    expect((await request('owner', '/groups/join', 'POST')).status).toBe(409)
    expect(members()).toEqual([
      { user_id: 'member', role: 'member' },
      { user_id: 'owner', role: 'owner' },
    ])
  })

  it.each(['hidden', 'public'])(
    'exclui banido residual da lista e dos palpites em grupo %s',
    async (visibility) => {
      const { request, sqlite } = setup()
      sqlite.prepare('UPDATE groups SET predictions_visibility = ?').run(visibility)
      sqlite.exec("INSERT INTO group_bans (group_id,user_id) VALUES ('g','member')")
      const result = await request('owner', '/predictions/group?group_id=g')
      expect(result.status).toBe(200)
      expect(result.body.members).toEqual([{ user_id: 'owner', display: 'ow***@test.com' }])
      expect(result.body.predictions).toEqual([
        expect.objectContaining({ user_id: 'owner', match_id: 'locked' }),
      ])
      expect(result.body.open_pickers).toEqual({})
    },
  )
})

import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { AppContext } from '../types'
import { predictionsRouter } from './router'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  vi.useRealTimers()
  for (const sqlite of handles.splice(0)) sqlite.close()
})

type BulkBody = { ok: boolean; saved: string[]; locked: string[]; not_found: string[] }

/**
 * Rota inteira sobre o D1 em memória. `hooks.beforeWrite` roda depois das leituras
 * do handler e antes da gravação, a janela em que o kickoff passa na corrida.
 */
function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const hooks: { beforeWrite?: () => void } = {}
  const intercepted = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql: string) => {
          const statement = target.prepare(sql)
          if (!/^\s*INSERT INTO predictions/i.test(sql)) return statement
          return new Proxy(statement, {
            get(stmt, key, stmtReceiver) {
              if (key === 'bind') {
                return (...args: unknown[]) => {
                  const bound = stmt.bind(...args)
                  return new Proxy(bound, {
                    get(b, bKey, bReceiver) {
                      if (bKey === 'run') {
                        return () => {
                          hooks.beforeWrite?.()
                          return b.run()
                        }
                      }
                      return Reflect.get(b, bKey, bReceiver)
                    },
                  })
                }
              }
              return Reflect.get(stmt, key, stmtReceiver)
            },
          })
        }
      }
      if (prop === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          hooks.beforeWrite?.()
          return target.batch(statements)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES ('a','a@test.com','google','a');
    INSERT INTO competitions (id,name,slug,status) VALUES ('c','C','test-c','ongoing');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round) VALUES
      ('m1','c','e1','test','h','v','2099-01-01T00:00:00Z','scheduled','1'),
      ('m2','c','e2','test','v','h','2099-01-02T00:00:00Z','scheduled','1');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,points_exact,points_winner)
      VALUES ('g','Grupo','c','a','g',3,1);
    INSERT INTO group_members (id,group_id,user_id) VALUES ('1','g','a');
  `)
  const app = new Hono<AppContext>()
  app.route('/predictions', predictionsRouter)
  async function send(path: string, body: unknown) {
    const token = await signJwt({ sub: 'a', email: 'a@test.com' }, 'secret', 3600)
    return app.fetch(
      new Request(`https://test/predictions${path}`, {
        method: 'PUT',
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { DB: intercepted, JWT_SECRET: 'secret' } as AppContext['Bindings'],
    )
  }
  const put = (matchId: string, home: number, away: number) =>
    send('', {
      group_id: 'g',
      match_id: matchId,
      predicted_home_score: home,
      predicted_away_score: away,
    })
  const bulk = async (picks: [string, number, number][]) => {
    const response = await send('/bulk', {
      group_id: 'g',
      predictions: picks.map(([match_id, home, away]) => ({
        match_id,
        predicted_home_score: home,
        predicted_away_score: away,
      })),
    })
    return { status: response.status, body: (await response.json()) as BulkBody }
  }
  const stored = (match: string) =>
    sqlite
      .prepare(
        `SELECT predicted_home_score AS h, predicted_away_score AS a
         FROM predictions WHERE user_id = 'a' AND group_id = 'g' AND match_id = ?`,
      )
      .get(match) as { h: number; a: number } | undefined
  return { put, bulk, stored, sqlite, hooks }
}

/** Jeitos de o jogo travar depois que o handler já o leu como aberto. */
const LOCKS = {
  'o sync marca o jogo como ao vivo': (sqlite: ReturnType<typeof setup>['sqlite']) => {
    sqlite.exec(`UPDATE matches SET status = 'live' WHERE id = 'm1'`)
  },
  'o relógio do banco passa o kickoff': (sqlite: ReturnType<typeof setup>['sqlite']) => {
    // O relógio do handler fica 10 s atrás do relógio do banco. `status` e `locked_at` não mudam.
    const real = Date.now()
    sqlite
      .prepare(`UPDATE matches SET start_time = ? WHERE id = 'm1'`)
      .run(new Date(real - 5_000).toISOString().replace(/\.\d{3}Z$/, 'Z'))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(real - 10_000)
  },
}

describe('trava conferida no comando que grava', () => {
  it('grava o palpite com o jogo aberto', async () => {
    const { put, bulk, stored } = setup()
    expect((await put('m1', 2, 1)).status).toBe(200)
    expect(stored('m1')).toEqual({ h: 2, a: 1 })
    expect((await bulk([['m2', 1, 0]])).body.saved).toEqual(['m2'])
    expect(stored('m2')).toEqual({ h: 1, a: 0 })
  })

  describe.each(Object.entries(LOCKS))('quando %s entre a leitura e a escrita', (_, lock) => {
    it('PUT recusa a gravação com 422 e não deixa palpite', async () => {
      const { put, stored, sqlite, hooks } = setup()
      hooks.beforeWrite = () => lock(sqlite)
      const response = await put('m1', 2, 1)
      expect(response.status).toBe(422)
      expect(await response.json()).toEqual({ error: 'Palpite bloqueado — o jogo já começou' })
      expect(stored('m1')).toBeUndefined()
    })

    it('PUT mantém o palpite que já existia', async () => {
      const { put, stored, sqlite, hooks } = setup()
      sqlite.exec(`
        INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
        VALUES ('p1','a','g','m1',0,0)
      `)
      hooks.beforeWrite = () => lock(sqlite)
      expect((await put('m1', 2, 1)).status).toBe(422)
      expect(stored('m1')).toEqual({ h: 0, a: 0 })
    })

    it('bulk devolve o jogo em locked, grava os outros e não deixa palpite no travado', async () => {
      const { bulk, stored, sqlite, hooks } = setup()
      hooks.beforeWrite = () => lock(sqlite)
      const { status, body } = await bulk([
        ['m1', 2, 1],
        ['m2', 1, 0],
      ])
      expect(status).toBe(200)
      expect(body).toEqual({ ok: true, saved: ['m2'], locked: ['m1'], not_found: [] })
      expect(stored('m1')).toBeUndefined()
      expect(stored('m2')).toEqual({ h: 1, a: 0 })
    })

    it('bulk com um único jogo travado não grava nada e responde ok', async () => {
      const { bulk, stored, sqlite, hooks } = setup()
      hooks.beforeWrite = () => lock(sqlite)
      const { status, body } = await bulk([['m1', 2, 1]])
      expect(status).toBe(200)
      expect(body).toEqual({ ok: true, saved: [], locked: ['m1'], not_found: [] })
      expect(stored('m1')).toBeUndefined()
    })
  })
})

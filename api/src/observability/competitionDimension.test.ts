import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import { groupsRouter } from '../groups/router'
import { predictionsRouter } from '../predictions/router'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { AppContext } from '../types'
import { hashUserId } from './events'

/**
 * `prediction_saved` e `group_deleted` carregam o `competition_id` do grupo
 * (docs/observability.md). Roda os routers de verdade contra SQLite para provar
 * que a dimensão sai depois da mutação e que as posições antigas não mudam.
 */

const SECRET = 'secret'
const COMP_A = '11111111-2222-4333-8444-555555555555'
const COMP_B = '66666666-7777-4888-8999-aaaaaaaaaaaa'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

type Point = { indexes?: string[]; blobs?: string[]; doubles?: number[] }

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('a','a@test.com','google','a');
    INSERT INTO competitions (id,name,slug,status) VALUES
      ('${COMP_A}','Liga A','liga-a','ongoing'), ('${COMP_B}','Liga B','liga-b','ongoing');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
      VALUES ('m1','${COMP_A}','x1','test','h','v','2099-01-01T00:00:00Z','scheduled','7'),
             ('m2','${COMP_A}','x2','test','h','v','2099-01-02T00:00:00Z','scheduled','8');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code) VALUES
      ('g-a','A','${COMP_A}','a','CODEA'), ('g-a2','A2','${COMP_A}','a','CODEA2'),
      ('g-b','B','${COMP_B}','a','CODEB');
    INSERT INTO group_members (id,group_id,user_id) VALUES
      ('m-a','g-a','a'), ('m-a2','g-a2','a'), ('m-b','g-b','a');
  `)
  const points: Point[] = []
  const env = {
    DB: db,
    JWT_SECRET: SECRET,
    AE: {
      writeDataPoint: (p: Point) => points.push(p),
    } as unknown as AnalyticsEngineDataset,
  } as unknown as AppContext['Bindings']
  const app = new Hono<AppContext>()
  app.route('/predictions', predictionsRouter)
  app.route('/groups', groupsRouter)

  async function call(method: string, path: string, body?: unknown) {
    const token = await signJwt({ sub: 'a', email: 'a@test.com' }, SECRET, 3600)
    return app.fetch(
      new Request(`https://test${path}`, {
        method,
        headers: {
          Cookie: `session=${token}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
    )
  }
  const events = (type: string) => points.filter((p) => p.indexes?.[0] === type)
  return { call, events }
}

describe('competition_id nos eventos de negócio', () => {
  it('PUT /predictions grava o campeonato em blob6, depois de kind (blob5)', async () => {
    const { call, events } = setup()
    const res = await call('PUT', '/predictions', {
      group_id: 'g-a',
      match_id: 'm1',
      predicted_home_score: 2,
      predicted_away_score: 1,
    })
    expect(res.status).toBe(200)

    const [point] = events('prediction_saved')
    // blob1 event_type, blob2 group, blob3 round, blob4 user_hash, blob5 kind: posições
    // antigas intactas; a dimensão nova só acrescenta no fim.
    expect(point.blobs).toEqual([
      'prediction_saved',
      'g-a',
      '7',
      await hashUserId('a'),
      'single',
      COMP_A,
    ])
    expect(point.doubles).toEqual([1])
  })

  it('PUT /predictions/bulk grava o campeonato do grupo, com round vazio', async () => {
    const { call, events } = setup()
    const res = await call('PUT', '/predictions/bulk', {
      group_id: 'g-a',
      predictions: [
        { match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0 },
        { match_id: 'm2', predicted_home_score: 0, predicted_away_score: 0 },
      ],
    })
    expect(res.status).toBe(200)

    const [point] = events('prediction_saved')
    expect(point.blobs).toEqual([
      'prediction_saved',
      'g-a',
      '',
      await hashUserId('a'),
      'bulk',
      COMP_A,
    ])
    expect(point.doubles).toEqual([2])
  })

  it('bulk que não salva nada (jogo inexistente no grupo) não emite evento', async () => {
    const { call, events } = setup()
    const res = await call('PUT', '/predictions/bulk', {
      group_id: 'g-b',
      predictions: [{ match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0 }],
    })
    expect(res.status).toBe(200)
    expect(events('prediction_saved')).toHaveLength(0)
  })

  it('POST /predictions/import grava o campeonato do grupo de destino', async () => {
    const { call, events } = setup()
    await call('PUT', '/predictions', {
      group_id: 'g-a',
      match_id: 'm1',
      predicted_home_score: 2,
      predicted_away_score: 1,
    })
    const res = await call('POST', '/predictions/import', {
      source_group_id: 'g-a',
      target_group_id: 'g-a2',
    })
    expect(res.status).toBe(200)

    const point = events('prediction_saved').find((p) => p.blobs?.[4] === 'import')
    expect(point?.blobs).toEqual([
      'prediction_saved',
      'g-a2',
      '',
      await hashUserId('a'),
      'import',
      COMP_A,
    ])
    expect(point?.doubles).toEqual([1])
  })

  it('palpite recusado (jogo de outra competição) não emite evento', async () => {
    const { call, events } = setup()
    const res = await call('PUT', '/predictions', {
      group_id: 'g-b',
      match_id: 'm1',
      predicted_home_score: 2,
      predicted_away_score: 1,
    })
    expect(res.status).toBe(404)
    expect(events('prediction_saved')).toHaveLength(0)
  })

  it('DELETE /groups/:id grava o campeonato em blob4, depois de user_hash (blob3)', async () => {
    const { call, events } = setup()
    const res = await call('DELETE', '/groups/g-b')
    expect(res.status).toBe(200)

    const [point] = events('group_deleted')
    expect(point.blobs).toEqual(['group_deleted', 'g-b', await hashUserId('a'), COMP_B])
  })

  it('exclusão negada não emite group_deleted', async () => {
    const { call, events } = setup()
    expect((await call('DELETE', '/groups/nao-existe')).status).toBe(404)
    expect(events('group_deleted')).toHaveLength(0)
  })

  it('não grava PII: nenhum blob com e-mail nem user_id cru', async () => {
    const { call, events } = setup()
    await call('PUT', '/predictions', {
      group_id: 'g-a',
      match_id: 'm1',
      predicted_home_score: 2,
      predicted_away_score: 1,
    })
    await call('DELETE', '/groups/g-b')
    const all = JSON.stringify([...events('prediction_saved'), ...events('group_deleted')])
    expect(all).not.toContain('a@test.com')
    for (const p of [...events('prediction_saved'), ...events('group_deleted')]) {
      expect(p.blobs).not.toContain('a')
    }
  })
})

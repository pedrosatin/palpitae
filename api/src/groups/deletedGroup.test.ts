import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import { scoreUnprocessedMatches } from '../matches/scoring'
import { predictionsRouter } from '../predictions/router'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { AppContext } from '../types'
import { groupsRouter } from './router'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

/**
 * Dois grupos da mesma competição palpitam o mesmo jogo: `ativo` segue no ar e
 * `velho` é excluído pelo dono. Os palpites são iguais nos dois grupos, então
 * qualquer diferença de pontos vem da exclusão.
 */
function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('ana','ana@test.com','google','ana'), ('bia','bia@test.com','google','bia');
    INSERT INTO competitions (id,name,slug,status) VALUES ('c','C','test-c','ongoing');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code) VALUES
      ('ativo','Ativo','c','ana','ATIV-OOOO'), ('velho','Velho','c','ana','VELH-OOOO');
    INSERT INTO group_members (id,group_id,user_id,role) VALUES
      ('a1','ativo','ana','owner'), ('a2','ativo','bia','member'),
      ('v1','velho','ana','owner'), ('v2','velho','bia','member');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
      VALUES ('jogo','c','jogo','test','h','v','2000-01-01T00:00:00Z','scheduled','1'),
             ('aberto','c','aberto','test','h','v','2099-01-01T00:00:00Z','scheduled','1');
    INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score) VALUES
      ('pa-ana','ana','ativo','jogo',2,1), ('pa-bia','bia','ativo','jogo',0,0),
      ('pv-ana','ana','velho','jogo',2,1), ('pv-bia','bia','velho','jogo',0,0);
  `)
  const app = new Hono<AppContext>()
  app.route('/groups', groupsRouter)
  app.route('/predictions', predictionsRouter)
  async function request(user: string, path: string, method = 'GET', body?: unknown) {
    const token = await signJwt({ sub: user, email: `${user}@test.com` }, 'secret', 3600)
    const response = await app.fetch(
      new Request(`https://test${path}`, {
        method,
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      { DB: db, JWT_SECRET: 'secret' } as AppContext['Bindings'],
    )
    return response.status
  }
  function finish(home: number, away: number) {
    sqlite.exec(
      `UPDATE matches SET status = 'finished', home_score = ${home}, away_score = ${away},
         scored_at = NULL WHERE id = 'jogo'`,
    )
  }
  const points = () =>
    sqlite
      .prepare('SELECT id, points_awarded FROM predictions WHERE match_id = ? ORDER BY id')
      .all('jogo')
  const leaderboard = () =>
    sqlite
      .prepare(
        'SELECT group_id, user_id, total_points, exact_hits FROM leaderboard ORDER BY group_id, user_id',
      )
      .all()
  return { sqlite, db, request, finish, points, leaderboard }
}

describe('Grupo excluído', () => {
  it('recusa as ações dos membros depois da exclusão', async () => {
    const { request, sqlite } = setup()
    expect(await request('ana', '/groups/velho', 'DELETE')).toBe(200)

    expect(await request('bia', '/groups/velho')).toBe(404)
    expect(await request('bia', '/groups/velho/members')).toBe(404)
    expect(await request('ana', '/groups/velho', 'PATCH', { name: 'Novo' })).toBe(404)
    expect(await request('ana', '/groups/velho/invite/rotate', 'POST')).toBe(404)
    expect(await request('ana', '/groups/velho/members/bia', 'DELETE')).toBe(404)
    expect(await request('ana', '/groups/velho', 'DELETE')).toBe(404)
    expect(
      await request('bia', '/predictions', 'PUT', {
        group_id: 'velho',
        match_id: 'aberto',
        predicted_home_score: 1,
        predicted_away_score: 0,
      }),
    ).toBe(403)
    expect(await request('bia', '/groups/join', 'POST', { invite_code: 'VELH-OOOO' })).toBe(404)
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM predictions WHERE match_id = 'aberto'").get(),
    ).toEqual({ n: 0 })
  })

  it('não pontua nem atualiza o ranking do grupo excluído antes do resultado', async () => {
    const { request, db, finish, points, leaderboard } = setup()
    expect(await request('ana', '/groups/velho', 'DELETE')).toBe(200)

    finish(2, 1)
    await scoreUnprocessedMatches('c', db)

    expect(points()).toEqual([
      { id: 'pa-ana', points_awarded: 3 },
      { id: 'pa-bia', points_awarded: 0 },
      { id: 'pv-ana', points_awarded: 0 },
      { id: 'pv-bia', points_awarded: 0 },
    ])
    expect(leaderboard()).toEqual([
      { group_id: 'ativo', user_id: 'ana', total_points: 3, exact_hits: 1 },
      { group_id: 'ativo', user_id: 'bia', total_points: 0, exact_hits: 0 },
    ])
  })

  it('reprocessar um resultado corrigido preserva o histórico do grupo excluído', async () => {
    const { request, db, finish, points, leaderboard } = setup()
    finish(2, 1)
    await scoreUnprocessedMatches('c', db)
    expect(await request('ana', '/groups/velho', 'DELETE')).toBe(200)

    // Correção de placar depois da exclusão: o sync limpa scored_at e a pontuação refaz o jogo.
    finish(0, 0)
    await scoreUnprocessedMatches('c', db)

    expect(points()).toEqual([
      { id: 'pa-ana', points_awarded: 0 },
      { id: 'pa-bia', points_awarded: 3 },
      { id: 'pv-ana', points_awarded: 3 },
      { id: 'pv-bia', points_awarded: 0 },
    ])
    expect(leaderboard()).toEqual([
      { group_id: 'ativo', user_id: 'ana', total_points: 0, exact_hits: 0 },
      { group_id: 'ativo', user_id: 'bia', total_points: 3, exact_hits: 1 },
      { group_id: 'velho', user_id: 'ana', total_points: 3, exact_hits: 1 },
      { group_id: 'velho', user_id: 'bia', total_points: 0, exact_hits: 0 },
    ])
  })

  it('exclusão entre a leitura e a gravação dos pontos não pontua o grupo', async () => {
    const { sqlite, db, finish, points, leaderboard } = setup()
    finish(2, 1)
    // A exclusão chega depois da leitura dos palpites e antes da primeira gravação.
    let deleted = false
    const racing = {
      ...db,
      async batch(statements: Parameters<D1Database['batch']>[0]) {
        if (!deleted) {
          deleted = true
          sqlite.exec("UPDATE groups SET deleted_at = datetime('now') WHERE id = 'velho'")
        }
        return db.batch(statements)
      },
    } as D1Database
    await scoreUnprocessedMatches('c', racing)

    expect(deleted).toBe(true)
    expect(points()).toEqual([
      { id: 'pa-ana', points_awarded: 3 },
      { id: 'pa-bia', points_awarded: 0 },
      { id: 'pv-ana', points_awarded: 0 },
      { id: 'pv-bia', points_awarded: 0 },
    ])
    expect(leaderboard()).toEqual([
      { group_id: 'ativo', user_id: 'ana', total_points: 3, exact_hits: 1 },
      { group_id: 'ativo', user_id: 'bia', total_points: 0, exact_hits: 0 },
    ])
  })
})

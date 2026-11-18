import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { scoreUnprocessedMatches } from '../matches/scoring'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const SECRET = 'secret'
const API = 'https://api.test'
const FRONT = 'https://front.test'

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

/**
 * Ana é dona de três grupos:
 * - `bolao`: Bia e Dani entraram no mesmo instante, depois do Caio, que está banido.
 *   O mais antigo ativo é a Bia (empate no `joined_at`, desempate pelo id).
 * - `sozinha`: só a Ana e o Caio banido. Sem outro membro ativo, o grupo é apagado.
 * - `antigo`: grupo excluído pelo dono, com o Eli. Segue a mesma regra.
 * Ana também participa do `vizinho`, do Eli.
 */
function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('admin','admin@test.com','google','admin'), ('ana','ana@test.com','google','ana'),
      ('bia','bia@test.com','google','bia'), ('caio','caio@test.com','google','caio'),
      ('dani','dani@test.com','google','dani'), ('eli','eli@test.com','google','eli');
    INSERT INTO profiles (user_id,nickname) VALUES ('ana','Ana');
    INSERT INTO competitions (id,name,slug,status) VALUES ('c','C','test-c','ongoing');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
      VALUES ('jogo','c','jogo','test','h','v','2000-01-01T00:00:00Z','scheduled','1');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,deleted_at) VALUES
      ('bolao','Bolão','c','ana','BOLA-OOOO',NULL), ('sozinha','Sozinha','c','ana','SOZI-OOOO',NULL),
      ('antigo','Antigo','c','ana','ANTI-OOOO','2026-02-01T00:00:00Z'),
      ('vizinho','Vizinho','c','eli','VIZI-OOOO',NULL);
    INSERT INTO group_members (id,group_id,user_id,role,joined_at) VALUES
      ('b-ana','bolao','ana','owner','2026-01-01 00:00:00'),
      ('b-caio','bolao','caio','member','2026-01-01 10:00:00'),
      ('b-dani','bolao','dani','member','2026-01-02 00:00:00'),
      ('b-bia','bolao','bia','member','2026-01-02 00:00:00'),
      ('s-ana','sozinha','ana','owner','2026-01-01 00:00:00'),
      ('s-caio','sozinha','caio','member','2026-01-01 10:00:00'),
      ('a-ana','antigo','ana','owner','2026-01-01 00:00:00'),
      ('a-eli','antigo','eli','member','2026-01-03 00:00:00'),
      ('v-eli','vizinho','eli','owner','2026-01-01 00:00:00'),
      ('v-ana','vizinho','ana','member','2026-01-02 00:00:00');
    INSERT INTO group_bans (group_id,user_id) VALUES ('bolao','caio'), ('sozinha','caio');
    INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score) VALUES
      ('p-bolao-ana','ana','bolao','jogo',2,1), ('p-bolao-bia','bia','bolao','jogo',1,0),
      ('p-sozinha-ana','ana','sozinha','jogo',2,1), ('p-vizinho-ana','ana','vizinho','jogo',2,1),
      ('p-vizinho-eli','eli','vizinho','jogo',0,0);
    INSERT INTO email_reminder_sends (user_id,reminder_date) VALUES ('ana','2026-01-05');
  `)
  const env = {
    DB: db,
    JWT_SECRET: SECRET,
    BASE_URL: API,
    FRONTEND_URL: FRONT,
    ADMIN_EMAIL: 'admin@test.com',
  } as Env
  const ctx = {
    waitUntil() {},
    passThroughOnException() {},
    props: {},
  } as unknown as ExecutionContext

  async function call(user: string, path: string, method = 'GET') {
    const token = await signJwt({ sub: user, email: `${user}@test.com` }, SECRET, 3600)
    const response = await worker.fetch(
      new Request(`${API}${path}`, {
        method,
        headers: {
          Cookie: `session=${token}`,
          'CF-Connecting-IP': '192.0.2.1',
          ...(method === 'GET' ? {} : { Origin: FRONT }),
        },
      }),
      env,
      ctx,
    )
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }
  const rows = (sql: string) => sqlite.prepare(sql).all()
  return { sqlite, db, call, rows }
}

describe('Exclusão de conta pelo operador', () => {
  it('apagar direto a conta dona de grupo esbarra na chave estrangeira', () => {
    const { sqlite } = setup()
    expect(() => sqlite.exec("DELETE FROM users WHERE id = 'ana'")).toThrow(/FOREIGN KEY/)
  })

  it('passa o grupo ao membro ativo mais antigo e apaga o grupo sem outro membro', async () => {
    const { call, rows } = setup()

    const res = await call('admin', '/admin/users/ana', 'DELETE')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      ok: true,
      transferred_groups: [
        { group_id: 'antigo', new_owner_user_id: 'eli' },
        { group_id: 'bolao', new_owner_user_id: 'bia' },
      ],
      deleted_groups: ['sozinha'],
    })
    expect(rows("SELECT id FROM users WHERE id = 'ana'")).toEqual([])
    expect(rows('SELECT id, owner_user_id FROM groups ORDER BY id')).toEqual([
      { id: 'antigo', owner_user_id: 'eli' },
      { id: 'bolao', owner_user_id: 'bia' },
      { id: 'vizinho', owner_user_id: 'eli' },
    ])
    expect(rows('SELECT group_id, user_id, role FROM group_members ORDER BY group_id, user_id')).toEqual(
      [
        { group_id: 'antigo', user_id: 'eli', role: 'owner' },
        { group_id: 'bolao', user_id: 'bia', role: 'owner' },
        { group_id: 'bolao', user_id: 'caio', role: 'member' },
        { group_id: 'bolao', user_id: 'dani', role: 'member' },
        { group_id: 'vizinho', user_id: 'eli', role: 'owner' },
      ],
    )
    expect(rows('SELECT id FROM predictions ORDER BY id')).toEqual([
      { id: 'p-bolao-bia' },
      { id: 'p-vizinho-eli' },
    ])
    expect(rows("SELECT * FROM profiles WHERE user_id = 'ana'")).toEqual([])
    expect(rows("SELECT * FROM email_reminder_sends WHERE user_id = 'ana'")).toEqual([])
  })

  it('o novo dono administra o grupo e a sessão da conta apagada deixa de valer', async () => {
    const { call } = setup()
    expect((await call('admin', '/admin/users/ana', 'DELETE')).status).toBe(200)

    const group = await call('bia', '/groups/bolao')
    expect(group.status).toBe(200)
    expect((group.body.group as { is_admin: boolean }).is_admin).toBe(true)

    const members = await call('bia', '/groups/bolao/members')
    expect(
      (members.body.members as { user_id: string; role: string }[]).map((m) => [m.user_id, m.role]),
    ).toEqual(
      expect.arrayContaining([
        ['bia', 'owner'],
        ['dani', 'member'],
      ]),
    )
    expect((await call('bia', '/groups/bolao/members/dani', 'DELETE')).status).toBe(200)

    expect((await call('ana', '/groups')).status).toBe(401)
  })

  it('recusa quem não é admin e conta inexistente', async () => {
    const { call, rows } = setup()
    expect((await call('bia', '/admin/users/ana', 'DELETE')).status).toBe(403)
    expect(rows("SELECT id FROM users WHERE id = 'ana'")).toEqual([{ id: 'ana' }])
    expect((await call('admin', '/admin/users/ninguem', 'DELETE')).status).toBe(404)
  })

  it('recusa apagar a própria conta de admin', async () => {
    const { call, rows } = setup()
    expect((await call('admin', '/admin/users/admin', 'DELETE')).status).toBe(400)
    expect(rows("SELECT id FROM users WHERE id = 'admin'")).toEqual([{ id: 'admin' }])
  })

  it('exclui o dono depois que ele recusou um pedido (decided_by SET NULL)', async () => {
    const { sqlite, call, rows } = setup()
    sqlite.exec(`
      INSERT INTO users (id,email,provider,provider_id) VALUES ('pedido','pedido@test.com','google','pedido');
      INSERT INTO group_join_requests (id,group_id,user_id,status,decided_at,decided_by)
        VALUES ('jr-rej','bolao','pedido','rejected',datetime('now'),'ana');
    `)

    const res = await call('admin', '/admin/users/ana', 'DELETE')
    expect(res.status).toBe(200)
    expect(rows("SELECT id FROM users WHERE id = 'ana'")).toEqual([])
    expect(rows("SELECT id, decided_by FROM group_join_requests WHERE id = 'jr-rej'")).toEqual([
      { id: 'jr-rej', decided_by: null },
    ])
  })

  it('exclui o dono depois que ele aprovou um pedido', async () => {
    const { sqlite, call, rows } = setup()
    sqlite.exec(`
      INSERT INTO users (id,email,provider,provider_id) VALUES ('aprovado','aprovado@test.com','google','aprovado');
      INSERT INTO group_members (id,group_id,user_id,role,joined_at)
        VALUES ('b-aprovado','bolao','aprovado','member','2026-01-03 00:00:00');
      INSERT INTO group_join_requests (id,group_id,user_id,status,decided_at,decided_by)
        VALUES ('jr-ok','bolao','aprovado','approved',datetime('now'),'ana');
    `)

    const res = await call('admin', '/admin/users/ana', 'DELETE')
    expect(res.status).toBe(200)
    expect(rows("SELECT id FROM users WHERE id = 'ana'")).toEqual([])
    expect(rows("SELECT id, decided_by FROM group_join_requests WHERE id = 'jr-ok'")).toEqual([
      { id: 'jr-ok', decided_by: null },
    ])
  })

  it('exclui quem pediu e o pedido sai em cascata', async () => {
    const { sqlite, call, rows } = setup()
    sqlite.exec(`
      INSERT INTO users (id,email,provider,provider_id) VALUES ('pedido','pedido@test.com','google','pedido');
      INSERT INTO group_join_requests (id,group_id,user_id,status)
        VALUES ('jr-pend','bolao','pedido','pending');
    `)

    const res = await call('admin', '/admin/users/pedido', 'DELETE')
    expect(res.status).toBe(200)
    expect(rows("SELECT id FROM users WHERE id = 'pedido'")).toEqual([])
    expect(rows("SELECT id FROM group_join_requests WHERE id = 'jr-pend'")).toEqual([])
  })
})

describe('Papel de dono em group_members', () => {
  it('acompanha a troca manual de groups.owner_user_id', async () => {
    const { sqlite, call, rows } = setup()

    sqlite.exec("UPDATE groups SET owner_user_id = 'bia' WHERE id = 'bolao'")

    expect(
      rows("SELECT user_id, role FROM group_members WHERE group_id = 'bolao' ORDER BY user_id"),
    ).toEqual([
      { user_id: 'ana', role: 'member' },
      { user_id: 'bia', role: 'owner' },
      { user_id: 'caio', role: 'member' },
      { user_id: 'dani', role: 'member' },
    ])
    const asBia = await call('bia', '/groups/bolao')
    expect((asBia.body.group as { is_admin: boolean }).is_admin).toBe(true)
    const asAna = await call('ana', '/groups/bolao')
    expect((asAna.body.group as { is_admin: boolean }).is_admin).toBe(false)

    const members = await call('ana', '/groups/bolao/members')
    const owners = (members.body.members as { user_id: string; role: string }[]).filter(
      (m) => m.role === 'owner',
    )
    expect(owners.map((m) => m.user_id)).toEqual(['bia'])

    expect((await call('ana', '/groups/bolao/members/dani', 'DELETE')).status).toBe(403)
    expect((await call('bia', '/groups/bolao/members/ana', 'DELETE')).status).toBe(200)
  })

  it('não aceita papel de dono gravado para quem não é o dono do grupo', () => {
    const { sqlite, rows } = setup()

    sqlite.exec("UPDATE group_members SET role = 'owner' WHERE id = 'b-dani'")
    sqlite.exec("UPDATE group_members SET role = 'member' WHERE id = 'b-ana'")
    sqlite.exec(
      "INSERT INTO group_members (id,group_id,user_id,role) VALUES ('v-bia','vizinho','bia','owner')",
    )

    expect(
      rows(
        "SELECT id, role FROM group_members WHERE id IN ('b-ana','b-dani','v-bia') ORDER BY id",
      ),
    ).toEqual([
      { id: 'b-ana', role: 'owner' },
      { id: 'b-dani', role: 'member' },
      { id: 'v-bia', role: 'member' },
    ])
  })
})

/**
 * O jogo `dup` duplica o `jogo` com outro id externo. Os dois foram pontuados, e
 * quem palpitou só no duplicado ficaria com pontos de um jogo que não existe.
 */
function setupDuplicate() {
  const base = setup()
  base.sqlite.exec(`
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
      VALUES ('dup','c','dup','test','h','v','2000-01-01T00:00:00Z','scheduled','1');
    INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score) VALUES
      ('d-bolao-dani','dani','bolao','dup',2,1), ('d-bolao-bia','bia','bolao','dup',2,1),
      ('d-vizinho-eli','eli','vizinho','dup',2,1);
    UPDATE matches SET status = 'finished', home_score = 2, away_score = 1, scored_at = NULL;
  `)
  const leaderboard = () =>
    base.rows(
      'SELECT group_id, user_id, total_points, exact_hits FROM leaderboard ORDER BY group_id, user_id',
    )
  return { ...base, leaderboard }
}

describe('Remoção de jogo pelo operador', () => {
  it('apagar o jogo direto no banco deixa os pontos dele no ranking', async () => {
    const { db, sqlite, leaderboard } = setupDuplicate()
    await scoreUnprocessedMatches('c', db)

    sqlite.exec("DELETE FROM matches WHERE id = 'dup'")
    await scoreUnprocessedMatches('c', db)

    expect(leaderboard()).toContainEqual({
      group_id: 'bolao',
      user_id: 'dani',
      total_points: 3,
      exact_hits: 1,
    })
  })

  it('recalcula o ranking de todos os grupos da competição', async () => {
    const { db, call, rows, leaderboard } = setupDuplicate()
    await scoreUnprocessedMatches('c', db)
    expect(leaderboard()).toEqual([
      { group_id: 'bolao', user_id: 'ana', total_points: 3, exact_hits: 1 },
      { group_id: 'bolao', user_id: 'bia', total_points: 4, exact_hits: 1 },
      { group_id: 'bolao', user_id: 'dani', total_points: 3, exact_hits: 1 },
      { group_id: 'sozinha', user_id: 'ana', total_points: 3, exact_hits: 1 },
      { group_id: 'vizinho', user_id: 'ana', total_points: 3, exact_hits: 1 },
      { group_id: 'vizinho', user_id: 'eli', total_points: 3, exact_hits: 1 },
    ])

    const res = await call('admin', '/admin/matches/dup', 'DELETE')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, match_id: 'dup', competition_id: 'c', groups: 3 })
    expect(rows("SELECT id FROM matches WHERE id = 'dup'")).toEqual([])
    expect(rows("SELECT id FROM predictions WHERE match_id = 'dup'")).toEqual([])
    expect(leaderboard()).toEqual([
      { group_id: 'bolao', user_id: 'ana', total_points: 3, exact_hits: 1 },
      { group_id: 'bolao', user_id: 'bia', total_points: 1, exact_hits: 0 },
      { group_id: 'bolao', user_id: 'dani', total_points: 0, exact_hits: 0 },
      { group_id: 'sozinha', user_id: 'ana', total_points: 3, exact_hits: 1 },
      { group_id: 'vizinho', user_id: 'ana', total_points: 3, exact_hits: 1 },
      { group_id: 'vizinho', user_id: 'eli', total_points: 0, exact_hits: 0 },
    ])
  })

  it('devolve à fila de pontuação o outro jogo do confronto de mata-mata', async () => {
    const { sqlite, call, rows } = setupDuplicate()
    sqlite.exec(`
      UPDATE matches SET phase = 'LAST_16';
      UPDATE matches SET scored_at = '2000-01-02T00:00:00Z';
      INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,phase,home_score,away_score,scored_at)
        VALUES ('volta','c','volta','test','v','h','2000-01-08T00:00:00Z','finished','2','LAST_16',1,1,'2000-01-09T00:00:00Z'),
               ('outro','c','outro','test','v','h','2000-01-08T00:00:00Z','finished','2','QUARTER_FINALS',1,1,'2000-01-09T00:00:00Z');
    `)

    expect((await call('admin', '/admin/matches/dup', 'DELETE')).status).toBe(200)

    expect(rows('SELECT id, scored_at FROM matches ORDER BY id')).toEqual([
      { id: 'jogo', scored_at: '2000-01-02T00:00:00Z' },
      { id: 'outro', scored_at: '2000-01-09T00:00:00Z' },
      { id: 'volta', scored_at: null },
    ])
  })

  it('pontuação em curso não grava a volta com o bônus de uma ida apagada no meio', async () => {
    const { sqlite, db, call, rows } = setup()
    sqlite.exec(`
      UPDATE groups SET points_classified = 5 WHERE id = 'vizinho';
      INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,phase,leg,home_score,away_score,scored_at)
        VALUES ('ida','c','ida','test','h','v','2000-01-01T00:00:00Z','finished','1','LAST_16',1,2,0,'2000-01-02T00:00:00Z'),
               ('volta','c','volta','test','v','h','2000-01-08T00:00:00Z','finished','2','LAST_16',2,1,0,NULL);
      INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score) VALUES
        ('ida-eli','eli','vizinho','ida',2,0), ('volta-eli','eli','vizinho','volta',1,0);
    `)

    // Segura a pontuação depois de ler o confronto e antes do batch que grava pontos.
    let arrive!: () => void
    let release!: () => void
    const reached = new Promise<void>((resolve) => (arrive = resolve))
    const released = new Promise<void>((resolve) => (release = resolve))
    let held = false
    const paused = {
      prepare: (sql: string) => db.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        if (!held) {
          held = true
          arrive()
          await released
        }
        return db.batch(statements)
      },
    } as unknown as D1Database

    const scoring = scoreUnprocessedMatches('c', paused)
    await reached
    expect((await call('admin', '/admin/matches/ida', 'DELETE')).status).toBe(200)
    release()
    await scoring

    expect(rows("SELECT scored_at FROM matches WHERE id = 'volta'")).toEqual([{ scored_at: null }])

    await scoreUnprocessedMatches('c', db)
    expect(
      rows("SELECT total_points, exact_hits FROM leaderboard WHERE group_id = 'vizinho' AND user_id = 'eli'"),
    ).toEqual([{ total_points: 3, exact_hits: 1 }])
  })

  it('recusa quem não é admin e jogo inexistente', async () => {
    const { call, rows } = setupDuplicate()
    expect((await call('bia', '/admin/matches/dup', 'DELETE')).status).toBe(403)
    expect(rows("SELECT id FROM matches WHERE id = 'dup'")).toEqual([{ id: 'dup' }])
    expect((await call('admin', '/admin/matches/nenhum', 'DELETE')).status).toBe(404)
  })
})

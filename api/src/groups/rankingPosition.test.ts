import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import { scoreUnprocessedMatches } from '../matches/scoring'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { AppContext } from '../types'
import { groupsRouter } from './router'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

type Podium = { position: number; display: string; points: number; is_you: boolean }[]
type ListedGroup = { user_position: number | null; member_count: number; podium: Podium | null }

/**
 * Grupo `g` de uma competição encerrada, com quatro membros na ordem de entrada
 * ana, bia, caio, dudu. Só o jogo `m1` foi pontuado e ninguém tem linha no
 * `leaderboard`: cada teste grava as linhas do seu cenário.
 */
function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id,user_name) VALUES
      ('ana','ana@test.com','google','ana','Ana'), ('bia','bia@test.com','google','bia','Bia'),
      ('caio','caio@test.com','google','caio','Caio'), ('dudu','dudu@test.com','google','dudu','Dudu');
    INSERT INTO competitions (id,name,slug,status) VALUES ('c','C','test-c','finished');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code)
      VALUES ('g','Grupo','c','ana','ABCD-EFGH');
    INSERT INTO group_members (id,group_id,user_id,role,joined_at) VALUES
      ('gm1','g','ana','owner','2026-01-01 10:00:00'), ('gm2','g','bia','member','2026-01-02 10:00:00'),
      ('gm3','g','caio','member','2026-01-03 10:00:00'), ('gm4','g','dudu','member','2026-01-04 10:00:00');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,home_score,away_score,scored_at)
      VALUES ('m1','c','m1','test','h','v','2026-02-01T00:00:00Z','finished','1',1,0,'2026-02-01T03:00:00Z');
  `)
  const app = new Hono<AppContext>()
  app.route('/groups', groupsRouter)
  async function request(user: string, path: string, method = 'GET') {
    const token = await signJwt({ sub: user, email: `${user}@test.com` }, 'secret', 3600)
    const response = await app.fetch(
      new Request(`https://test${path}`, {
        method,
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ invite_code: 'ABCD-EFGH' }) } : {}),
      }),
      { DB: db, JWT_SECRET: 'secret' } as AppContext['Bindings'],
    )
    return { status: response.status, body: (await response.json()) as Record<string, unknown> }
  }
  const leaderboard = (rows: string) =>
    sqlite.exec(`INSERT INTO leaderboard (group_id,user_id,total_points,exact_hits) VALUES ${rows}`)
  const detailPosition = async (user: string) =>
    ((await request(user, '/groups/g')).body.group as { user_position: number | null })
      .user_position
  const listed = async (user: string) =>
    ((await request(user, '/groups')).body.groups as ListedGroup[])[0]
  const ranking = async (user: string) =>
    ((await request(user, '/groups/g/members')).body.members as { user_id: string }[]).map(
      (m) => m.user_id,
    )
  const rows = () =>
    sqlite.prepare("SELECT user_id, total_points FROM leaderboard WHERE group_id = 'g'").all()
  return { sqlite, db, request, leaderboard, detailPosition, listed, ranking, rows }
}

describe('posição, pódio e ranking na mesma ordem', () => {
  it('membro sem linha no leaderboard fica sem posição e fora do pódio', async () => {
    const { leaderboard, detailPosition, listed, ranking } = setup()
    leaderboard("('g','ana',10,1)")

    expect(await detailPosition('caio')).toBeNull()
    const group = await listed('caio')
    expect(group.user_position).toBeNull()
    expect(group.podium).toEqual([{ position: 1, display: 'Ana', points: 10, is_you: false }])
    // No ranking ele segue listado, depois de quem pontuou.
    expect(await ranking('caio')).toEqual(['ana', 'bia', 'caio', 'dudu'])
  })

  it('grupo em que ninguém pontuou não tem primeiro lugar', async () => {
    const { detailPosition, listed } = setup()

    expect(await detailPosition('ana')).toBeNull()
    expect(await listed('ana')).toMatchObject({ user_position: null, podium: null })
  })

  it('empate em pontos segue o desempate do ranking na posição e no pódio', async () => {
    const { leaderboard, detailPosition, listed, ranking } = setup()
    leaderboard("('g','ana',10,1), ('g','bia',10,2), ('g','caio',4,0)")

    expect(await ranking('ana')).toEqual(['bia', 'ana', 'caio', 'dudu'])
    expect(await detailPosition('bia')).toBe(1)
    expect(await detailPosition('ana')).toBe(2)
    expect(await detailPosition('caio')).toBe(3)
    const group = await listed('ana')
    expect(group.user_position).toBe(2)
    expect(group.podium?.map((e) => [e.position, e.display, e.is_you])).toEqual([
      [1, 'Bia', false],
      [2, 'Ana', true],
      [3, 'Caio', false],
    ])
  })

  it('empate total: quem pontuou vem antes, depois vale a entrada mais antiga', async () => {
    const { leaderboard, detailPosition, ranking } = setup()
    // bia e dudu empatam em pontos e exatos. caio tem linha zerada e ana, que
    // entrou antes de todos, não tem linha.
    leaderboard("('g','dudu',7,1), ('g','bia',7,1), ('g','caio',0,0)")

    expect(await ranking('ana')).toEqual(['bia', 'dudu', 'caio', 'ana'])
    expect(await detailPosition('bia')).toBe(1)
    expect(await detailPosition('dudu')).toBe(2)
    expect(await detailPosition('caio')).toBe(3)
    expect(await detailPosition('ana')).toBeNull()
  })
})

describe('quem saiu ou foi banido fica fora do ranking', () => {
  it('remoção apaga a linha do leaderboard e libera a posição dos outros', async () => {
    const { leaderboard, request, detailPosition, listed, rows } = setup()
    leaderboard("('g','dudu',99,9), ('g','bia',10,1)")
    expect(await detailPosition('bia')).toBe(2)

    expect((await request('ana', '/groups/g/members/dudu', 'DELETE')).status).toBe(200)

    expect(rows()).toEqual([{ user_id: 'bia', total_points: 10 }])
    expect(await detailPosition('bia')).toBe(1)
    expect(await listed('bia')).toMatchObject({ user_position: 1, member_count: 3 })
  })

  it('recálculo da pontuação não recria a linha de quem saiu', async () => {
    const { sqlite, db, request, rows } = setup()
    sqlite.exec(`
      INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,home_score,away_score)
        VALUES ('m2','c','m2','test','h','v','2026-02-08T00:00:00Z','finished','2',2,0);
      INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
        VALUES ('p1','bia','g','m2',2,0), ('p2','dudu','g','m2',2,0), ('p3','caio','g','m2',2,0);
    `)
    // dudu sai sozinho e caio é removido pelo dono. Os palpites ficam.
    await request('dudu', '/groups/g/members/dudu', 'DELETE')
    await request('ana', '/groups/g/members/caio', 'DELETE')

    await scoreUnprocessedMatches('c', db)
    // Segunda passada, como no retry do poller.
    sqlite.exec("UPDATE matches SET scored_at = NULL WHERE id = 'm2'")
    await scoreUnprocessedMatches('c', db)

    expect(rows().map((r) => (r as { user_id: string }).user_id)).toEqual(['bia'])
  })

  it('quem saiu e voltou recupera os pontos dos palpites', async () => {
    const { sqlite, db, request, rows, detailPosition } = setup()
    sqlite.exec(`
      INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,home_score,away_score)
        VALUES ('m2','c','m2','test','h','v','2026-02-08T00:00:00Z','finished','2',2,0);
      INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
        VALUES ('p1','bia','g','m2',2,0), ('p2','dudu','g','m2',2,0);
    `)
    await scoreUnprocessedMatches('c', db)
    const before = rows()
    expect(before).toHaveLength(2)

    await request('dudu', '/groups/g/members/dudu', 'DELETE')
    expect(rows()).toHaveLength(1)
    expect((await request('dudu', '/groups/join', 'POST')).status).toBe(200)

    expect(rows()).toEqual(before)
    // Mesmos pontos e exatos de bia; dudu voltou com data de entrada nova.
    expect(await detailPosition('dudu')).toBe(2)
  })

  it('banido com linha residual não aparece no ranking, no pódio nem na contagem', async () => {
    const { sqlite, db, leaderboard, request, detailPosition, listed, ranking, rows } = setup()
    leaderboard("('g','dudu',99,9), ('g','bia',10,1)")
    sqlite.exec(`
      INSERT INTO group_bans (group_id,user_id) VALUES ('g','dudu');
      INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score,points_awarded)
        VALUES ('p1','bia','g','m1',1,0,10), ('p2','dudu','g','m1',1,0,99);
    `)

    expect(await ranking('bia')).toEqual(['bia', 'ana', 'caio'])
    expect(await detailPosition('bia')).toBe(1)
    const group = await listed('bia')
    expect(group).toMatchObject({ user_position: 1, member_count: 3 })
    expect(group.podium?.map((e) => e.display)).toEqual(['Bia'])
    const detail = (await request('bia', '/groups/g')).body.group as { member_count: number }
    expect(detail.member_count).toBe(3)
    const standings = (await request('bia', '/groups/g/round-standings')).body.standings as {
      user_id: string
    }[]
    expect(standings.map((s) => s.user_id)).toEqual(['bia', 'ana', 'caio'])
    // O banido não vê mais o grupo na própria lista.
    expect((await request('dudu', '/groups')).body.groups).toEqual([])

    sqlite.exec("UPDATE leaderboard SET total_points = 0 WHERE user_id = 'dudu'")
    sqlite.exec("UPDATE matches SET scored_at = NULL WHERE id = 'm1'")
    await scoreUnprocessedMatches('c', db)
    expect(rows()).toContainEqual({ user_id: 'dudu', total_points: 0 })
  })
})

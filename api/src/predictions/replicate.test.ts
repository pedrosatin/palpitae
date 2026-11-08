import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { AppContext } from '../types'
import { outcomeScore } from './replicate'
import { predictionsRouter } from './router'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

type ReplicateBody = {
  ok: boolean
  error?: string
  groups: { group_id: string; saved: number; replaced: number }[]
  skipped_groups: string[]
  locked_matches: string[]
  missing_matches: string[]
}

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const selects: string[] = []
  const hooks: { beforeBatch?: () => void } = {}
  const counted = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === 'prepare') {
        return (sql: string) => {
          if (/^\s*SELECT/i.test(sql)) selects.push(sql)
          return target.prepare(sql)
        }
      }
      if (prop === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          hooks.beforeBatch?.()
          return target.batch(statements)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('a','a@test.com','google','a'), ('b','b@test.com','google','b');
    INSERT INTO competitions (id,name,slug,status,penalty_phases) VALUES
      ('c','C','test-c','ongoing','["FINAL"]'),
      ('d','D','test-d','ongoing','[]'),
      ('old','Old','test-old','finished','[]');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round) VALUES
      ('m1','c','e1','test','h','v','2099-01-01T00:00:00Z','scheduled','1'),
      ('m2','c','e2','test','v','h','2099-01-02T00:00:00Z','scheduled','1'),
      ('past','c','e3','test','h','v','2020-01-01T00:00:00Z','finished','1'),
      ('md','d','e4','test','h','v','2099-01-01T00:00:00Z','scheduled','1');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,phase) VALUES
      ('final','c','e5','test','h','v','2099-02-01T00:00:00Z','scheduled','FINAL','FINAL');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,points_exact,points_winner) VALUES
      ('src','Origem','c','a','src',3,1),
      ('g2','Segundo','c','a','g2',3,1),
      ('g3','Vencedor','c','a','g3',0,1),
      ('gd','OutroCampeonato','d','a','gd',3,1),
      ('gb','NaoMembro','c','b','gb',3,1);
    INSERT INTO group_members (id,group_id,user_id) VALUES
      ('1','src','a'), ('2','g2','a'), ('3','g3','a'), ('4','gd','a'), ('5','gb','b');
    INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score) VALUES
      ('p1','a','src','m1',3,1), ('p2','a','src','m2',1,1), ('p3','a','src','past',2,0),
      ('pg2','a','g2','m1',0,0);
    INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score,predicted_penalty_winner)
      VALUES ('pf','a','src','final',1,1,'away');
  `)
  const app = new Hono<AppContext>()
  app.route('/predictions', predictionsRouter)
  async function replicate(body: unknown, user = 'a', raw?: string) {
    const token = await signJwt({ sub: user, email: `${user}@test.com` }, 'secret', 3600)
    const response = await app.fetch(
      new Request('https://test/predictions/replicate', {
        method: 'POST',
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        body: raw ?? JSON.stringify(body),
      }),
      { DB: counted, JWT_SECRET: 'secret' } as AppContext['Bindings'],
    )
    return { status: response.status, body: (await response.json()) as ReplicateBody }
  }
  const stored = (group: string, match: string) =>
    sqlite
      .prepare(
        `SELECT predicted_home_score AS h, predicted_away_score AS a, predicted_penalty_winner AS pen
         FROM predictions WHERE user_id = 'a' AND group_id = ? AND match_id = ?`,
      )
      .get(group, match) as { h: number; a: number; pen: string | null } | undefined
  return { replicate, stored, selects, sqlite, hooks }
}

describe('outcomeScore', () => {
  it('reduz o placar ao resultado dos botões Casa, Empate e Fora', () => {
    expect(outcomeScore(3, 1)).toEqual({ home: 1, away: 0 })
    expect(outcomeScore(2, 2)).toEqual({ home: 0, away: 0 })
    expect(outcomeScore(0, 4)).toEqual({ home: 0, away: 1 })
  })
})

describe('POST /predictions/replicate', () => {
  it('grava o placar da origem nos outros grupos e conta o palpite substituído', async () => {
    const { replicate, stored } = setup()
    const { status, body } = await replicate({
      source_group_id: 'src',
      target_group_ids: ['g2', 'g3'],
      match_ids: ['m1', 'm2'],
    })
    expect(status).toBe(200)
    expect(body.groups).toEqual([
      { group_id: 'g2', saved: 2, replaced: 1 },
      { group_id: 'g3', saved: 2, replaced: 0 },
    ])
    expect(stored('g2', 'm1')).toMatchObject({ h: 3, a: 1 })
    expect(stored('g2', 'm2')).toMatchObject({ h: 1, a: 1 })
  })

  it('grava o resultado equivalente no grupo só vencedor', async () => {
    const { replicate, stored } = setup()
    await replicate({ source_group_id: 'src', target_group_ids: ['g3'], match_ids: ['m1', 'm2'] })
    expect(stored('g3', 'm1')).toMatchObject({ h: 1, a: 0 })
    expect(stored('g3', 'm2')).toMatchObject({ h: 0, a: 0 })
  })

  it('ignora o jogo travado e informa', async () => {
    const { replicate, stored } = setup()
    const { body } = await replicate({
      source_group_id: 'src',
      target_group_ids: ['g2'],
      match_ids: ['m1', 'past'],
    })
    expect(body.locked_matches).toEqual(['past'])
    expect(body.groups).toEqual([{ group_id: 'g2', saved: 1, replaced: 1 }])
    expect(stored('g2', 'past')).toBeUndefined()
  })

  it('não altera o palpite travado que o destino já tinha', async () => {
    const { replicate, stored, sqlite } = setup()
    sqlite.exec(
      `INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
       VALUES ('old','a','g2','past',5,5)`,
    )
    await replicate({ source_group_id: 'src', target_group_ids: ['g2'], match_ids: ['past'] })
    expect(stored('g2', 'past')).toMatchObject({ h: 5, a: 5 })
  })

  it('não conta como substituído o palpite que já era igual', async () => {
    const { replicate, sqlite } = setup()
    sqlite.exec(
      `INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
       VALUES ('same','a','g2','m2',1,1)`,
    )
    const { body } = await replicate({
      source_group_id: 'src',
      target_group_ids: ['g2'],
      match_ids: ['m2'],
    })
    expect(body.groups).toEqual([{ group_id: 'g2', saved: 1, replaced: 0 }])
  })

  it('recusa grupo de destino de que o usuário não é membro', async () => {
    const { replicate, stored } = setup()
    const { status } = await replicate({
      source_group_id: 'src',
      target_group_ids: ['g2', 'gb'],
      match_ids: ['m1'],
    })
    expect(status).toBe(403)
    expect(stored('g2', 'm1')).toMatchObject({ h: 0, a: 0 })
  })

  it('recusa origem de que o usuário não é membro', async () => {
    const { replicate } = setup()
    const { status } = await replicate({
      source_group_id: 'gb',
      target_group_ids: ['g2'],
      match_ids: ['m1'],
    })
    expect(status).toBe(403)
  })

  it('deixa de fora grupo de outro campeonato e de campeonato encerrado', async () => {
    const { replicate, stored, sqlite } = setup()
    sqlite.exec(`
      INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code) VALUES ('gold','Antigo','old','a','gold');
      INSERT INTO group_members (id,group_id,user_id) VALUES ('6','gold','a');
    `)
    const { body } = await replicate({
      source_group_id: 'src',
      target_group_ids: ['gd', 'gold', 'g2'],
      match_ids: ['m1'],
    })
    expect(body.skipped_groups).toEqual(['gd', 'gold'])
    expect(body.groups.map((g) => g.group_id)).toEqual(['g2'])
    expect(stored('gd', 'm1')).toBeUndefined()
    expect(stored('gold', 'm1')).toBeUndefined()
  })

  it('trata grupo apagado como grupo de que o usuário não é membro', async () => {
    const { replicate, stored, sqlite } = setup()
    sqlite.exec(`UPDATE groups SET deleted_at = '2026-01-01T00:00:00Z' WHERE id = 'g3'`)
    const { status } = await replicate({
      source_group_id: 'src',
      target_group_ids: ['g3'],
      match_ids: ['m1'],
    })
    expect(status).toBe(403)
    expect(stored('g3', 'm1')).toBeUndefined()
  })

  it('trata grupo em que o usuário foi banido como grupo de que ele não é membro', async () => {
    const { replicate, stored, sqlite } = setup()
    sqlite.exec(`INSERT INTO group_bans (group_id,user_id) VALUES ('g3','a')`)
    const { status } = await replicate({
      source_group_id: 'src',
      target_group_ids: ['g3'],
      match_ids: ['m1'],
    })
    expect(status).toBe(403)
    expect(stored('g3', 'm1')).toBeUndefined()
  })

  it('informa o jogo que a origem ainda não palpitou', async () => {
    const { replicate } = setup()
    const { body } = await replicate({
      source_group_id: 'src',
      target_group_ids: ['g2'],
      match_ids: ['m1', 'inexistente'],
    })
    expect(body.missing_matches).toEqual(['inexistente'])
  })

  it('mantém o vencedor dos pênaltis do jogo único de empate, também no grupo só vencedor', async () => {
    const { replicate, stored } = setup()
    await replicate({
      source_group_id: 'src',
      target_group_ids: ['g2', 'g3'],
      match_ids: ['final'],
    })
    expect(stored('g2', 'final')).toEqual({ h: 1, a: 1, pen: 'away' })
    expect(stored('g3', 'final')).toEqual({ h: 0, a: 0, pen: 'away' })
  })

  it('decide o vencedor dos pênaltis da volta pela ida que cada grupo vai ter', async () => {
    const { replicate, stored, sqlite } = setup()
    sqlite.exec(`
      INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,phase,leg) VALUES
        ('ida','c','e6','test','h','v','2099-03-01T00:00:00Z','scheduled','SEMI_FINALS','SEMI_FINALS',1),
        ('volta','c','e7','test','v','h','2099-03-08T00:00:00Z','scheduled','SEMI_FINALS','SEMI_FINALS',2);
      INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score,predicted_penalty_winner) VALUES
        ('pi','a','src','ida',2,1,NULL), ('pv','a','src','volta',1,0,'home');
    `)
    await replicate({
      source_group_id: 'src',
      target_group_ids: ['g2', 'g3'],
      match_ids: ['ida', 'volta'],
    })
    expect(stored('g2', 'volta')).toMatchObject({ h: 1, a: 0, pen: 'home' })
    expect(stored('g3', 'volta')).toMatchObject({ h: 1, a: 0, pen: 'home' })
    sqlite.exec(`
      UPDATE matches SET status = 'finished' WHERE id = 'ida';
      UPDATE predictions SET predicted_home_score = 0, predicted_away_score = 0 WHERE group_id = 'g2' AND match_id = 'ida';
    `)
    await replicate({ source_group_id: 'src', target_group_ids: ['g2'], match_ids: ['volta'] })
    expect(stored('g2', 'volta')).toMatchObject({ pen: null })
  })

  it('valida o corpo', async () => {
    const { replicate } = setup()
    const send = async (body: unknown) => (await replicate(body)).status
    expect(await send({ source_group_id: 'src', target_group_ids: [], match_ids: ['m1'] })).toBe(
      400,
    )
    expect(
      await send({ source_group_id: 'src', target_group_ids: ['src'], match_ids: ['m1'] }),
    ).toBe(400)
    expect(await send({ source_group_id: 'src', target_group_ids: ['g2'], match_ids: [] })).toBe(
      400,
    )
    expect(await send({ target_group_ids: ['g2'], match_ids: ['m1'] })).toBe(400)
  })

  it('trata corpo JSON null ou que não é objeto como 400', async () => {
    const { replicate } = setup()
    expect((await replicate(null, 'a', 'null')).status).toBe(400)
    expect((await replicate(null, 'a', '[1]')).status).toBe(400)
    expect((await replicate(null, 'a', '"texto"')).status).toBe(400)
  })

  it('não grava origem só vencedor em destino que pontua placar exato', async () => {
    const { replicate, stored, sqlite } = setup()
    sqlite.exec(
      `INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
       VALUES ('pw','a','g3','m1',1,0), ('pw2','a','g3','m2',0,0);
       INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
       VALUES ('x1','a','g2','m2',3,1)`,
    )
    const { body } = await replicate({
      source_group_id: 'g3',
      target_group_ids: ['g2', 'src'],
      match_ids: ['m1', 'm2'],
    })
    expect(body.skipped_groups).toEqual(['g2', 'src'])
    expect(body.groups).toEqual([])
    expect(stored('g2', 'm2')).toMatchObject({ h: 3, a: 1 })
    expect(stored('src', 'm1')).toMatchObject({ h: 3, a: 1 })
  })

  it('grava origem de placar exato em destino só vencedor', async () => {
    const { replicate, stored } = setup()
    const { body } = await replicate({
      source_group_id: 'src',
      target_group_ids: ['g3'],
      match_ids: ['m1'],
    })
    expect(body.skipped_groups).toEqual([])
    expect(stored('g3', 'm1')).toMatchObject({ h: 1, a: 0 })
  })

  it('não conta como substituído o destino só vencedor que já tinha o mesmo resultado', async () => {
    const { replicate, stored, sqlite } = setup()
    sqlite.exec(
      `INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
       VALUES ('ow','a','g3','m1',2,0)`,
    )
    const { body } = await replicate({
      source_group_id: 'src',
      target_group_ids: ['g3'],
      match_ids: ['m1'],
    })
    expect(body.groups).toEqual([{ group_id: 'g3', saved: 1, replaced: 0 }])
    expect(stored('g3', 'm1')).toMatchObject({ h: 2, a: 0 })
  })

  it('usa o status de campeonato derivado dos jogos, não a coluna crua', async () => {
    const { replicate, stored, sqlite } = setup()
    sqlite.exec(`
      INSERT INTO competitions (id,name,slug,status,type) VALUES ('liga','Liga','liga','upcoming','league');
      INSERT INTO teams (id,name,slug) VALUES ('t1','T1','t1'), ('t2','T2','t2');
      INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
        VALUES ('lm','liga','e20','test','t1','t2','2020-01-01T00:00:00Z','finished','1');
      INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code) VALUES ('l1','L1','liga','a','l1'), ('l2','L2','liga','a','l2');
      INSERT INTO group_members (id,group_id,user_id) VALUES ('7','l1','a'), ('8','l2','a');
    `)
    const { body } = await replicate({
      source_group_id: 'l1',
      target_group_ids: ['l2'],
      match_ids: ['lm'],
    })
    expect(body.skipped_groups).toEqual(['l2'])
    expect(stored('l2', 'lm')).toBeUndefined()
  })

  it('não grava o jogo que travou entre a leitura e a escrita', async () => {
    const { replicate, stored, sqlite, hooks } = setup()
    hooks.beforeBatch = () => sqlite.exec(`UPDATE matches SET status = 'live' WHERE id = 'm1'`)
    await replicate({
      source_group_id: 'src',
      target_group_ids: ['g2'],
      match_ids: ['m1', 'm2'],
    })
    expect(stored('g2', 'm1')).toMatchObject({ h: 0, a: 0 })
    expect(stored('g2', 'm2')).toMatchObject({ h: 1, a: 1 })
  })

  describe('pênaltis na volta', () => {
    function twoLegs(sqlite: ReturnType<typeof setup>['sqlite'], leg1Status = 'scheduled') {
      sqlite.exec(`
        INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,phase,leg) VALUES
          ('ida','c','e6','test','h','v','2099-03-01T00:00:00Z','${leg1Status}','SEMI_FINALS','SEMI_FINALS',1),
          ('volta','c','e7','test','v','h','2099-03-08T00:00:00Z','scheduled','SEMI_FINALS','SEMI_FINALS',2);
      `)
    }

    it('mantém o pick do destino quando a origem não empata o agregado', async () => {
      const { replicate, stored, sqlite } = setup()
      twoLegs(sqlite, 'finished')
      sqlite.exec(`
        INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score,predicted_penalty_winner) VALUES
          ('si','a','src','ida',3,1,NULL), ('sv','a','src','volta',1,0,NULL),
          ('di','a','g2','ida',2,1,NULL), ('dv','a','g2','volta',0,0,'home');
      `)
      await replicate({ source_group_id: 'src', target_group_ids: ['g2'], match_ids: ['volta'] })
      expect(stored('g2', 'volta')).toEqual({ h: 1, a: 0, pen: 'home' })
    })

    it('deriva o pick do classificado da origem quando o destino só vencedor empata', async () => {
      const { replicate, stored, sqlite } = setup()
      twoLegs(sqlite)
      sqlite.exec(`
        INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score,predicted_penalty_winner) VALUES
          ('si','a','src','ida',3,0,NULL), ('sv','a','src','volta',2,1,NULL);
      `)
      await replicate({
        source_group_id: 'src',
        target_group_ids: ['g3'],
        match_ids: ['ida', 'volta'],
      })
      expect(stored('g3', 'ida')).toMatchObject({ h: 1, a: 0 })
      expect(stored('g3', 'volta')).toEqual({ h: 1, a: 0, pen: 'away' })
    })
  })

  it('faz o mesmo número de consultas com um ou com vários grupos', async () => {
    const one = setup()
    await one.replicate({
      source_group_id: 'src',
      target_group_ids: ['g2'],
      match_ids: ['m1', 'm2'],
    })
    const many = setup()
    await many.replicate({
      source_group_id: 'src',
      target_group_ids: ['g2', 'g3'],
      match_ids: ['m1', 'm2'],
    })
    expect(many.selects.length).toBe(one.selects.length)
  })
})

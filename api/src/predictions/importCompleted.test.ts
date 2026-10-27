import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { AppContext } from '../types'
import { predictionsRouter } from './router'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('a','a@test.com','google','a'), ('b','b@test.com','google','b');
    INSERT INTO competitions (id,name,slug,status) VALUES ('c','C','test-c','ongoing');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
      VALUES ('m','c','test-m','test','h','v','2099-01-01T00:00:00Z','scheduled','1');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code) VALUES
      ('source','Origem','c','a','source'), ('target','Destino','c','a','target'), ('other','Outro','c','a','other');
    INSERT INTO group_members (id,group_id,user_id) VALUES
      ('as','source','a'), ('at','target','a'), ('ao','other','a'), ('bt','target','b');
    INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
      VALUES ('p','a','source','m',2,1);
  `)
  const app = new Hono<AppContext>()
  app.route('/predictions', predictionsRouter)
  async function request(user = 'a', target = 'target', post = false, onlyMissing = false) {
    const token = await signJwt({ sub: user, email: `${user}@test.com` }, 'secret', 3600)
    const response = await app.fetch(
      new Request(`https://test/predictions${post ? '/import' : `?group_id=${target}`}`, {
        method: post ? 'POST' : 'GET',
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        ...(post
          ? {
              body: JSON.stringify({
                source_group_id: 'source',
                target_group_id: target,
                ...(onlyMissing ? { only_missing: true } : {}),
              }),
            }
          : {}),
      }),
      { DB: db, JWT_SECRET: 'secret' } as AppContext['Bindings'],
    )
    return response as Omit<Response, 'json'> & {
      json: () => Promise<{
        import_completed: boolean
        import_sources?: Record<string, string[]>
        imported: number
        predictions: Array<{ predicted_home_score: number }>
      }>
    }
  }
  return { sqlite, request }
}

describe('Conclusão da importação por membro', () => {
  it('persiste somente para o membro e destino corretos e permite importar novamente', async () => {
    const { sqlite, request } = setup()
    expect((await (await request()).json()).import_completed).toBe(false)
    expect((await (await request('a', 'target', true)).json()).imported).toBe(1)
    expect((await (await request()).json()).import_completed).toBe(true)
    expect((await (await request('b')).json()).import_completed).toBe(false)
    expect((await (await request('a', 'other')).json()).import_completed).toBe(false)
    sqlite.exec("UPDATE predictions SET predicted_home_score = 3 WHERE group_id = 'source'")
    expect((await (await request('a', 'target', true)).json()).imported).toBe(1)
    expect((await (await request()).json()).predictions[0].predicted_home_score).toBe(3)
  })

  it('lista jogos abertos palpitados em outros grupos ativos do mesmo campeonato', async () => {
    const { sqlite, request } = setup()
    sqlite.exec(`
      INSERT INTO competitions (id,name,slug,status) VALUES ('c2','C2','test-c2','ongoing');
      INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
        VALUES ('m2','c2','test-m2','test','h','v','2099-01-01T00:00:00Z','scheduled','1'),
               ('done','c','test-done','test','h','v','2000-01-01T00:00:00Z','finished','1');
      INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code)
        VALUES ('alien','Alheio','c2','a','alien');
      INSERT INTO group_members (id,group_id,user_id) VALUES ('aa','alien','a');
      INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
        VALUES ('p2','a','alien','m2',1,0), ('p3','a','other','done',1,0), ('p4','a','target','m',0,0);
    `)
    const sources = async () => (await (await request()).json()).import_sources
    expect(await sources()).toEqual({ source: ['m'] })
    sqlite.exec("INSERT INTO group_bans (group_id,user_id) VALUES ('source','a')")
    expect(await sources()).toEqual({})
    sqlite.exec(
      "DELETE FROM group_bans; UPDATE groups SET deleted_at = '2026-01-01' WHERE id = 'source'",
    )
    expect(await sources()).toEqual({})
  })

  it('only_missing preenche só os jogos sem palpite e preserva os existentes', async () => {
    const { sqlite, request } = setup()
    sqlite.exec(`
      INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
        VALUES ('m2','c','test-m2','test','h','v','2099-01-01T00:00:00Z','scheduled','2'),
               ('done','c','test-done','test','h','v','2000-01-01T00:00:00Z','finished','1');
      INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
        VALUES ('p2','a','source','m2',4,4), ('p3','a','source','done',1,1), ('mine','a','target','m',0,0);
    `)
    const res = await (await request('a', 'target', true, true)).json()
    expect(res).toMatchObject({ imported: 1, locked_skipped: 1 })
    expect(
      sqlite
        .prepare(
          "SELECT match_id, predicted_home_score AS h FROM predictions WHERE group_id = 'target' ORDER BY match_id",
        )
        .all(),
    ).toEqual([
      { match_id: 'm', h: 0 },
      { match_id: 'm2', h: 4 },
    ])
  })

  it('não marca importação vazia ou com todos os jogos bloqueados', async () => {
    const { sqlite, request } = setup()
    sqlite.exec("UPDATE matches SET status = 'live'")
    expect((await (await request('a', 'target', true)).json()).imported).toBe(0)
    expect((await (await request()).json()).import_completed).toBe(false)
    sqlite.exec('DELETE FROM predictions')
    expect((await (await request('a', 'target', true)).json()).imported).toBe(0)
    expect((await (await request()).json()).import_completed).toBe(false)
  })

  it('não marca nem expõe metadados sem autorização', async () => {
    const { sqlite, request } = setup()
    expect((await request('b', 'target', true)).status).toBe(403)
    expect((await request('b', 'source')).status).toBe(403)
    expect(
      sqlite.prepare('SELECT SUM(predictions_import_completed) AS n FROM group_members').get()?.n,
    ).toBe(0)
  })

  it('reverte palpites e marcador se o batch falhar', async () => {
    const { sqlite, request } = setup()
    sqlite.exec(`CREATE TRIGGER fail_marker BEFORE UPDATE OF predictions_import_completed ON group_members
      BEGIN SELECT RAISE(ABORT, 'falha simulada'); END;`)
    expect((await request('a', 'target', true)).status).toBe(500)
    expect((await (await request()).json()).import_completed).toBe(false)
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM predictions WHERE group_id = 'target'").get()?.n,
    ).toBe(0)
  })

  it.each([
    { failMarker: false, scenario: 'persiste os 380 palpites e o marcador no destino' },
    {
      failMarker: true,
      scenario: 'reverte inserções e sobrescrita de 380 palpites se o marcador falhar',
    },
  ])('$scenario', async ({ failMarker }) => {
    const { sqlite, request } = setup()
    sqlite.exec(`
        WITH RECURSIVE season(n) AS (
          SELECT 1 UNION ALL SELECT n + 1 FROM season WHERE n < 379
        )
        INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round)
          SELECT 'm-' || n,'c','test-' || n,'test','h','v','2099-01-01T00:00:00Z','scheduled','1'
          FROM season;
        INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
          SELECT 'p-' || id,'a','source',id,3,2 FROM matches WHERE id != 'm';
        INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
          VALUES ('existing','a','target','m',9,8);
      `)
    const readPicks = (groupId: string) =>
      sqlite
        .prepare(`
        SELECT match_id,predicted_home_score,predicted_away_score FROM predictions
        WHERE group_id = ? AND user_id = 'a' ORDER BY match_id
      `)
        .all(groupId)
    const source = readPicks('source')
    const previousTarget = readPicks('target')
    expect(source).toHaveLength(380)
    if (failMarker) {
      sqlite.exec(`CREATE TRIGGER fail_season_marker BEFORE UPDATE OF predictions_import_completed ON group_members
          BEGIN SELECT RAISE(ABORT, 'falha simulada'); END;`)
    }

    const response = await request('a', 'target', true)
    expect(response.status).toBe(failMarker ? 500 : 200)
    if (!failMarker) expect((await response.json()).imported).toBe(380)
    expect(readPicks('target')).toEqual(failMarker ? previousTarget : source)
    expect(readPicks('source')).toEqual(source)
    expect((await (await request()).json()).import_completed).toBe(!failMarker)
  })

  it.each(['banido', 'removido', 'grupo excluído'])(
    'recusa destino %s sem alterar palpites ou marcador',
    async (state) => {
      const { sqlite, request } = setup()
      if (state === 'banido')
        sqlite.exec("INSERT INTO group_bans (group_id,user_id) VALUES ('target','a')")
      if (state === 'removido')
        sqlite.exec("DELETE FROM group_members WHERE group_id = 'target' AND user_id = 'a'")
      if (state === 'grupo excluído')
        sqlite.exec("UPDATE groups SET deleted_at = '2026-01-01' WHERE id = 'target'")
      expect((await request('a', 'target', true)).status).toBe(403)
      expect(
        sqlite.prepare("SELECT COUNT(*) AS n FROM predictions WHERE group_id = 'target'").get()?.n,
      ).toBe(0)
      expect(
        sqlite.prepare('SELECT SUM(predictions_import_completed) AS n FROM group_members').get()?.n,
      ).toBe(0)
    },
  )
})

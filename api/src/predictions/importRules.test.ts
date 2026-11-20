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

type ImportBody = { ok?: boolean; error?: string; imported?: number; locked_skipped?: number }

/**
 * Smoke HTTP do adapter de importação. Os caminhos de domínio (only_missing,
 * trava entre plano e escrita, marcador, atomicidade) ficam em
 * `importPredictions.test.ts`.
 */
function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES ('a','a@test.com','google','a');
    INSERT INTO competitions (id,name,slug,status,penalty_phases) VALUES
      ('c','C','test-c','ongoing','["FINAL"]');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,home_score,away_score) VALUES
      ('m1','c','e1','test','h','v','2099-01-01T00:00:00Z','scheduled','1',NULL,NULL),
      ('m2','c','e2','test','v','h','2099-01-02T00:00:00Z','scheduled','1',NULL,NULL);
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,points_exact,points_winner) VALUES
      ('exato','Exato','c','a','exato',3,1),
      ('exato2','Exato 2','c','a','exato2',3,1),
      ('vencedor','Vencedor','c','a','vencedor',0,1);
    INSERT INTO group_members (id,group_id,user_id) VALUES
      ('1','exato','a'), ('2','exato2','a'), ('3','vencedor','a');
  `)
  const app = new Hono<AppContext>()
  app.route('/predictions', predictionsRouter)
  async function importPost(body: Record<string, unknown>) {
    const token = await signJwt({ sub: 'a', email: 'a@test.com' }, 'secret', 3600)
    const response = await app.fetch(
      new Request('https://test/predictions/import', {
        method: 'POST',
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { DB: db, JWT_SECRET: 'secret' } as AppContext['Bindings'],
    )
    return { status: response.status, body: (await response.json()) as ImportBody }
  }
  async function importFrom(source: string, target: string, onlyMissing = false) {
    return importPost({
      source_group_id: source,
      target_group_id: target,
      ...(onlyMissing ? { only_missing: true } : {}),
    })
  }
  function predict(group: string, match: string, home: number, away: number) {
    sqlite
      .prepare(
        `INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score,predicted_penalty_winner,created_at,updated_at)
         VALUES (?, 'a', ?, ?, ?, ?, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(`${group}:${match}`, group, match, home, away)
  }
  const stored = (group: string, match: string) =>
    sqlite
      .prepare(
        `SELECT predicted_home_score AS h, predicted_away_score AS a
         FROM predictions WHERE user_id = 'a' AND group_id = ? AND match_id = ?`,
      )
      .get(group, match) as { h: number; a: number } | undefined
  return { importFrom, importPost, predict, stored }
}

describe('POST /predictions/import, smoke HTTP', () => {
  it('campos obrigatórios ausentes respondem 400', async () => {
    const { importPost } = setup()
    const { status, body } = await importPost({ source_group_id: 'exato' })
    expect(status).toBe(400)
    expect(body.error).toBe('source_group_id e target_group_id são obrigatórios')
  })

  it('grupos iguais respondem 400', async () => {
    const { importPost } = setup()
    const { status, body } = await importPost({
      source_group_id: 'exato',
      target_group_id: 'exato',
    })
    expect(status).toBe(400)
    expect(body.error).toBe('source_group_id e target_group_id devem ser diferentes')
  })

  it('origem só vencedor não converte um 2x1 do destino em 1x0', async () => {
    const { importFrom, predict, stored } = setup()
    predict('vencedor', 'm1', 1, 0)
    predict('vencedor', 'm2', 0, 1)
    predict('exato', 'm1', 2, 1)

    const { status, body } = await importFrom('vencedor', 'exato')

    expect(status).toBe(422)
    expect(body.error).toMatch(/só o vencedor/)
    expect(stored('exato', 'm1')).toMatchObject({ h: 2, a: 1 })
    expect(stored('exato', 'm2')).toBeUndefined()
  })

  it('destino só vencedor recebe o resultado, não o placar da origem', async () => {
    const { importFrom, predict, stored } = setup()
    predict('exato', 'm1', 3, 1)
    predict('exato', 'm2', 2, 2)

    const { status, body } = await importFrom('exato', 'vencedor')

    expect(status).toBe(200)
    expect(body).toMatchObject({ imported: 2, locked_skipped: 0 })
    expect(stored('vencedor', 'm1')).toMatchObject({ h: 1, a: 0 })
    expect(stored('vencedor', 'm2')).toMatchObject({ h: 0, a: 0 })
  })

  it('copia o palpite como está entre grupos do mesmo modo', async () => {
    const { importFrom, predict, stored } = setup()
    predict('exato', 'm1', 3, 1)
    predict('exato2', 'm1', 0, 0)

    const { status, body } = await importFrom('exato', 'exato2')

    expect(status).toBe(200)
    expect(body.imported).toBe(1)
    expect(stored('exato2', 'm1')).toMatchObject({ h: 3, a: 1 })
  })
})

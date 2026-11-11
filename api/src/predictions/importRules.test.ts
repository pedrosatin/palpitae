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

/** `exato` e `exato2` pontuam o placar; `vencedor` e `vencedor2` só o resultado. */
function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const hooks: { beforeBatch?: () => void } = {}
  const hooked = new Proxy(db, {
    get(target, prop, receiver) {
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
    INSERT INTO users (id,email,provider,provider_id) VALUES ('a','a@test.com','google','a');
    INSERT INTO competitions (id,name,slug,status,penalty_phases) VALUES
      ('c','C','test-c','ongoing','["FINAL"]');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round) VALUES
      ('m1','c','e1','test','h','v','2099-01-01T00:00:00Z','scheduled','1'),
      ('m2','c','e2','test','v','h','2099-01-02T00:00:00Z','scheduled','1'),
      ('past','c','e3','test','h','v','2020-01-01T00:00:00Z','finished','1');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,phase,leg) VALUES
      ('ida','c','e6','test','h','v','2099-03-01T00:00:00Z','scheduled','SEMI_FINALS','SEMI_FINALS',1),
      ('volta','c','e7','test','v','h','2099-03-08T00:00:00Z','scheduled','SEMI_FINALS','SEMI_FINALS',2);
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,points_exact,points_winner) VALUES
      ('exato','Exato','c','a','exato',3,1),
      ('exato2','Exato 2','c','a','exato2',3,1),
      ('vencedor','Vencedor','c','a','vencedor',0,1),
      ('vencedor2','Vencedor 2','c','a','vencedor2',0,1);
    INSERT INTO group_members (id,group_id,user_id) VALUES
      ('1','exato','a'), ('2','exato2','a'), ('3','vencedor','a'), ('4','vencedor2','a');
  `)
  const app = new Hono<AppContext>()
  app.route('/predictions', predictionsRouter)
  async function importFrom(source: string, target: string, onlyMissing = false) {
    const token = await signJwt({ sub: 'a', email: 'a@test.com' }, 'secret', 3600)
    const response = await app.fetch(
      new Request('https://test/predictions/import', {
        method: 'POST',
        headers: { Cookie: `session=${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_group_id: source,
          target_group_id: target,
          ...(onlyMissing ? { only_missing: true } : {}),
        }),
      }),
      { DB: hooked, JWT_SECRET: 'secret' } as AppContext['Bindings'],
    )
    return { status: response.status, body: (await response.json()) as ImportBody }
  }
  /** Grava um palpite direto no banco, com `updated_at` antigo para denunciar regravação. */
  function predict(
    group: string,
    match: string,
    home: number,
    away: number,
    pen: 'home' | 'away' | null = null,
  ) {
    sqlite
      .prepare(
        `INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score,predicted_penalty_winner,created_at,updated_at)
         VALUES (?, 'a', ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run(`${group}:${match}`, group, match, home, away, pen)
  }
  const stored = (group: string, match: string) =>
    sqlite
      .prepare(
        `SELECT predicted_home_score AS h, predicted_away_score AS a, predicted_penalty_winner AS pen, updated_at
         FROM predictions WHERE user_id = 'a' AND group_id = ? AND match_id = ?`,
      )
      .get(group, match) as
      | { h: number; a: number; pen: string | null; updated_at: string }
      | undefined
  const marker = (group: string) =>
    sqlite
      .prepare(
        `SELECT predictions_import_completed AS n FROM group_members WHERE group_id = ? AND user_id = 'a'`,
      )
      .get(group)?.n
  return { importFrom, predict, stored, marker, sqlite, hooks }
}

describe('POST /predictions/import, modo do grupo', () => {
  it('origem só vencedor não converte um 2x1 do destino em 1x0', async () => {
    const { importFrom, predict, stored, marker } = setup()
    predict('vencedor', 'm1', 1, 0)
    predict('vencedor', 'm2', 0, 1)
    predict('exato', 'm1', 2, 1)

    const { status, body } = await importFrom('vencedor', 'exato')

    expect(status).toBe(422)
    expect(body.error).toMatch(/só o vencedor/)
    expect(stored('exato', 'm1')).toMatchObject({ h: 2, a: 1 })
    // O 0x1 do botão "Fora" também não entra como placar no grupo de placar exato.
    expect(stored('exato', 'm2')).toBeUndefined()
    expect(marker('exato')).toBe(0)
  })

  it('origem só vencedor também não preenche o que falta no destino de placar exato', async () => {
    const { importFrom, predict, stored } = setup()
    predict('vencedor', 'm1', 1, 0)

    expect((await importFrom('vencedor', 'exato', true)).status).toBe(422)
    expect(stored('exato', 'm1')).toBeUndefined()
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

  it.each([
    { source: 'exato', target: 'exato2', home: 3, away: 1 },
    { source: 'vencedor', target: 'vencedor2', home: 0, away: 1 },
  ])('copia o palpite como está entre grupos do mesmo modo ($source)', async (c) => {
    const { importFrom, predict, stored, marker } = setup()
    predict(c.source, 'm1', c.home, c.away)
    predict(c.target, 'm1', 0, 0)

    const { status, body } = await importFrom(c.source, c.target)

    expect(status).toBe(200)
    expect(body.imported).toBe(1)
    expect(stored(c.target, 'm1')).toMatchObject({ h: c.home, a: c.away })
    expect(marker(c.target)).toBe(1)
  })
})

describe('POST /predictions/import, palpites bloqueados', () => {
  it('não copia jogo travado nem altera o palpite travado do destino', async () => {
    const { importFrom, predict, stored } = setup()
    predict('exato', 'm1', 3, 1)
    predict('exato', 'past', 2, 0)
    predict('exato2', 'past', 5, 5)

    const { body } = await importFrom('exato', 'exato2')

    expect(body).toMatchObject({ imported: 1, locked_skipped: 1 })
    expect(stored('exato2', 'm1')).toMatchObject({ h: 3, a: 1 })
    expect(stored('exato2', 'past')).toMatchObject({ h: 5, a: 5 })
  })

  it.each([false, true])(
    'não grava o jogo que travou entre a leitura e a escrita (only_missing: %s)',
    async (onlyMissing) => {
      const { importFrom, predict, stored, sqlite, hooks } = setup()
      predict('exato', 'm1', 3, 1)
      predict('exato', 'm2', 1, 1)
      if (!onlyMissing) predict('exato2', 'm1', 0, 0)
      hooks.beforeBatch = () => sqlite.exec(`UPDATE matches SET status = 'live' WHERE id = 'm1'`)

      await importFrom('exato', 'exato2', onlyMissing)

      if (onlyMissing) expect(stored('exato2', 'm1')).toBeUndefined()
      else expect(stored('exato2', 'm1')).toMatchObject({ h: 0, a: 0 })
      expect(stored('exato2', 'm2')).toMatchObject({ h: 1, a: 1 })
    },
  )
})

describe('POST /predictions/import, importação repetida', () => {
  it('repetir a importação não regrava o palpite que já é igual', async () => {
    const { importFrom, predict, stored } = setup()
    predict('exato', 'm1', 3, 1)
    predict('exato', 'm2', 1, 1)
    predict('exato2', 'm1', 3, 1)

    const first = await importFrom('exato', 'exato2')
    const afterFirst = stored('exato2', 'm2')
    const second = await importFrom('exato', 'exato2')

    expect(first.body.imported).toBe(2)
    expect(second.body.imported).toBe(2)
    expect(stored('exato2', 'm1')?.updated_at).toBe('2026-01-01T00:00:00.000Z')
    expect(stored('exato2', 'm2')).toEqual(afterFirst)
  })

  it('no destino só vencedor, repetir mantém o placar que já tinha o mesmo resultado', async () => {
    const { importFrom, predict, stored } = setup()
    predict('exato', 'm1', 3, 1)
    predict('vencedor', 'm1', 1, 0)

    const { body } = await importFrom('exato', 'vencedor')

    expect(body.imported).toBe(1)
    expect(stored('vencedor', 'm1')).toMatchObject({
      h: 1,
      a: 0,
      updated_at: '2026-01-01T00:00:00.000Z',
    })
  })
})

describe('POST /predictions/import, pênaltis na volta', () => {
  it('descarta o pick da origem quando a ida do destino não empata o agregado', async () => {
    const { importFrom, predict, stored } = setup()
    // Origem: 1x0 na ida e 1x0 na volta com o mando invertido, agregado 1x1, pick "home".
    predict('exato', 'ida', 1, 0)
    predict('exato', 'volta', 1, 0, 'home')
    // O destino já tem outra ida: com a mesma volta, o agregado fica 2x1 e não vai aos pênaltis.
    predict('exato2', 'ida', 2, 0)

    const { body } = await importFrom('exato', 'exato2', true)

    expect(body.imported).toBe(1)
    expect(stored('exato2', 'ida')).toMatchObject({ h: 2, a: 0 })
    expect(stored('exato2', 'volta')).toMatchObject({ h: 1, a: 0, pen: null })
  })

  it('deriva o pick do classificado da origem quando só o destino empata o agregado', async () => {
    const { importFrom, predict, stored } = setup()
    // Origem: 3x0 na ida e 2x1 na volta, agregado 4x2 para o mandante da ida, sem pick.
    predict('exato', 'ida', 3, 0)
    predict('exato', 'volta', 2, 1)

    await importFrom('exato', 'vencedor')

    // No só vencedor vira 1x0 e 1x0: agregado 1x1, e o classificado da origem é o visitante da volta.
    expect(stored('vencedor', 'ida')).toMatchObject({ h: 1, a: 0 })
    expect(stored('vencedor', 'volta')).toMatchObject({ h: 1, a: 0, pen: 'away' })
  })
})

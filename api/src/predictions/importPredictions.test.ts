import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  importPredictions,
  type ImportPredictionsDeps,
  type ImportPredictionsInput,
} from './importPredictions'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  vi.useRealTimers()
  for (const sqlite of handles.splice(0)) sqlite.close()
})

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
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('a','a@test.com','google','a'), ('b','b@test.com','google','b');
    INSERT INTO competitions (id,name,slug,status,penalty_phases) VALUES
      ('c','C','test-c','ongoing','["FINAL"]'),
      ('d','D','test-d','ongoing','[]');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,home_score,away_score) VALUES
      ('m1','c','e1','test','h','v','2099-01-01T00:00:00Z','scheduled','1',NULL,NULL),
      ('m2','c','e2','test','v','h','2099-01-02T00:00:00Z','scheduled','1',NULL,NULL),
      ('past','c','e3','test','h','v','2020-01-01T00:00:00Z','finished','1',1,0);
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,phase,leg) VALUES
      ('ida','c','e6','test','h','v','2099-03-01T00:00:00Z','scheduled','SEMI_FINALS','SEMI_FINALS',1),
      ('volta','c','e7','test','v','h','2099-03-08T00:00:00Z','scheduled','SEMI_FINALS','SEMI_FINALS',2);
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,points_exact,points_winner) VALUES
      ('exato','Exato','c','a','exato',3,1),
      ('exato2','Exato 2','c','a','exato2',3,1),
      ('vencedor','Vencedor','c','a','vencedor',0,1),
      ('vencedor2','Vencedor 2','c','a','vencedor2',0,1),
      ('outro','OutroCampeonato','d','a','outro',3,1),
      ('soB','SoB','c','b','soB',3,1);
    INSERT INTO group_members (id,group_id,user_id) VALUES
      ('1','exato','a'), ('2','exato2','a'), ('3','vencedor','a'), ('4','vencedor2','a'),
      ('5','outro','a'), ('6','soB','b');
  `)

  const deps: ImportPredictionsDeps = {
    isPilotGroupBlocked: async () => false,
    enforceWriteBudget: async () => null,
  }

  async function run(
    sourceGroupId: string,
    targetGroupId: string,
    options: {
      onlyMissing?: boolean
      userId?: string
      now?: string
      deps?: Partial<ImportPredictionsDeps>
    } = {},
  ) {
    const input: ImportPredictionsInput = {
      userId: options.userId ?? 'a',
      sourceGroupId,
      targetGroupId,
      onlyMissing: options.onlyMissing === true,
      now: options.now,
    }
    return importPredictions(hooked, input, { ...deps, ...options.deps })
  }

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

  const marker = (group: string, user = 'a') =>
    sqlite
      .prepare(
        `SELECT predictions_import_completed AS n FROM group_members WHERE group_id = ? AND user_id = ?`,
      )
      .get(group, user)?.n

  return { run, predict, stored, marker, sqlite, hooks, deps }
}

describe('importPredictions, sucesso e only_missing', () => {
  it('copia o placar entre grupos do mesmo modo e marca a importação', async () => {
    const { run, predict, stored, marker } = setup()
    predict('exato', 'm1', 3, 1)
    predict('exato2', 'm1', 0, 0)

    const result = await run('exato', 'exato2')

    expect(result).toMatchObject({ ok: true, imported: 1, locked_skipped: 0 })
    expect(stored('exato2', 'm1')).toMatchObject({ h: 3, a: 1 })
    expect(marker('exato2')).toBe(1)
  })

  it('destino só vencedor recebe o resultado, não o placar da origem', async () => {
    const { run, predict, stored } = setup()
    predict('exato', 'm1', 3, 1)
    predict('exato', 'm2', 2, 2)

    const result = await run('exato', 'vencedor')

    expect(result).toMatchObject({ ok: true, imported: 2, locked_skipped: 0 })
    expect(stored('vencedor', 'm1')).toMatchObject({ h: 1, a: 0 })
    expect(stored('vencedor', 'm2')).toMatchObject({ h: 0, a: 0 })
  })

  it('only_missing preenche só os jogos sem palpite e preserva os existentes', async () => {
    const { run, predict, stored, marker } = setup()
    predict('exato', 'm1', 3, 1)
    predict('exato', 'm2', 1, 1)
    predict('exato2', 'm1', 0, 0)

    const result = await run('exato', 'exato2', { onlyMissing: true })

    expect(result).toMatchObject({ ok: true, imported: 1, locked_skipped: 0 })
    expect(stored('exato2', 'm1')).toMatchObject({ h: 0, a: 0 })
    expect(stored('exato2', 'm2')).toMatchObject({ h: 1, a: 1 })
    expect(marker('exato2')).toBe(1)
  })
})

describe('importPredictions, origem incompatível e membership', () => {
  it('recusa origem só vencedor em destino de placar exato', async () => {
    const { run, predict, stored, marker } = setup()
    predict('vencedor', 'm1', 1, 0)
    predict('exato', 'm1', 2, 1)

    const result = await run('vencedor', 'exato')

    expect(result).toMatchObject({
      status: 422,
      error: expect.stringMatching(/só o vencedor/),
    })
    expect(stored('exato', 'm1')).toMatchObject({ h: 2, a: 1 })
    expect(marker('exato')).toBe(0)
  })

  it('recusa grupos de campeonatos diferentes', async () => {
    const { run, predict } = setup()
    predict('exato', 'm1', 1, 0)

    const result = await run('exato', 'outro')

    expect(result).toMatchObject({
      status: 422,
      error: 'Os grupos pertencem a campeonatos diferentes',
    })
  })

  it('recusa quem não é membro da origem', async () => {
    const { run } = setup()
    const result = await run('soB', 'exato', { userId: 'a' })
    expect(result).toMatchObject({ status: 403, error: 'Acesso negado ao grupo de origem' })
  })

  it('recusa quem não é membro do destino', async () => {
    const { run, predict } = setup()
    predict('exato', 'm1', 1, 0)
    const result = await run('exato', 'soB')
    expect(result).toMatchObject({ status: 403, error: 'Acesso negado ao grupo de destino' })
  })

  it('grupo piloto bloqueado responde como não encontrado', async () => {
    const { run, predict } = setup()
    predict('exato', 'm1', 1, 0)
    const result = await run('exato', 'exato2', {
      deps: { isPilotGroupBlocked: async (id) => id === 'exato2' },
    })
    expect(result).toMatchObject({ status: 404, error: 'Grupo não encontrado' })
  })
})

describe('importPredictions, trava entre plano e escrita', () => {
  it('não copia jogo já travado e preserva o palpite travado do destino', async () => {
    const { run, predict, stored } = setup()
    predict('exato', 'm1', 3, 1)
    predict('exato', 'past', 2, 0)
    predict('exato2', 'past', 5, 5)

    const result = await run('exato', 'exato2')

    expect(result).toMatchObject({ ok: true, imported: 1, locked_skipped: 1 })
    expect(stored('exato2', 'm1')).toMatchObject({ h: 3, a: 1 })
    expect(stored('exato2', 'past')).toMatchObject({ h: 5, a: 5 })
  })

  it.each([false, true])(
    'não grava o jogo que travou entre a leitura e a escrita (only_missing: %s)',
    async (onlyMissing) => {
      const { run, predict, stored, sqlite, hooks } = setup()
      predict('exato', 'm1', 3, 1)
      predict('exato', 'm2', 1, 1)
      if (!onlyMissing) predict('exato2', 'm1', 0, 0)
      hooks.beforeBatch = () => sqlite.exec(`UPDATE matches SET status = 'live' WHERE id = 'm1'`)

      await run('exato', 'exato2', { onlyMissing })

      if (onlyMissing) expect(stored('exato2', 'm1')).toBeUndefined()
      else expect(stored('exato2', 'm1')).toMatchObject({ h: 0, a: 0 })
      expect(stored('exato2', 'm2')).toMatchObject({ h: 1, a: 1 })
    },
  )

  it('responde zero e não marca quando o único jogo trava antes da escrita', async () => {
    const { run, predict, stored, marker, sqlite, hooks } = setup()
    predict('exato', 'm1', 3, 1)
    hooks.beforeBatch = () => sqlite.exec(`UPDATE matches SET status = 'live' WHERE id = 'm1'`)

    const result = await run('exato', 'exato2')

    expect(result).toMatchObject({ ok: true, imported: 0, locked_skipped: 1 })
    expect(stored('exato2', 'm1')).toBeUndefined()
    expect(marker('exato2')).toBe(0)
  })
})

describe('importPredictions, marcador e atomicidade', () => {
  it('marcador só sobe com imported > 0', async () => {
    const { run, marker, sqlite } = setup()
    sqlite.exec(`UPDATE matches SET status = 'live'`)
    const empty = await run('exato', 'exato2')
    expect(empty).toMatchObject({ ok: true, imported: 0 })
    expect(marker('exato2')).toBe(0)
  })

  it('o palpite igual conta como importado e marca a importação, mesmo sem escrita', async () => {
    const { run, predict, marker } = setup()
    predict('exato', 'm1', 3, 1)
    predict('exato2', 'm1', 3, 1)

    const result = await run('exato', 'exato2')

    expect(result).toMatchObject({ ok: true, imported: 1, locked_skipped: 0 })
    expect(marker('exato2')).toBe(1)
  })

  it('reverte palpites e marcador se o batch falhar', async () => {
    const { run, predict, marker, sqlite } = setup()
    predict('exato', 'm1', 3, 1)
    sqlite.exec(`CREATE TRIGGER fail_marker BEFORE UPDATE OF predictions_import_completed ON group_members
      BEGIN SELECT RAISE(ABORT, 'falha simulada'); END;`)

    await expect(run('exato', 'exato2')).rejects.toThrow(/falha simulada/)
    expect(marker('exato2')).toBe(0)
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM predictions WHERE group_id = 'exato2'").get()?.n,
    ).toBe(0)
  })

  it('propaga erro de orçamento sem gravar', async () => {
    const { run, predict, marker, stored } = setup()
    predict('exato', 'm1', 3, 1)

    const result = await run('exato', 'exato2', {
      deps: {
        enforceWriteBudget: async () => ({
          error: 'Este lote passa do seu limite diário de escrita.',
          status: 429,
        }),
      },
    })

    expect(result).toMatchObject({ status: 429 })
    expect(stored('exato2', 'm1')).toBeUndefined()
    expect(marker('exato2')).toBe(0)
  })

  it('emite telemetria só quando imported > 0', async () => {
    const { run, predict } = setup()
    predict('exato', 'm1', 3, 1)
    const logPredictionSaved = vi.fn()

    await run('exato', 'exato2', { deps: { logPredictionSaved } })
    expect(logPredictionSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        targetGroupId: 'exato2',
        userId: 'a',
        competitionId: 'c',
        imported: 1,
      }),
    )

    logPredictionSaved.mockClear()
    await run('exato', 'vencedor2', {
      deps: {
        logPredictionSaved,
        enforceWriteBudget: async () => ({ error: 'limite', status: 429 }),
      },
    })
    expect(logPredictionSaved).not.toHaveBeenCalled()
  })
})

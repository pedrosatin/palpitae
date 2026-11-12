/// <reference types="node" />
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { MATCH_UPSERT_SQL } from './sync'

/**
 * Formato de `matches` imposto pelos gatilhos da migration 0043: `start_time` em
 * `YYYY-MM-DDTHH:MM:SSZ`, jogo `finished` com placar e `round` preenchido.
 */
const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO competitions (id,name,slug,status,penalty_phases) VALUES ('c','C','c','ongoing','[]');
    INSERT INTO teams (id,name,slug) VALUES ('h','H','h'), ('v','V','v');
  `)
  const insert = (fields: Record<string, string | number | null>) => {
    const row: Record<string, string | number | null> = {
      id: 'm',
      competition_id: 'c',
      external_id: 'e',
      provider: 'football-data',
      home_team_id: 'h',
      away_team_id: 'v',
      start_time: '2026-11-09T20:00:00Z',
      status: 'scheduled',
      round: '1',
      ...fields,
    }
    const columns = Object.keys(row)
    sqlite
      .prepare(
        `INSERT INTO matches (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`,
      )
      .run(...Object.values(row))
  }
  const read = () =>
    sqlite
      .prepare('SELECT start_time, status, home_score, away_score, round, scored_at FROM matches')
      .get()
  return { sqlite, db, insert, read }
}

/** Grava pelo upsert do sync, com os campos de resultado dados. */
function upsert(
  db: D1Database,
  fields: { startTime?: string; status?: string; home?: number | null; away?: number | null },
  postponed = 0,
) {
  return db
    .prepare(MATCH_UPSERT_SQL)
    .bind(
      'novo-id',
      'c',
      'e',
      'football-data',
      'h',
      'v',
      fields.startTime ?? '2026-11-09T20:00:00Z',
      fields.status ?? 'scheduled',
      fields.home ?? null,
      fields.away ?? null,
      'REGULAR_SEASON',
      '1',
      null,
      null,
      null,
      null,
      null,
      postponed,
      null,
      null,
      '2026-11-09T22:00:00Z',
    )
    .run()
}

describe('migration 0043: formato de matches', () => {
  it('aceita a linha no formato dos provedores', () => {
    const { insert, read } = setup()
    insert({ status: 'finished', home_score: 2, away_score: 0 })
    expect(read()).toMatchObject({ start_time: '2026-11-09T20:00:00Z', status: 'finished' })
  })

  it.each([
    '2026-11-09 20:00:00',
    '2026-11-09T20:00:00.500Z',
    '2026-11-09T20:00:00.000Z',
    '2026-11-09T17:00:00-03:00',
    '2026-11-09T20:00Z',
    '2026-02-30T20:00:00Z',
    '',
  ])('recusa start_time %j', (startTime) => {
    const { insert } = setup()
    expect(() => insert({ start_time: startTime })).toThrow(/start_time fora do formato/)
  })

  it('recusa jogo finished sem placar, com placar nulo de um lado ou dos dois', () => {
    const { insert } = setup()
    expect(() => insert({ status: 'finished' })).toThrow(/finished sem placar/)
    expect(() => insert({ status: 'finished', home_score: 1 })).toThrow(/finished sem placar/)
    expect(() => insert({ status: 'finished', away_score: 0 })).toThrow(/finished sem placar/)
  })

  it('recusa round nulo', () => {
    const { insert } = setup()
    expect(() => insert({ round: null })).toThrow(/round nulo/)
  })

  it('recusa atualização que tira o formato do horário, tira o placar ou zera a rodada', () => {
    const { sqlite, insert, read } = setup()
    insert({})
    const update = (set: string) => () => sqlite.exec(`UPDATE matches SET ${set} WHERE id = 'm'`)

    expect(update("start_time = '2026-11-09 20:00:00'")).toThrow(/start_time fora do formato/)
    expect(update("status = 'finished'")).toThrow(/finished sem placar/)
    expect(update('round = NULL')).toThrow(/round nulo/)
    update("status = 'finished', home_score = 0, away_score = 0")()
    expect(update('home_score = NULL')).toThrow(/finished sem placar/)
    expect(read()).toMatchObject({
      start_time: '2026-11-09T20:00:00Z',
      status: 'finished',
      home_score: 0,
      away_score: 0,
      round: '1',
    })
  })

  it('o upsert do sync recusa jogo finished sem placar e horário fora do formato', async () => {
    const { db } = setup()
    await expect(upsert(db, { status: 'finished' })).rejects.toThrow(/finished sem placar/)
    await expect(upsert(db, { startTime: '2026-11-09T20:00:00.000Z' })).rejects.toThrow(
      /start_time fora do formato/,
    )
  })

  describe('linha antiga fora do formato', () => {
    /** Gravada antes da migration: o gatilho de inserção ainda não existia. */
    function legacy(fields: Record<string, string | number | null>) {
      const ctx = setup()
      ctx.sqlite.exec('DROP TRIGGER matches_format_insert')
      ctx.insert(fields)
      return ctx
    }

    it('segue aceitando a pontuação, o travamento e o upsert de adiado que preserva o horário', async () => {
      const { sqlite, db, read } = legacy({ start_time: '2026-11-09 20:00:00', round: null })

      sqlite.exec(
        "UPDATE matches SET scored_at = '2026-11-09T22:00:00Z', locked_at = '2026-11-09T20:00:00Z'",
      )
      // Adiado: o upsert mantém o start_time gravado e não toca na linha antiga.
      await upsert(db, { startTime: '2026-07-29T00:00:00Z' }, 1)

      expect(read()).toMatchObject({ start_time: '2026-11-09 20:00:00', round: '1' })
    })

    it('aceita a correção para o formato e o resultado final com placar', async () => {
      const { db, read } = legacy({ start_time: '2026-11-09 20:00:00' })
      await upsert(db, { status: 'finished', home: 1, away: 1 })
      expect(read()).toMatchObject({
        start_time: '2026-11-09T20:00:00Z',
        status: 'finished',
        home_score: 1,
        away_score: 1,
      })
    })

    it('mantém um finished sem placar antigo enquanto o placar não muda', () => {
      const { sqlite, read } = legacy({ status: 'finished' })
      sqlite.exec("UPDATE matches SET scored_at = '2026-11-09T22:00:00Z'")
      sqlite.exec("UPDATE matches SET status = 'finished', round = '2'")
      expect(read()).toMatchObject({ status: 'finished', home_score: null, round: '2' })
    })
  })
})

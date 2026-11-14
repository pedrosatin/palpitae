/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import { callsLeft, countD1Calls, type CallBudget } from './callBudget'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

function setup(limit = 50) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const budget: CallBudget = { limit, used: 0 }
  return { sqlite, raw: db, db: countD1Calls(db, budget), budget }
}

describe('countD1Calls', () => {
  it('conta uma chamada por first, all e run, e nenhuma por prepare e bind', async () => {
    const { db, budget } = setup()

    const statement = db.prepare('SELECT ? AS n').bind(7)
    expect(budget.used).toBe(0)

    expect(await statement.first()).toEqual({ n: 7 })
    expect((await statement.all()).results).toEqual([{ n: 7 }])
    await db.prepare(`INSERT INTO teams (id, name, slug) VALUES ('t1', 'Time', 'time')`).run()

    expect(budget.used).toBe(3)
  })

  it('conta o batch inteiro como uma chamada e grava todas as instruções', async () => {
    const { sqlite, db, budget } = setup()
    const insert = db.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)')

    await db.batch([
      insert.bind('t1', 'Um', 'um'),
      insert.bind('t2', 'Dois', 'dois'),
      insert.bind('t3', 'Três', 'tres'),
    ])

    expect(budget.used).toBe(1)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM teams').get()).toEqual({ n: 3 })
  })

  it('entrega ao batch do D1 as instruções originais, não as embrulhadas', async () => {
    const { raw, budget } = setup()
    const received: D1PreparedStatement[] = []
    const spied = {
      prepare: (sql: string) => raw.prepare(sql),
      batch: async (statements: D1PreparedStatement[]) => {
        received.push(...statements)
        return []
      },
    } as unknown as D1Database
    const db = countD1Calls(spied, budget)

    const counted = db.prepare('SELECT ? AS n').bind(1)
    await db.batch([counted])

    expect(received).toHaveLength(1)
    expect(received[0]).not.toBe(counted)
    // A original não passa pelo contador.
    await received[0].first()
    expect(budget.used).toBe(1)
  })

  it('só conta: a chamada além do limite ainda roda', async () => {
    const { db, budget } = setup(1)

    await db.prepare('SELECT 1 AS n').first()
    expect(await db.prepare('SELECT 2 AS n').first()).toEqual({ n: 2 })

    expect(budget.used).toBe(2)
    expect(callsLeft(budget)).toBe(0)
  })
})

describe('callsLeft', () => {
  it('devolve o que falta para o limite', () => {
    expect(callsLeft({ limit: 45, used: 12 })).toBe(33)
  })
})

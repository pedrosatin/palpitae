/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reportD1Rows } from '../testing/d1RowsReported'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  chargeDailyBudget,
  DAILY_BUCKET_ROWS_WRITTEN_PER_ROW,
  dailyBudgetExhausted,
  dailyD1Limits,
} from './limits'
import { meterD1Rows, type D1RowUsage } from './d1Usage'

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.restoreAllMocks()
})

// Cada consulta informa 3 linhas lidas, e cada escrita 2 linhas escritas.
function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const reported = reportD1Rows(db, (sql) => ({
    rows_read: 3,
    rows_written: /^\s*INSERT/i.test(sql) ? 2 : 0,
  }))
  const usage: D1RowUsage = { rowsRead: 0, rowsWritten: 0 }
  return { sqlite, db, usage, metered: meterD1Rows(reported, usage) }
}

describe('meterD1Rows', () => {
  it('soma o meta de run, all e de cada instrução do batch', async () => {
    const { sqlite, metered, usage } = setup()
    const insert = metered.prepare('INSERT INTO teams (id, name, slug) VALUES (?, ?, ?)')

    await insert.bind('t1', 'Um', 'um').run()
    await metered.batch([insert.bind('t2', 'Dois', 'dois'), insert.bind('t3', 'Três', 'tres')])
    expect((await metered.prepare('SELECT id FROM teams ORDER BY id').all()).results).toHaveLength(
      3,
    )

    expect(usage).toEqual({ rowsRead: 12, rowsWritten: 6 })
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM teams').get()).toEqual({ n: 3 })
  })

  it('mede o first pelo all e devolve o mesmo que o first do D1', async () => {
    const { metered, usage } = setup()
    const select = metered.prepare('SELECT ? AS n, ? AS m')

    expect(await select.bind(7, 8).first()).toEqual({ n: 7, m: 8 })
    expect(await select.bind(7, 8).first('m')).toBe(8)
    expect(await metered.prepare('SELECT 1 AS n WHERE 0').first()).toBeNull()
    await expect(select.bind(7, 8).first('x')).rejects.toThrow('D1_COLUMN_NOTFOUND')
    await expect(select.bind(7, 8).first('toString')).rejects.toThrow('D1_COLUMN_NOTFOUND')

    expect(usage.rowsRead).toBe(15)
  })
})

describe('balde diário do D1', () => {
  const keys = { read: 'read-key', written: 'written-key' }
  const limits = { read: 100, written: 20 }
  const day = 20_000 * 86_400

  it('soma as requisições do dia e recomeça no dia seguinte', async () => {
    const { db } = setup()

    await chargeDailyBudget(db, keys, { rowsRead: 60, rowsWritten: 1 }, day + 10)
    expect(await dailyBudgetExhausted(db, keys, limits, day + 20)).toBe(false)
    await chargeDailyBudget(db, keys, { rowsRead: 40, rowsWritten: 1 }, day + 30)
    expect(await dailyBudgetExhausted(db, keys, limits, day + 40)).toBe(true)

    expect(await dailyBudgetExhausted(db, keys, limits, day + 86_400)).toBe(false)
    await chargeDailyBudget(db, keys, { rowsRead: 5, rowsWritten: 0 }, day + 86_400)
    expect(await dailyBudgetExhausted(db, keys, limits, day + 86_401)).toBe(false)
  })

  const hits = (sqlite: DatabaseSync, key: string) =>
    sqlite.prepare('SELECT hits FROM request_limits WHERE bucket_key = ?').get(key)

  it('não grava nada quando a requisição não leu nem escreveu', async () => {
    const { sqlite, db } = setup()

    await chargeDailyBudget(db, keys, { rowsRead: 0, rowsWritten: 0 }, day)

    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM request_limits').get()).toEqual({ n: 0 })
  })

  it('só de leitura grava só a linha de leitura, sem custo de escrita', async () => {
    const { sqlite, db } = setup()

    await chargeDailyBudget(db, keys, { rowsRead: 7, rowsWritten: 0 }, day)

    expect(hits(sqlite, keys.read)).toEqual({ hits: 7 })
    expect(hits(sqlite, keys.written)).toBeUndefined()
  })

  it('cobra das linhas escritas o custo de cada linha do balde gravada', async () => {
    const { sqlite, db } = setup()

    await chargeDailyBudget(db, keys, { rowsRead: 0, rowsWritten: 1 }, day)
    expect(hits(sqlite, keys.read)).toBeUndefined()
    expect(hits(sqlite, keys.written)).toEqual({ hits: 1 + DAILY_BUCKET_ROWS_WRITTEN_PER_ROW })

    await chargeDailyBudget(db, keys, { rowsRead: 3, rowsWritten: 1 }, day + 1)
    expect(hits(sqlite, keys.read)).toEqual({ hits: 3 })
    expect(hits(sqlite, keys.written)).toEqual({
      hits: 2 + 3 * DAILY_BUCKET_ROWS_WRITTEN_PER_ROW,
    })
  })
})

describe('dailyD1Limits', () => {
  it('aceita inteiro positivo e volta ao padrão com valor fora do inteiro seguro', () => {
    expect(dailyD1Limits({ D1_DAILY_ROWS_READ_PER_USER: ' 1000 ' })).toEqual({
      read: 1000,
      written: 5_000,
    })

    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const value of ['0', '1e9', '9007199254740993', '9'.repeat(400)]) {
      expect(dailyD1Limits({ D1_DAILY_ROWS_WRITTEN_PER_USER: value }).written).toBe(5_000)
    }
    expect(error).toHaveBeenCalledTimes(4)
  })
})

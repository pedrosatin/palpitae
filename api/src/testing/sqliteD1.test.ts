import { describe, it, expect } from 'vitest'
import { createSqliteD1 } from './sqliteD1'

describe('createSqliteD1', () => {
  it('prepares and runs statements (first, all, run)', async () => {
    const { db, sqlite } = createSqliteD1()
    sqlite.exec('CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, name TEXT)')
    const runResult = await db.prepare('INSERT INTO test_table (name) VALUES (?)').bind('test1').run()
    expect(runResult.success).toBe(true)
    expect(runResult.meta.changes).toBe(1)
    const allResult = await db.prepare('SELECT * FROM test_table').all()
    expect(allResult.success).toBe(true)
    expect(allResult.results).toEqual([{ id: 1, name: 'test1' }])
    const firstResult = await db.prepare('SELECT * FROM test_table WHERE name = ?').bind('test1').first()
    expect(firstResult).toEqual({ id: 1, name: 'test1' })
    const firstEmpty = await db.prepare('SELECT * FROM test_table WHERE name = ?').bind('missing').first()
    expect(firstEmpty).toBeNull()
  })

  it('executes batch statements successfully', async () => {
    const { db, sqlite } = createSqliteD1()
    sqlite.exec('CREATE TABLE IF NOT EXISTS test_batch_success (id INTEGER PRIMARY KEY, name TEXT)')
    const statements = [
      db.prepare('INSERT INTO test_batch_success (name) VALUES (?)').bind('batch1'),
      db.prepare('INSERT INTO test_batch_success (name) VALUES (?)').bind('batch2')
    ]
    const results = await db.batch(statements)
    expect(results.length).toBe(2)
    expect(results[0].success).toBe(true)
    expect(results[1].success).toBe(true)
    const all = sqlite.prepare('SELECT * FROM test_batch_success').all()
    expect(all).toHaveLength(2)
  })

  it('rolls back transaction if batch fails', async () => {
    const { db, sqlite } = createSqliteD1()
    sqlite.exec('CREATE TABLE IF NOT EXISTS test_batch_fail (id INTEGER PRIMARY KEY, name TEXT)')
    const statements = [
      db.prepare('INSERT INTO test_batch_fail (name) VALUES (?)').bind('test1'),
      db.prepare('INSERT INTO invalid_table (name) VALUES (?)').bind('test2')
    ]
    await expect(db.batch(statements)).rejects.toThrow()
    const count = sqlite.prepare('SELECT COUNT(*) as count FROM test_batch_fail').get() as { count: number }
    expect(count.count).toBe(0)
  })
})

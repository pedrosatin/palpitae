import { describe, it, expect, beforeEach } from 'vitest'
import { createSqliteD1 } from './sqliteD1'

describe('createSqliteD1', () => {
  let db: any
  let _sqlite: any

  beforeEach(() => {
    const d1 = createSqliteD1()
    db = d1.db
    _sqlite = d1.sqlite
  })

  it('applies migrations', async () => {
    // Check if a table created by migrations exists
    const res = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").first()
    expect(res).toBeTruthy()
    expect(res.name).toBe('users')
  })

  it('executes run(), first(), all() and binds correctly', async () => {
    // Insert
    const runRes = await db.prepare("INSERT INTO users (id, email, provider, provider_id) VALUES (?, ?, ?, ?)")
      .bind('test-id-1', 'test@test.com', 'test_provider', 'test_provider_id_1')
      .run()

    expect(runRes.success).toBe(true)
    expect(runRes.meta.changes).toBe(1)

    // Select first
    const firstRes = await db.prepare("SELECT * FROM users WHERE id = ?").bind('test-id-1').first()
    expect(firstRes.id).toBe('test-id-1')
    expect(firstRes.email).toBe('test@test.com')

    // Select all
    const allRes = await db.prepare("SELECT * FROM users WHERE id = ?").bind('test-id-1').all()
    expect(allRes.success).toBe(true)
    expect(allRes.results.length).toBe(1)
    expect(allRes.results[0].id).toBe('test-id-1')
  })

  it('returns null on first() when not found', async () => {
    const firstRes = await db.prepare("SELECT * FROM users WHERE id = ?").bind('missing').first()
    expect(firstRes).toBeNull()
  })

  it('executes batch correctly', async () => {
    const stmts = [
      db.prepare("INSERT INTO users (id, email, provider, provider_id) VALUES (?, ?, ?, ?)").bind('b1', 'b1@t.com', 'provider', 'id1'),
      db.prepare("INSERT INTO users (id, email, provider, provider_id) VALUES (?, ?, ?, ?)").bind('b2', 'b2@t.com', 'provider', 'id2')
    ]
    const results = await db.batch(stmts)
    expect(results.length).toBe(2)
    expect(results[0].success).toBe(true)
    expect(results[1].success).toBe(true)

    const countRes = await db.prepare("SELECT COUNT(*) as c FROM users WHERE id IN ('b1', 'b2')").first()
    expect(countRes.c).toBe(2)
  })

  it('rolls back batch on error', async () => {
    const stmts = [
      db.prepare("INSERT INTO users (id, email, provider, provider_id) VALUES (?, ?, ?, ?)").bind('err1', 'err1@t.com', 'provider', 'err1'),
      // syntax error
      db.prepare("INSERT INTO missing_table (id) VALUES (?)").bind('err2')
    ]

    await expect(db.batch(stmts)).rejects.toThrow()

    // ensure 'err1' was rolled back
    const countRes = await db.prepare("SELECT COUNT(*) as c FROM users WHERE id = 'err1'").first()
    expect(countRes.c).toBe(0)
  })
})

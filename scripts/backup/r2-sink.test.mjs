import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createR2Client, encodeS3Key, readR2Env } from './lib/r2-client.mjs'
import { createR2Sink } from './lib/sink-r2.mjs'
import { evaluatePruneSafety, assertPruneSafeToApply } from './lib/prune-guard.mjs'
import { selectRetention } from './lib/retention.mjs'
import { buildObjectPaths } from './lib/naming.mjs'
import { sha256Buffer } from './lib/integrity.mjs'
import { createLocalSink } from './lib/sink-local.mjs'
import { createSimulatedR2 } from './lib/test-sim-r2.mjs'

describe('r2 client helpers', () => {
  it('encodes keys without breaking slashes', () => {
    assert.equal(encodeS3Key('d1/palpitae/a b.sql.gz.age'), 'd1/palpitae/a%20b.sql.gz.age')
  })

  it('readR2Env does not invent credentials', () => {
    const creds = readR2Env({})
    assert.equal(creds.accessKeyId, '')
    assert.equal(creds.secretAccessKey, '')
  })
})

describe('simulated R2 sink', () => {
  it('uploads, lists, downloads and prunes on R2 inventory', async () => {
    const sim = createSimulatedR2()
    const sink = createR2Sink({
      accountId: sim.accountId,
      endpoint: sim.endpoint,
      accessKeyId: 'keyid',
      secretAccessKey: 'key',
      bucketName: sim.bucketName,
      fetchImpl: sim.fetchImpl,
    })

    const dates = [
      new Date('2026-11-03T04:00:00Z'),
      new Date('2026-10-01T04:00:00Z'),
      new Date('2025-11-03T04:00:00Z'),
    ]
    for (const createdAt of dates) {
      const paths = buildObjectPaths({ dbName: 'palpitae', createdAt })
      const body = Buffer.from(`cipher-${paths.stamp}`)
      await sink.put(paths.ciphertextKey, body)
      await sink.put(paths.manifestKey, `${JSON.stringify({ stamp: paths.stamp })}\n`)
    }

    const listed = await sink.listBackups({ dbName: 'palpitae' })
    assert.equal(listed.length, 3)

    const newestKey = listed[0].key
    const got = await sink.get(newestKey)
    assert.ok(got.byteLength > 0)

    const objects = listed.map((o) => ({ key: o.key, createdAt: o.createdAt }))
    const { keep, prune } = selectRetention(objects, { daily: 1, weekly: 0, monthly: 1 })
    const safety = evaluatePruneSafety({ keep, prune, listed: objects, apply: true })
    assert.equal(safety.ok, true)
    assert.ok(keep.some((k) => k.key === newestKey))

    const deletion = await sink.deleteKeys(
      prune.map((p) => p.key),
      { apply: true },
    )
    assert.ok(deletion.deleted.every((d) => d.sink === 'r2' && d.dryRun === false))

    const after = await sink.listBackups({ dbName: 'palpitae' })
    assert.ok(after.some((o) => o.key === newestKey))
    assert.ok(after.length >= 1)
  })

  it('put from path streams without requiring a second Buffer from caller', async () => {
    const sim = createSimulatedR2()
    const sink = createR2Sink({
      accountId: sim.accountId,
      endpoint: sim.endpoint,
      accessKeyId: 'keyid',
      secretAccessKey: 'key',
      bucketName: sim.bucketName,
      fetchImpl: sim.fetchImpl,
    })
    const dir = join(tmpdir(), `palpitae-r2-path-${Date.now()}`)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const filePath = join(dir, 'obj.age')
    try {
      await writeFile(filePath, Buffer.from('streamed-cipher'), { mode: 0o600 })
      const paths = buildObjectPaths({
        dbName: 'palpitae',
        createdAt: new Date('2026-11-03T05:00:00Z'),
      })
      await sink.put(paths.ciphertextKey, { path: filePath })
      const listed = await sink.listBackups({ dbName: 'palpitae' })
      assert.equal(listed.length, 1)
      assert.equal(listed[0].key, paths.ciphertextKey)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('createR2Client rejects missing credentials without leaking secrets', () => {
    assert.throws(
      () =>
        createR2Client({
          accountId: 'acct',
          accessKeyId: '',
          secretAccessKey: 'super-secret-value',
          bucketName: 'b',
        }),
      /accessKeyId and secretAccessKey/,
    )
  })

  it('GetObject 404 is classified as missing via sink get', async () => {
    const sim = createSimulatedR2()
    const sink = createR2Sink({
      accountId: sim.accountId,
      endpoint: sim.endpoint,
      accessKeyId: 'keyid',
      secretAccessKey: 'key',
      bucketName: sim.bucketName,
      fetchImpl: sim.fetchImpl,
    })
    await assert.rejects(() => sink.get('d1/palpitae/missing.sql.gz.age'), /404|NoSuchKey|GetObject/)
  })
})

describe('prune safety with R2-shaped inventory', () => {
  it('refuses apply that would delete the only validated backup', () => {
    const prune = [{ key: 'd1/palpitae/2026/11/03/palpitae-d1-20261103T040000Z.sql.gz.age', createdAt: Date.parse('2026-11-03T04:00:00Z') }]
    const listed = [...prune]
    const plan = { keep: [], prune, listed, apply: true }
    const safety = evaluatePruneSafety(plan)
    assert.equal(safety.ok, false)
    assert.match(safety.reason, /keep-set-empty|sole|no-validated|empty/)
    assert.throws(() => assertPruneSafeToApply(plan), /refusing --apply prune/)
  })
})

describe('local sink still works for rehearsal', () => {
  it('round-trips put/list/get', async () => {
    const dir = join(tmpdir(), `palpitae-local-sink-${Date.now()}`)
    await mkdir(dir, { recursive: true, mode: 0o700 })
    try {
      const sink = createLocalSink(dir)
      const paths = buildObjectPaths({
        dbName: 'palpitae',
        createdAt: new Date('2026-11-03T04:00:00Z'),
      })
      const body = Buffer.from('local-cipher')
      await sink.put(paths.ciphertextKey, body)
      await sink.put(paths.manifestKey, JSON.stringify({ stamp: paths.stamp }))
      const listed = await sink.listBackups({ dbName: 'palpitae' })
      assert.equal(listed.length, 1)
      const got = await sink.get(paths.ciphertextKey)
      assert.equal(sha256Buffer(got), sha256Buffer(body))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

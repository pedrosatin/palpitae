import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_RETENTION,
  selectRetention,
  utcDayKey,
  utcMonthKey,
  utcWeekKey,
} from './lib/retention.mjs'
import { buildObjectPaths, fromCompactUtc, parseCiphertextKey, toCompactUtc } from './lib/naming.mjs'
import { buildManifest, recipientFingerprint, sha256Buffer } from './lib/integrity.mjs'
import { parseBackupManifest, inventoryFingerprint } from './lib/inventory.mjs'
import { evaluatePruneSafety } from './lib/prune-guard.mjs'

describe('naming', () => {
  it('round-trips compact UTC stamps', () => {
    const d = new Date('2026-11-03T04:05:06Z')
    const stamp = toCompactUtc(d)
    assert.equal(stamp, '20261103T040506Z')
    assert.equal(fromCompactUtc(stamp).toISOString(), d.toISOString())
  })

  it('builds and parses ciphertext keys', () => {
    const paths = buildObjectPaths({
      prefix: 'prod',
      dbName: 'palpitae',
      createdAt: new Date('2026-11-03T04:00:00Z'),
    })
    assert.equal(
      paths.ciphertextKey,
      'prod/d1/palpitae/2026/11/03/palpitae-d1-20261103T040000Z.sql.gz.age',
    )
    const parsed = parseCiphertextKey(paths.ciphertextKey, 'prod')
    assert.ok(parsed)
    assert.equal(parsed.dbName, 'palpitae')
    assert.equal(parsed.stamp, '20261103T040000Z')
  })

  it('rejects path traversal-looking keys via parse', () => {
    assert.equal(parseCiphertextKey('../d1/palpitae/2026/11/03/palpitae-d1-20261103T040000Z.sql.gz.age'), null)
  })
})

describe('retention', () => {
  it('exposes operator defaults', () => {
    assert.deepEqual(DEFAULT_RETENTION, { daily: 14, weekly: 8, monthly: 12 })
  })

  it('keeps newest and fills daily/weekly/monthly slots', () => {
    /** @type {{ key: string, createdAt: Date }[]} */
    const objects = []
    // 20 consecutive daily backups
    for (let i = 0; i < 20; i++) {
      const day = 20 - i
      const createdAt = new Date(Date.UTC(2026, 10, day, 4, 0, 0)) // Nov 2026
      objects.push({ key: `k-${utcDayKey(createdAt)}`, createdAt })
    }
    // older months
    for (let month = 0; month < 14; month++) {
      const createdAt = new Date(Date.UTC(2025, month, 1, 4, 0, 0))
      objects.push({ key: `m-${utcMonthKey(createdAt)}`, createdAt })
    }

    const { keep, prune } = selectRetention(objects, { daily: 14, weekly: 8, monthly: 12 })
    assert.ok(keep.some((k) => k.key === objects[0].key), 'newest kept')
    assert.ok(keep.length >= 14)
    assert.ok(prune.length > 0)

    const keepDays = new Set(keep.map((k) => utcDayKey(k.createdAt)))
    assert.ok(keepDays.size <= objects.length)
    // With 14 daily, the 15th-newest day should not be required by daily tier alone;
    // it may survive via weekly/monthly. Ensure prune is non-empty for the long tail.
    assert.ok(prune.every((p) => keep.every((k) => k.key !== p.key)))
  })

  it('week and month keys are stable UTC helpers', () => {
    const d = new Date('2026-11-03T12:00:00Z')
    assert.equal(utcDayKey(d), '2026-11-03')
    assert.equal(utcMonthKey(d), '2026-11')
    assert.match(utcWeekKey(d), /^2026-W\d{2}$/)
  })
})

describe('integrity manifest', () => {
  it('builds manifest without secrets or cleartext rowCounts', () => {
    const recipient = 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
    const manifest = buildManifest({
      dbName: 'palpitae',
      stamp: '20261103T040000Z',
      ciphertextKey: 'd1/palpitae/2026/11/03/palpitae-d1-20261103T040000Z.sql.gz.age',
      sealedMetaKey: 'd1/palpitae/2026/11/03/palpitae-d1-20261103T040000Z.meta.json.age',
      countsKey: 'd1/palpitae/2026/11/03/palpitae-d1-20261103T040000Z.counts.json',
      ciphertextSha256: sha256Buffer('cipher'),
      plaintextSha256: sha256Buffer('plain'),
      gzipSha256: sha256Buffer('gzip'),
      sealedMetaSha256: sha256Buffer('sealed'),
      countsSha256: sha256Buffer('counts'),
      plaintextBytes: 10,
      gzipBytes: 8,
      ciphertextBytes: 12,
      sealedMetaBytes: 4,
      countsBytes: 4,
      ageRecipientFingerprint: recipientFingerprint(recipient),
      source: 'fixture:synthetic.sql',
      createdAtIso: '2026-11-03T04:00:00.000Z',
    })
    const json = JSON.stringify(manifest)
    assert.equal(manifest.kind, 'palpitae-d1-backup')
    assert.equal(manifest.rowCounts, undefined)
    assert.ok(!json.includes('AGE-SECRET-KEY'))
    assert.ok(!json.includes('password'))
    assert.ok(!/"token"/.test(json))
  })

  it('parseBackupManifest rejects wrong kind and bad hash shape', () => {
    assert.equal(parseBackupManifest('{').ok, false)
    assert.equal(parseBackupManifest({ kind: 'other', hashes: { ciphertextSha256: 'a'.repeat(64) } }).ok, false)
    assert.equal(
      parseBackupManifest({ kind: 'palpitae-d1-backup', hashes: { ciphertextSha256: 'nope' } }).ok,
      false,
    )
    const incomplete = parseBackupManifest({
      kind: 'palpitae-d1-backup',
      hashes: { ciphertextSha256: 'a'.repeat(64) },
    })
    assert.equal(incomplete.ok, false)
    assert.equal(incomplete.reason, 'manifest-missing-sealed-meta-hash')
    const ok = parseBackupManifest({
      kind: 'palpitae-d1-backup',
      sealedMetaKey: 'd1/x.meta.json.age',
      countsKey: 'd1/x.counts.json',
      hashes: {
        ciphertextSha256: 'a'.repeat(64),
        sealedMetaSha256: 'b'.repeat(64),
        countsSha256: 'c'.repeat(64),
      },
    })
    assert.equal(ok.ok, true)
  })

  it('inventory fingerprint changes when fileId changes', () => {
    const a = inventoryFingerprint([{ key: 'k', fileId: '1', contentLength: 10 }])
    const b = inventoryFingerprint([{ key: 'k', fileId: '2', contentLength: 10 }])
    assert.notEqual(a, b)
  })

  it('fail-closed when validation incomplete', () => {
    const listed = [{ key: 'a', createdAt: new Date('2026-11-03T00:00:00Z') }]
    const safety = evaluatePruneSafety({
      keep: listed,
      prune: [],
      listed,
      validated: listed,
      unvalidated: [],
      incomplete: true,
      apply: true,
    })
    assert.equal(safety.ok, false)
    assert.equal(safety.reason, 'inventory-validation-incomplete')
  })
})

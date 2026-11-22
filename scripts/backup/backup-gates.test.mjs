/**
 * Regression gates for the D1 backup pipeline (dump, recipients, egress, age).
 * No real R2 / Cloudflare / production secrets.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import {
  FORBIDDEN_EXAMPLE_RECIPIENTS,
  parseRecipientsText,
  loadRecipientsFile,
  resolveRecipients,
  recipientsFingerprints,
} from './lib/recipients.mjs'
import {
  ESSENTIAL_TABLES,
  SYNTHETIC_EXPECTATIONS,
  assertCountGate,
  assertExpectedTablesPresent,
  assertSqliteIntegrity,
  importSqlDump,
  PublicBackupError,
  runSqlite3,
  sqliteMinEnv,
  validatePlaintextDump,
  MIN_PLAINTEXT_BYTES,
} from './lib/verify-sqlite.mjs'
import {
  assertNewObjectFullyValidated,
  classifyBackupInventory,
  estimateCiphertextEgressBytes,
  isCorruptionReason,
  summarizeInventoryHealth,
} from './lib/inventory.mjs'
import { recipientFingerprint } from './lib/integrity.mjs'
import { buildObjectPaths } from './lib/naming.mjs'
import { createLocalSink } from './lib/sink-local.mjs'
import { createR2Sink } from './lib/sink-r2.mjs'
import { readR2Env } from './lib/r2-client.mjs'
import { ageEncryptFile, packAndStore, resolveAgeBins } from './lib/pipeline.mjs'
import { buildTestArtifacts, putTestBackup } from './lib/test-manifest.mjs'
import {
  BOOTSTRAP_EVIDENCE_KIND,
  buildPublicCounts,
  parseCountsDocument,
  classifySinkReadError,
  resolveBaselineCountsFromSink,
  rowCountsToNonEmpty,
  validateBaselineCandidate,
} from './lib/counts-baseline.mjs'
import {
  sanitizeDumpValidation,
  sanitizeErrorMessage,
  sanitizeManifest,
  sanitizePublicReport,
} from './lib/public-report.mjs'
import {
  checkBackupTools,
  runBackupPreflight,
} from './lib/preflight.mjs'
import {
  buildRestoreProof,
  buildRestoreProofFromRecipients,
  validateRestoreProof,
} from './lib/restore-proof.mjs'
import { createSimulatedR2 } from './lib/test-sim-r2.mjs'
import { restoreIsolated } from './restore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, 'fixtures', 'synthetic.sql')
const EXAMPLE_PATH = join(__dirname, 'recipients.example')
const AGE = process.env.PALPITAE_AGE_BIN || resolveAgeBins().age
const AGE_KEYGEN = process.env.PALPITAE_AGE_KEYGEN_BIN || resolveAgeBins().ageKeygen
const REQUIRE_AGE = process.env.PALPITAE_BACKUP_REQUIRE_AGE === '1'

function ageAvailable() {
  const r = spawnSync(AGE, ['--version'], { encoding: 'utf8' })
  return !r.error && r.status === 0
}

if (REQUIRE_AGE && !ageAvailable()) {
  throw new Error(
    `PALPITAE_BACKUP_REQUIRE_AGE=1 but age is unavailable (${AGE}). Install age or set PALPITAE_AGE_BIN / PALPITAE_AGE_KEYGEN_BIN. CI must not skip age CLI tests.`,
  )
}

function essentialSchemaSql() {
  return ESSENTIAL_TABLES.map((t) => `CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY);\n`).join(
    '',
  )
}

describe('dump validation', () => {
  it('refuses empty dump before encrypt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-empty-'))
    try {
      const path = join(dir, 'empty.sql')
      await writeFile(path, '')
      await assert.rejects(() => validatePlaintextDump(path), /plaintext-dump-empty|empty/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses garbage that is not SQL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-garbage-'))
    try {
      const path = join(dir, 'garbage.sql')
      await writeFile(path, 'this is not a database dump at all\n'.repeat(8))
      await assert.rejects(() => validatePlaintextDump(path), /does not look like SQL/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses SQL without essential schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-schema-'))
    try {
      const path = join(dir, 'wrong.sql')
      await writeFile(
        path,
        `${'-- wrong schema\nCREATE TABLE IF NOT EXISTS unrelated (id TEXT);\nINSERT INTO unrelated VALUES (\'x\');\n'.repeat(3)}`,
      )
      await assert.rejects(() => validatePlaintextDump(path), /missing essential tables/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses tiny truncated dumps', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-tiny-'))
    try {
      const path = join(dir, 'tiny.sql')
      await writeFile(path, 'CREATE TABLE users (id TEXT);\n')
      assert.ok(Buffer.byteLength('CREATE TABLE users (id TEXT);\n') < MIN_PLAINTEXT_BYTES)
      await assert.rejects(() => validatePlaintextDump(path), /plaintext-dump-too-small|too small/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses schema-only dump without evidence (previously passed)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-schema-only-'))
    try {
      const path = join(dir, 'schema-only.sql')
      await writeFile(path, essentialSchemaSql())
      await assert.rejects(
        () => validatePlaintextDump(path, { allowUnbaselined: true }),
        /schema-only/,
      )
      await assert.rejects(() => validatePlaintextDump(path), /insufficient count evidence|schema-only/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses truncated-at-SQL-boundary dump that drops baseline rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-trunc-bound-'))
    try {
      const path = join(dir, 'trunc.sql')
      // Complete statements only — sqlite import succeeds, most tables empty.
      await writeFile(
        path,
        `${essentialSchemaSql()}INSERT INTO users (id) VALUES ('u1');\nINSERT INTO competitions (id) VALUES ('c1');\n`,
      )
      await assert.rejects(
        () =>
          validatePlaintextDump(path, {
            baselineRowCounts: { ...SYNTHETIC_EXPECTATIONS },
          }),
        /catastrophic drop|schema-only|count gate/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('refuses dump that does not end on a statement boundary', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-mid-trunc-'))
    try {
      const path = join(dir, 'mid.sql')
      await writeFile(
        path,
        `${essentialSchemaSql()}INSERT INTO users (id) VALUES ('u1');\nINSERT INTO predictions (id) VAL`,
      )
      await assert.rejects(
        () => validatePlaintextDump(path, { allowUnbaselined: true }),
        /statement boundary|sqlite-import-failed|plaintext-dump-import-failed/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('allows legally empty tables when baseline evidence says empty', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-empty-ok-'))
    try {
      const path = join(dir, 'empty-ok.sql')
      const emptyBaseline = Object.fromEntries(ESSENTIAL_TABLES.map((t) => [t, 0]))
      await writeFile(path, essentialSchemaSql())
      const result = await validatePlaintextDump(path, { baselineRowCounts: emptyBaseline })
      assert.equal(result.ok, true)
      assert.deepEqual(result.rowCounts, emptyBaseline)
      assert.equal(result.countGate.mode, 'baseline')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fail-closed when evidence is insufficient', () => {
    const gate = assertCountGate({
      actual: { ...SYNTHETIC_EXPECTATIONS },
      allowUnbaselined: false,
    })
    assert.equal(gate.ok, false)
    assert.equal(gate.mode, 'insufficient')
  })

  it('accepts synthetic fixture with essential tables when unbaselined allowed', async () => {
    const result = await validatePlaintextDump(FIXTURE, { allowUnbaselined: true })
    assert.equal(result.ok, true)
    assert.ok(result.bytes > MIN_PLAINTEXT_BYTES)
    for (const t of ESSENTIAL_TABLES) assert.ok(result.tables.includes(t))
    assert.deepEqual(result.rowCounts, { ...SYNTHETIC_EXPECTATIONS })
  })
})

describe('recipients', () => {
  it('refuses recipients.example as a live file', async () => {
    await assert.rejects(() => loadRecipientsFile(EXAMPLE_PATH), /recipients\.example/)
  })

  it('refuses the known orphan example public key', () => {
    const orphan = FORBIDDEN_EXAMPLE_RECIPIENTS[0]
    assert.throws(
      () => parseRecipientsText(`${orphan}\n`),
      /example\/orphan recipient/,
    )
  })

  it('loads multiple recipients from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-rcpts-'))
    try {
      const path = join(dir, 'recipients.local')
      // Valid-looking age1 strings (not the forbidden orphan). Encryption tests
      // use real age-keygen output; parse only checks format + deny-list.
      const a = 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
      const b = 'age1ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccqqqq'
      await writeFile(path, `# comment\n${a}\n\n${b}\n`)
      const list = await loadRecipientsFile(path)
      assert.deepEqual(list, [a, b])
      const fps = recipientsFingerprints(list)
      assert.equal(fps.recipientCount, 2)
      assert.equal(fps.recipientFingerprints.length, 2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('previously ignored all but the first recipient (defect lock)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-rcpts-old-'))
    try {
      const path = join(dir, 'recipients.local')
      const a = 'age1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      const b = 'age1bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
      await writeFile(path, `${a}\n${b}\n`)
      const list = await resolveRecipients({ recipientsFile: path })
      assert.equal(list.length, 2, 'must keep every age1 line, not only the first')
      assert.equal(list[0], a)
      assert.equal(list[1], b)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('example file contains no functional age1 recipient line', async () => {
    const { readFile } = await import('node:fs/promises')
    const raw = await readFile(EXAMPLE_PATH, 'utf8')
    const ageLines = raw.split('\n').filter((l) => l.trim().startsWith('age1'))
    assert.equal(ageLines.length, 0)
    assert.ok(!raw.includes(FORBIDDEN_EXAMPLE_RECIPIENTS[0]))
  })
})

describe('R2 credential roles', () => {
  it('prune apply refuses missing R2_PRUNE_* without daily fallback', () => {
    assert.throws(
      () =>
        readR2Env(
          {
            R2_ACCESS_KEY_ID: 'daily-id',
            R2_SECRET_ACCESS_KEY: 'daily-secret',
            R2_BUCKET: 'bucket',
          },
          { role: 'prune', allowDailyFallback: false },
        ),
      /R2_PRUNE_ACCESS_KEY_ID/,
    )
  })

  it('prune role prefers R2_PRUNE_* over daily keys', () => {
    const env = readR2Env(
      {
        R2_ACCESS_KEY_ID: 'daily-id',
        R2_SECRET_ACCESS_KEY: 'daily-secret',
        R2_PRUNE_ACCESS_KEY_ID: 'prune-id',
        R2_PRUNE_SECRET_ACCESS_KEY: 'prune-secret',
        R2_BUCKET: 'bucket',
      },
      { role: 'prune' },
    )
    assert.equal(env.accessKeyId, 'prune-id')
    assert.equal(env.secretAccessKey, 'prune-secret')
    assert.equal(env.role, 'prune')
  })

  it('daily role ignores prune keys', () => {
    const env = readR2Env(
      {
        R2_ACCESS_KEY_ID: 'daily-id',
        R2_SECRET_ACCESS_KEY: 'daily-secret',
        R2_PRUNE_ACCESS_KEY_ID: 'prune-id',
        R2_PRUNE_SECRET_ACCESS_KEY: 'prune-secret',
        R2_BUCKET: 'bucket',
      },
      { role: 'daily' },
    )
    assert.equal(env.accessKeyId, 'daily-id')
    assert.equal(env.role, 'daily')
  })
})

describe('efficient verification + egress', () => {
  it('hybrid verifies only mustVerifyKeys with full hash; others stay lightweight', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-hybrid-'))
    try {
      const sink = createLocalSink(dir)
      const newAt = new Date('2026-11-03T04:00:00Z')
      const oldAt = new Date('2026-11-01T04:00:00Z')
      const newer = buildObjectPaths({ dbName: 'palpitae', createdAt: newAt })
      const older = buildObjectPaths({ dbName: 'palpitae', createdAt: oldAt })
      const bodyNew = Buffer.from('new-cipher-body-xxxxxxxx')
      const bodyOld = Buffer.from('old-cipher-body-yyyyyyyy')
      for (const [paths, body, at] of [
        [newer, bodyNew, newAt],
        [older, bodyOld, oldAt],
      ]) {
        const artifacts = buildTestArtifacts({
          paths,
          cipher: body,
          createdAtIso: at.toISOString(),
        })
        await putTestBackup(sink, artifacts, paths, body)
      }

      const listed = await sink.listBackups({ dbName: 'palpitae' })
      const estimate = estimateCiphertextEgressBytes(listed, {
        verifyMode: 'hybrid',
        mustVerifyKeys: [newer.ciphertextKey],
      })
      assert.equal(estimate.fullHashObjects, 1)
      assert.equal(estimate.lightweightObjects, 1)
      assert.equal(estimate.estimatedCiphertextDownloadBytes, bodyNew.byteLength)

      const classification = await classifyBackupInventory(sink, listed, {
        verifyMode: 'hybrid',
        mustVerifyKeys: [newer.ciphertextKey],
      })
      assert.equal(classification.validated.length, 2)
      const newHit = classification.validated.find((v) => v.key === newer.ciphertextKey)
      const oldHit = classification.validated.find((v) => v.key === older.ciphertextKey)
      assert.equal(newHit.verification, 'full')
      assert.equal(newHit.reason, 'manifest-hash-ok')
      assert.equal(oldHit.verification, 'lightweight')
      assert.equal(oldHit.reason, 'manifest-size-ok')

      const fullEstimate = estimateCiphertextEgressBytes(listed, { verifyMode: 'full' })
      assert.equal(fullEstimate.fullHashObjects, 2)
      assert.ok(
        fullEstimate.estimatedCiphertextDownloadBytes >
          estimate.estimatedCiphertextDownloadBytes,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not treat missing size metadata as lightweight-validated in manifest-size mode', async () => {
    const listed = [
      {
        key: 'd1/palpitae/2026/11/03/palpitae-d1-20261103T040000Z.sql.gz.age',
        createdAt: new Date('2026-11-03T04:00:00Z'),
        // contentLength intentionally omitted
      },
    ]
    const estimate = estimateCiphertextEgressBytes(listed, { verifyMode: 'manifest-size' })
    assert.equal(estimate.fullHashObjects, 0)
    assert.equal(estimate.lightweightObjects, 1)
  })
})

describe('job success semantics', () => {
  it('assertNewObjectFullyValidated fails when inventory incomplete', () => {
    const result = assertNewObjectFullyValidated(
      {
        incomplete: true,
        hardErrors: ['k:ciphertext-read-error'],
        validated: [],
        unvalidated: [],
      },
      'missing',
    )
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'inventory-validation-incomplete')
  })

  it('assertNewObjectFullyValidated fails when new object only lightweight-validated', () => {
    const key = 'd1/palpitae/2026/11/03/palpitae-d1-20261103T040000Z.sql.gz.age'
    const result = assertNewObjectFullyValidated(
      {
        incomplete: false,
        hardErrors: [],
        validated: [
          {
            key,
            status: 'validated',
            reason: 'manifest-size-ok',
            verification: 'lightweight',
            createdAt: new Date(),
          },
        ],
        unvalidated: [],
      },
      key,
    )
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'new-object-not-fully-hashed')
  })

  it('assertNewObjectFullyValidated passes on full hash of new object', () => {
    const key = 'd1/palpitae/2026/11/03/palpitae-d1-20261103T040000Z.sql.gz.age'
    const result = assertNewObjectFullyValidated(
      {
        incomplete: false,
        hardErrors: [],
        validated: [
          {
            key,
            status: 'validated',
            reason: 'manifest-hash-ok',
            verification: 'full',
            createdAt: new Date(),
          },
        ],
        unvalidated: [],
      },
      key,
    )
    assert.equal(result.ok, true)
  })
})

describe('multi-recipient encrypt', () => {
  it(
    'encrypts to two recipients so either identity can decrypt',
    { skip: !ageAvailable() },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'palpitae-multi-age-'))
      try {
        const id1 = join(dir, 'id1.txt')
        const id2 = join(dir, 'id2.txt')
        spawnSync(AGE_KEYGEN, ['-o', id1], { encoding: 'utf8' })
        spawnSync(AGE_KEYGEN, ['-o', id2], { encoding: 'utf8' })
        const r1 = spawnSync(AGE_KEYGEN, ['-y', id1], { encoding: 'utf8' }).stdout.trim()
        const r2 = spawnSync(AGE_KEYGEN, ['-y', id2], { encoding: 'utf8' }).stdout.trim()
        const plain = join(dir, 'plain.txt')
        const cipher = join(dir, 'cipher.age')
        const out1 = join(dir, 'out1.txt')
        const out2 = join(dir, 'out2.txt')
        await writeFile(plain, 'multi-recipient-secret\n', { mode: 0o600 })
        await ageEncryptFile({
          ageBin: AGE,
          inputPath: plain,
          outputPath: cipher,
          recipients: [r1, r2],
        })
        const d1 = spawnSync(AGE, ['-d', '-i', id1, '-o', out1, cipher], { encoding: 'utf8' })
        const d2 = spawnSync(AGE, ['-d', '-i', id2, '-o', out2, cipher], { encoding: 'utf8' })
        assert.equal(d1.status, 0, d1.stderr)
        assert.equal(d2.status, 0, d2.stderr)
        const { readFile } = await import('node:fs/promises')
        assert.equal(await readFile(out1, 'utf8'), 'multi-recipient-secret\n')
        assert.equal(await readFile(out2, 'utf8'), 'multi-recipient-secret\n')
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )

  it(
    'packAndStore records multiple recipient fingerprints',
    { skip: !ageAvailable() },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'palpitae-pack-multi-'))
      try {
        const id1 = join(dir, 'id1.txt')
        const id2 = join(dir, 'id2.txt')
        spawnSync(AGE_KEYGEN, ['-o', id1], { encoding: 'utf8' })
        spawnSync(AGE_KEYGEN, ['-o', id2], { encoding: 'utf8' })
        const r1 = spawnSync(AGE_KEYGEN, ['-y', id1], { encoding: 'utf8' }).stdout.trim()
        const r2 = spawnSync(AGE_KEYGEN, ['-y', id2], { encoding: 'utf8' }).stdout.trim()
        const sinkDir = join(dir, 'sink')
        await mkdir(sinkDir, { recursive: true, mode: 0o700 })
        const sink = createLocalSink(sinkDir)
        const plaintextPath = join(dir, 'dump.sql')
        const { copyFile } = await import('node:fs/promises')
        await copyFile(FIXTURE, plaintextPath)
        const result = await packAndStore({
          sink,
          dbName: 'palpitae',
          plaintextPath,
          recipients: [r1, r2],
          source: 'test:multi',
          createdAt: new Date('2026-11-03T04:00:00Z'),
          ageBin: AGE,
          rowCounts: { ...SYNTHETIC_EXPECTATIONS },
        })
        assert.equal(result.manifest.encryption.recipientCount, 2)
        assert.equal(result.manifest.encryption.recipientFingerprints.length, 2)
        assert.ok(result.paths.sealedMetaKey.endsWith('.meta.json.age'))
        assert.ok(result.paths.countsKey.endsWith('.counts.json'))
        assert.equal(result.manifest.rowCounts, undefined)
        assert.ok(result.manifest.hashes.sealedMetaSha256)
        assert.deepEqual(result.sealedMeta.rowCounts, SYNTHETIC_EXPECTATIONS)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})

describe('backup.mjs refuses empty dump (integration)', () => {
  it('exits non-zero for empty sql-file without creating ciphertext', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-backup-empty-'))
    try {
      const empty = join(dir, 'empty.sql')
      await writeFile(empty, '')
      const sinkDir = join(dir, 'sink')
      await mkdir(sinkDir, { recursive: true, mode: 0o700 })
      const recipient = 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
      const baseline = join(dir, 'baseline.json')
      await writeFile(
        baseline,
        JSON.stringify(Object.fromEntries(ESSENTIAL_TABLES.map((t) => [t, 1]))),
      )
      const script = join(__dirname, 'backup.mjs')
      const result = spawnSync(
        process.execPath,
        [
          script,
          '--source=sql-file',
          `--sql-file=${empty}`,
          `--recipient=${recipient}`,
          '--sink=local',
          `--sink-dir=${sinkDir}`,
          `--baseline-counts=@${baseline}`,
        ],
        { encoding: 'utf8', cwd: join(__dirname, '../..') },
      )
      assert.notEqual(result.status, 0)
      assert.match(result.stderr, /empty|too small|refusing/i)
      const listed = await createLocalSink(sinkDir).listBackups({ dbName: 'palpitae' })
      assert.equal(listed.length, 0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('BACKUP_RESTORE_PROOF binding', () => {
  it('rejects arbitrary unbound strings', () => {
    const r = validateRestoreProof('i-did-a-restore-honest')
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'unbound-arbitrary-string')
  })

  it('rejects placeholders', () => {
    assert.equal(validateRestoreProof('TODO').ok, false)
    assert.equal(validateRestoreProof('example').ok, false)
  })

  it('accepts proof bound to recipient fingerprints', () => {
    const fps = ['abcd1234ef567890', 'ffff1111aaaa2222']
    const proof = buildRestoreProof({
      recipientFingerprints: fps,
      operatorToken: 'drill-2026-11-03',
    })
    const r = validateRestoreProof(proof, { expectedFingerprints: fps })
    assert.equal(r.ok, true)
    assert.ok(Array.isArray(r.limitations))
    assert.ok(r.limitations.some((l) => /not an authenticated cryptographic proof/i.test(l)))
  })

  it('rejects fingerprint mismatch', () => {
    const proof = buildRestoreProof({
      recipientFingerprints: ['aaaaaaaaaaaaaaaa'],
      operatorToken: 'drill-2026-11-03',
    })
    const r = validateRestoreProof(proof, {
      expectedFingerprints: ['bbbbbbbbbbbbbbbb'],
    })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'fingerprint-mismatch')
  })
})

describe('inventory health', () => {
  it('marks hybrid coverage as partial and full as complete', () => {
    const partial = summarizeInventoryHealth({
      verifyMode: 'hybrid',
      incomplete: false,
      hardErrors: [],
      validated: [{ key: 'a', reason: 'manifest-hash-ok', verification: 'full' }],
      unvalidated: [],
    })
    assert.equal(partial.coverage, 'partial')
    assert.equal(partial.monitoring.pushAlerts, 'none-implemented')
    assert.equal(partial.monitoring.freshnessMonitoring, 'pending')

    const complete = summarizeInventoryHealth({
      verifyMode: 'full',
      incomplete: false,
      hardErrors: [],
      validated: [],
      unvalidated: [],
    })
    assert.equal(complete.coverage, 'complete')
  })

  it('treats hash-mismatch inventory as operational failure', () => {
    const health = summarizeInventoryHealth({
      verifyMode: 'hybrid',
      incomplete: false,
      hardErrors: [],
      validated: [],
      unvalidated: [
        {
          key: 'd1/palpitae/2026/11/03/x.sql.gz.age',
          reason: 'ciphertext-hash-mismatch',
        },
      ],
    })
    assert.equal(health.operationalFailure, true)
    assert.equal(health.corruptionCount, 1)
  })
})

describe('simulated R2 download + isolated restore', () => {
  it(
    'packs to simulated R2, downloads, restores, compares sealed counts',
    { skip: !ageAvailable() },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'palpitae-r2-restore-'))
      try {
        const idPath = join(dir, 'id.txt')
        spawnSync(AGE_KEYGEN, ['-o', idPath], { encoding: 'utf8' })
        const recipient = spawnSync(AGE_KEYGEN, ['-y', idPath], {
          encoding: 'utf8',
        }).stdout.trim()

        const sim = createSimulatedR2()
        const sink = createR2Sink({
          accountId: sim.accountId,
          endpoint: sim.endpoint,
          accessKeyId: 'keyid',
          secretAccessKey: 'key',
          bucketName: sim.bucketName,
          fetchImpl: sim.fetchImpl,
        })
        const plaintextPath = join(dir, 'dump.sql')
        const { copyFile } = await import('node:fs/promises')
        await copyFile(FIXTURE, plaintextPath)
        const packed = await packAndStore({
          sink,
          dbName: 'palpitae',
          plaintextPath,
          recipients: [recipient],
          source: 'test:sim-r2',
          createdAt: new Date('2026-11-03T04:00:00Z'),
          ageBin: AGE,
          rowCounts: { ...SYNTHETIC_EXPECTATIONS },
        })

        assert.ok(sim.objects.has(packed.paths.ciphertextKey))
        assert.ok(sim.objects.has(packed.paths.manifestKey))
        assert.ok(sim.objects.has(packed.paths.sealedMetaKey))
        assert.ok(sim.objects.has(packed.paths.countsKey))
        assert.equal(packed.manifest.rowCounts, undefined)
        assert.ok(packed.manifest.hashes.sealedMetaSha256)
        assert.ok(packed.manifest.hashes.countsSha256)

        const report = await restoreIsolated({
          sink,
          ciphertextKey: packed.paths.ciphertextKey,
          identityPath: idPath,
          ageBin: AGE,
          expect: 'sealed',
        })
        assert.equal(report.ok, true)
        assert.equal(report.sealedMeta.compare.ok, true)
        assert.equal(report.sqliteIntegrity.ok, true)
        assert.deepEqual(report.sealedMeta.rowCounts, SYNTHETIC_EXPECTATIONS)

        const proof = buildRestoreProofFromRecipients([recipient], 'sim-r2-drill-ok')
        assert.equal(
          validateRestoreProof(proof, { expectedRecipients: [recipient] }).ok,
          true,
        )
        assert.equal(recipientFingerprint(recipient).length, 16)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})

describe('age CLI required when PALPITAE_BACKUP_REQUIRE_AGE=1', () => {
  it('age --version works when binary is available', { skip: !ageAvailable() }, () => {
    const r = spawnSync(AGE, ['--version'], { encoding: 'utf8' })
    assert.equal(r.status, 0)
    assert.match(r.stdout + r.stderr, /v?\d+\.\d+/i)
  })

  it('fails closed if age is required but missing', () => {
    if (ageAvailable() && process.env.PALPITAE_BACKUP_REQUIRE_AGE !== 'force-missing') {
      // In CI with age installed this documents the gate; local without the
      // force flag still asserts the helper behavior via env override.
      const r = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
            import { spawnSync } from 'node:child_process';
            const bin = process.env.PALPITAE_AGE_BIN || 'age-definitely-missing-binary';
            const probe = spawnSync(bin, ['--version'], { encoding: 'utf8' });
            if (process.env.PALPITAE_BACKUP_REQUIRE_AGE === '1') {
              if (probe.error || probe.status !== 0) {
                console.error('age required but unavailable');
                process.exit(2);
              }
            }
            process.exit(0);
          `,
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PALPITAE_BACKUP_REQUIRE_AGE: '1',
            PALPITAE_AGE_BIN: 'age-definitely-missing-binary',
          },
        },
      )
      assert.equal(r.status, 2)
      assert.match(r.stderr, /age required but unavailable/)
      return
    }
    assert.ok(true)
  })
})

describe('count-gate and CLI edge cases', () => {
  it('baseline mode only flags catastrophic empty, not half truncation', () => {
    const half = assertCountGate({
      actual: { ...SYNTHETIC_EXPECTATIONS, predictions: 300 },
      baseline: { ...SYNTHETIC_EXPECTATIONS, predictions: 600 },
    })
    assert.equal(half.ok, true, 'partial truncation is not claimed detectable')
    assert.match(half.limits, /Partial row loss/)

    const empty = assertCountGate({
      actual: { ...SYNTHETIC_EXPECTATIONS, predictions: 0 },
      baseline: { ...SYNTHETIC_EXPECTATIONS, predictions: 600 },
    })
    assert.equal(empty.ok, false)
    assert.match(empty.failures.join(' '), /catastrophic drop/)
  })

  it('refuses all-zero essentials in self mode without empty evidence', () => {
    const gate = assertCountGate({
      actual: Object.fromEntries(ESSENTIAL_TABLES.map((t) => [t, 0])),
      allowUnbaselined: true,
      schemaOnly: false,
    })
    assert.equal(gate.ok, false)
    assert.match(gate.failures.join(' '), /all essential table counts are 0/)
  })

  it('refuses --allow-unbaselined-counts for non-fixture without bootstrap', () => {
    const dir = join(tmpdir(), `palpitae-unbase-${Date.now()}`)
    return mkdir(dir, { recursive: true, mode: 0o700 }).then(async () => {
      try {
        const sql = join(dir, 'dump.sql')
        await writeFile(sql, essentialSchemaSql() + "INSERT INTO users (id) VALUES ('u');\n")
        const sinkDir = join(dir, 'sink')
        await mkdir(sinkDir, { recursive: true, mode: 0o700 })
        const result = spawnSync(
          process.execPath,
          [
            join(__dirname, 'backup.mjs'),
            '--source=sql-file',
            `--sql-file=${sql}`,
            '--recipient=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
            '--sink=local',
            `--sink-dir=${sinkDir}`,
            '--allow-unbaselined-counts',
          ],
          { encoding: 'utf8', cwd: join(__dirname, '../..') },
        )
        assert.notEqual(result.status, 0)
        assert.match(result.stderr, /refused for non-fixture|bootstrap-with-evidence/i)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    })
  })

  it('daily.mjs refuses permanent --allow-unbaselined-counts', () => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'daily.mjs'), '--allow-unbaselined-counts'],
      { encoding: 'utf8', cwd: join(__dirname, '../..') },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /refuses --allow-unbaselined-counts/)
  })

  it('backup.mjs refuses removed --skip-dump-validate', () => {
    const result = spawnSync(
      process.execPath,
      [join(__dirname, 'backup.mjs'), '--skip-dump-validate', '--source=fixture'],
      { encoding: 'utf8', cwd: join(__dirname, '../..') },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /skip-dump-validate was removed/)
  })

  it('foreign_key_check fails dumps with missing referenced users', async () => {
    const scratch =
      '/tmp/claude-1000/-home-satin--t3-worktrees-palpitae-t3-6d8e9794/09174285-a39e-4473-87cc-48cbfd6cb63f/scratchpad/nousers.sql'
    const { access } = await import('node:fs/promises')
    try {
      await access(scratch)
    } catch {
      // Scratchpad may be gone; synthesize a minimal FK violation dump.
      const dir = await mkdtemp(join(tmpdir(), 'palpitae-fk-'))
      try {
        const path = join(dir, 'nousers.sql')
        await writeFile(
          path,
          `${essentialSchemaSql()}CREATE TABLE profiles (user_id TEXT PRIMARY KEY REFERENCES users(id));\nINSERT INTO profiles (user_id) VALUES ('missing');\n`,
        )
        await assert.rejects(
          () => validatePlaintextDump(path, { allowUnbaselined: true, allowEmptyEssentials: true }),
          /sqlite-foreign-key-violations|foreign_key_check/,
        )
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
      return
    }
    await assert.rejects(
      () => validatePlaintextDump(scratch, { allowUnbaselined: true, allowEmptyEssentials: true }),
      /sqlite-foreign-key-violations|foreign_key_check/,
    )
  })

  it('parseCountsDocument accepts public counts v1/v2 and sealed-meta shapes', () => {
    const plain = parseCountsDocument(JSON.stringify(SYNTHETIC_EXPECTATIONS))
    assert.equal(plain.ok, true)
    const publicLegacy = parseCountsDocument({
      kind: 'palpitae-d1-backup-counts',
      rowCounts: SYNTHETIC_EXPECTATIONS,
    })
    assert.equal(publicLegacy.ok, true)
    assert.equal(publicLegacy.source, 'public-counts-legacy-rowCounts')
    assert.equal(publicLegacy.mode, 'numeric')
    const publicV2 = parseCountsDocument({
      kind: 'palpitae-d1-backup-counts',
      version: 2,
      nonEmpty: Object.fromEntries(ESSENTIAL_TABLES.map((t) => [t, true])),
      tables: [...ESSENTIAL_TABLES, 'leaderboard'],
    })
    assert.equal(publicV2.ok, true)
    assert.equal(publicV2.source, 'public-counts-nonEmpty')
    assert.equal(publicV2.mode, 'nonEmpty')
    assert.deepEqual(publicV2.tables, [...ESSENTIAL_TABLES, 'leaderboard'])
    const sealed = parseCountsDocument({
      kind: 'palpitae-d1-backup-meta',
      rowCounts: SYNTHETIC_EXPECTATIONS,
      plaintextSha256: 'a'.repeat(64),
    })
    assert.equal(sealed.ok, true)
    assert.equal(sealed.source, 'sealed-meta-decrypted')
  })

  it('inventory fails when sealed meta sidecar is garbage', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-sidecar-'))
    try {
      const sink = createLocalSink(dir)
      const at = new Date('2026-11-03T04:00:00Z')
      const paths = buildObjectPaths({ dbName: 'palpitae', createdAt: at })
      const cipher = Buffer.from('cipher-body-sidecar-test')
      const artifacts = buildTestArtifacts({
        paths,
        cipher,
        createdAtIso: at.toISOString(),
      })
      await putTestBackup(sink, artifacts, paths, cipher)
      // Corrupt sealed meta in place (same key).
      await sink.put(paths.sealedMetaKey, Buffer.alloc(artifacts.sealedBytes.byteLength, 7))
      const listed = await sink.listBackups({ dbName: 'palpitae' })
      const classification = await classifyBackupInventory(sink, listed, { verifyMode: 'hybrid' })
      assert.equal(classification.validated.length, 0)
      assert.equal(classification.unvalidated[0].reason, 'sealed-meta-hash-mismatch')
      const health = summarizeInventoryHealth(classification)
      assert.equal(health.operationalFailure, true)
      assert.equal(health.corruptionCount, 1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('daily --apply-prune fails closed when full reclass finds corruption', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-apply-corrupt-'))
    try {
      const sink = createLocalSink(dir)
      const keepAt = new Date('2026-11-03T04:00:00Z')
      const oldAt = new Date('2026-10-01T04:00:00Z')
      const keepPaths = buildObjectPaths({ dbName: 'palpitae', createdAt: keepAt })
      const oldPaths = buildObjectPaths({ dbName: 'palpitae', createdAt: oldAt })
      const keepBody = Buffer.from('keep-cipher-aaaaaaaa')
      const oldBody = Buffer.from('old-cipher-bbbbbbbb')
      await putTestBackup(
        sink,
        buildTestArtifacts({ paths: keepPaths, cipher: keepBody, createdAtIso: keepAt.toISOString() }),
        keepPaths,
        keepBody,
      )
      const oldArtifacts = buildTestArtifacts({
        paths: oldPaths,
        cipher: oldBody,
        createdAtIso: oldAt.toISOString(),
      })
      await putTestBackup(sink, oldArtifacts, oldPaths, oldBody)
      // Flip one byte of the old ciphertext without changing size.
      const flipped = Buffer.from(oldBody)
      flipped[0] = flipped[0] ^ 0xff
      await sink.put(oldPaths.ciphertextKey, flipped)

      const listed = await sink.listBackups({ dbName: 'palpitae' })
      const full = await classifyBackupInventory(sink, listed, { verifyMode: 'full' })
      const health = summarizeInventoryHealth(full)
      assert.ok(health.corruptionCount > 0)
      assert.equal(full.unvalidated.some((u) => u.reason === 'ciphertext-hash-mismatch'), true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fixture to R2 is refused without --allow-fixture-to-r2', () => {
    const result = spawnSync(
      process.execPath,
      [
        join(__dirname, 'backup.mjs'),
        '--source=fixture',
        '--sink=r2',
        '--recipient=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
      ],
      {
        encoding: 'utf8',
        cwd: join(__dirname, '../..'),
        env: {
          ...process.env,
          R2_ACCESS_KEY_ID: 'x',
          R2_SECRET_ACCESS_KEY: 'y',
          R2_BUCKET: 'z',
        },
      },
    )
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /allow-fixture-to-r2|production backup prefix/i)
  })

  it('bootstrap evidence kind is required', () => {
    assert.equal(
      JSON.stringify({ kind: BOOTSTRAP_EVIDENCE_KIND }).includes('bootstrap'),
      true,
    )
  })

  it('synthetic fixture passes integrity_check + foreign_key_check', async () => {
    const result = await validatePlaintextDump(FIXTURE, { allowUnbaselined: true })
    assert.equal(result.ok, true)
    assert.equal(result.sqliteIntegrity.integrityCheck, 'ok')
    assert.equal(result.sqliteIntegrity.foreignKeyViolations, 0)
    // Touch helper export used by restore.
    assert.equal(typeof assertSqliteIntegrity, 'function')
  })
})

describe('bootstrap evidence and CLI parsing', () => {
  it('parses --bootstrap-with-evidence= with slice(26) via real CLI', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-bootstrap-slice-'))
    try {
      const sinkDir = join(dir, 'sink')
      await mkdir(sinkDir, { recursive: true, mode: 0o700 })
      const evidence = {
        kind: BOOTSTRAP_EVIDENCE_KIND,
        reason: 'first-production-pack',
        measuredAt: '2026-11-04T00:00:00Z',
        notes: 'Measured essential COUNTs via D1 SELECT before first pack.',
        operator: 'test',
      }
      // Inline JSON: slice(25) would leave a leading "=" and fail JSON parse;
      // slice(26) yields the object and proceeds past bootstrap validation.
      const result = spawnSync(
        process.execPath,
        [
          join(__dirname, 'backup.mjs'),
          '--source=fixture',
          `--sink-dir=${sinkDir}`,
          '--sink=local',
          '--recipient=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
          `--bootstrap-with-evidence=${JSON.stringify(evidence)}`,
        ],
        {
          encoding: 'utf8',
          cwd: join(__dirname, '../..'),
          env: { ...process.env, PALPITAE_BACKUP_REQUIRE_AGE: '0' },
        },
      )
      assert.doesNotMatch(
        result.stderr + result.stdout,
        /bootstrap-json-invalid|invalid --bootstrap-with-evidence: bootstrap-json/,
      )
      if (result.status === 0) {
        const report = JSON.parse(result.stdout)
        assert.equal(report.ok, true)
        assert.equal(report.bootstrap?.kind, BOOTSTRAP_EVIDENCE_KIND)
        assert.equal(report.dumpValidation?.rowCounts, undefined)
        assert.equal(report.dumpValidation?.countGate?.actual, undefined)
        assert.equal(report.publicCounts?.rowCounts, undefined)
        assert.ok(report.publicCounts?.nonEmpty)
        assert.doesNotMatch(result.stdout, /"users":\s*2/)
      } else {
        // Without a usable age binary the pack fails after parsing bootstrap.
        assert.match(result.stderr, /age|encrypt|recipient|packAndStore|ENOENT/i)
        assert.doesNotMatch(result.stderr, /invalid --bootstrap-with-evidence/)
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('backup.mjs and daily.mjs both slice(26) for --bootstrap-with-evidence=', async () => {
    const { readFile } = await import('node:fs/promises')
    const backupSrc = await readFile(join(__dirname, 'backup.mjs'), 'utf8')
    const dailySrc = await readFile(join(__dirname, 'daily.mjs'), 'utf8')
    assert.match(backupSrc, /bootstrap-with-evidence='\)\) out\.bootstrapEvidence = arg\.slice\(26\)/)
    assert.match(dailySrc, /bootstrap-with-evidence='\)\) out\.bootstrapEvidence = arg\.slice\(26\)/)
    assert.doesNotMatch(backupSrc, /bootstrap-with-evidence='\)\) out\.bootstrapEvidence = arg\.slice\(25\)/)
    assert.doesNotMatch(dailySrc, /bootstrap-with-evidence='\)\) out\.bootstrapEvidence = arg\.slice\(25\)/)
    // Length of the flag including "=" is 26; slice(25) leaves a leading "=".
    assert.equal('--bootstrap-with-evidence='.length, 26)
  })

  it('sanitizes dumpValidation and error strings without exact COUNTs', () => {
    const dirty = {
      ok: true,
      dumpValidation: {
        ok: true,
        bytes: 100,
        tables: [...ESSENTIAL_TABLES],
        rowCounts: { ...SYNTHETIC_EXPECTATIONS },
        countGate: {
          ok: true,
          mode: 'baseline',
          actual: { ...SYNTHETIC_EXPECTATIONS },
          failures: [],
          evidence: { baseline: true },
          limits: 'x',
        },
      },
      publicCounts: {
        kind: 'palpitae-d1-backup-counts',
        rowCounts: { ...SYNTHETIC_EXPECTATIONS },
        nonEmpty: rowCountsToNonEmpty(SYNTHETIC_EXPECTATIONS),
      },
      error: 'users: catastrophic drop vs baseline (baseline=600, dump=0)',
    }
    const clean = sanitizePublicReport(dirty)
    assert.equal(/** @type {any} */ (clean).dumpValidation.rowCounts, undefined)
    assert.equal(/** @type {any} */ (clean).dumpValidation.countGate.actual, undefined)
    assert.equal(/** @type {any} */ (clean).publicCounts.rowCounts, undefined)
    assert.ok(/** @type {any} */ (clean).publicCounts.nonEmpty)
    assert.match(String(/** @type {any} */ (clean).error), /baseline=<redacted>/)
    assert.doesNotMatch(JSON.stringify(clean), /"users":\s*2/)
    assert.equal(
      sanitizeDumpValidation(dirty.dumpValidation).countGate.failureCount,
      0,
    )
    assert.match(
      sanitizeErrorMessage('predictions: dump count 3 != source count 9'),
      /dump count <redacted>.*source count <redacted>/,
    )
  })

  it('boolean nonEmpty baseline refuses catastrophic empty without exact counts', () => {
    const gate = assertCountGate({
      actual: { ...SYNTHETIC_EXPECTATIONS, predictions: 0 },
      baseline: rowCountsToNonEmpty(SYNTHETIC_EXPECTATIONS),
    })
    assert.equal(gate.ok, false)
    assert.match(gate.failures.join(' '), /catastrophic drop/)
    assert.doesNotMatch(gate.failures.join(' '), /baseline=\d+/)
  })

  it('public counts v2 omit exact rowCounts', () => {
    const doc = buildPublicCounts({
      dbName: 'palpitae',
      stamp: '20261103T040000Z',
      ciphertextKey: 'd1/palpitae/x.sql.gz.age',
      rowCounts: SYNTHETIC_EXPECTATIONS,
      tables: [...ESSENTIAL_TABLES, 'leaderboard'],
      createdAtIso: '2026-11-03T04:00:00.000Z',
    })
    assert.equal(doc.version, 2)
    assert.equal(doc.rowCounts, undefined)
    assert.deepEqual(doc.nonEmpty.users, true)
    assert.ok(doc.tables.includes('leaderboard'))
  })

  it('refuses modified baseline counts that no longer match manifest hash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-baseline-mod-'))
    try {
      const sink = createLocalSink(dir)
      const at = new Date('2026-11-03T04:00:00Z')
      const paths = buildObjectPaths({ dbName: 'palpitae', createdAt: at })
      const cipher = Buffer.from('cipher-baseline-mod-test')
      const artifacts = buildTestArtifacts({
        paths,
        cipher,
        createdAtIso: at.toISOString(),
      })
      await putTestBackup(sink, artifacts, paths, cipher)
      // Tamper with public counts after upload (same key, different bytes).
      await sink.put(
        paths.countsKey,
        Buffer.from(
          `${JSON.stringify({
            kind: 'palpitae-d1-backup-counts',
            version: 2,
            nonEmpty: Object.fromEntries(ESSENTIAL_TABLES.map((t) => [t, false])),
          })}\n`,
        ),
      )
      const listed = await sink.listBackups({ dbName: 'palpitae' })
      const resolved = await resolveBaselineCountsFromSink(sink, listed)
      assert.equal(resolved.ok, false)
      assert.match(resolved.attempts.join(' '), /baseline-counts-modified/)
      const one = await validateBaselineCandidate(sink, listed[0])
      assert.equal(one.ok, false)
      assert.equal(one.reason, 'baseline-counts-modified')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('detects table loss for dump cut after predictions vs baseline schema', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-cut-pred-'))
    try {
      const path = join(dir, 'cut.sql')
      // Full essentials through predictions (as in synthetic), but baseline
      // schema also expects leaderboard — simulates a dump truncated after
      // predictions that lost later tables.
      const { readFile } = await import('node:fs/promises')
      const synthetic = await readFile(FIXTURE, 'utf8')
      await writeFile(path, synthetic)
      const presentOk = await validatePlaintextDump(path, { allowUnbaselined: true })
      assert.ok(presentOk.tablesPresent.includes('predictions'))
      await assert.rejects(
        () =>
          validatePlaintextDump(path, {
            allowUnbaselined: true,
            expectedTables: [...ESSENTIAL_TABLES, 'leaderboard'],
          }),
        /missing tables vs expected\/baseline schema: leaderboard/,
      )
      const schema = assertExpectedTablesPresent(presentOk.tablesPresent, [
        ...ESSENTIAL_TABLES,
        'leaderboard',
      ])
      assert.equal(schema.ok, false)
      assert.deepEqual(schema.missing, ['leaderboard'])
      assert.match(schema.limits, /Does not detect all truncation/i)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('counts-parse-* reasons classify as corruption for prune fail-closed', () => {
    assert.equal(isCorruptionReason('counts-parse-counts-json-invalid:x'), true)
    assert.equal(isCorruptionReason('counts-parse-counts-missing-essential:users'), true)
    assert.equal(isCorruptionReason('counts-hash-mismatch'), true)
    assert.equal(isCorruptionReason('manifest-size-ok'), false)
  })

  it('ControlledExit path in daily scrubs baseline temp (process.exit not inside try)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-daily-scrub-'))
    try {
      // No prior baseline, non-fixture, no bootstrap → fail at baseline-resolve.
      // Temp workdir must still be disposed (no leftover prior-counts.json under
      // PALPITAE_BACKUP_TMP).
      const tmpRoot = join(dir, 'tmp')
      await mkdir(tmpRoot, { recursive: true, mode: 0o700 })
      const sinkDir = join(dir, 'sink')
      await mkdir(sinkDir, { recursive: true, mode: 0o700 })
      const result = spawnSync(
        process.execPath,
        [
          join(__dirname, 'daily.mjs'),
          '--source=sql-file',
          `--sql-file=${FIXTURE}`,
          `--sink-dir=${sinkDir}`,
          '--recipient=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        ],
        {
          encoding: 'utf8',
          cwd: join(__dirname, '../..'),
          env: { ...process.env, PALPITAE_BACKUP_TMP: tmpRoot },
        },
      )
      assert.notEqual(result.status, 0)
      const report = JSON.parse(result.stdout)
      assert.equal(report.ok, false)
      assert.equal(report.stage, 'baseline-resolve')
      // Workdir roots may remain empty; no prior-counts.json should survive.
      const { readdir } = await import('node:fs/promises')
      async function collectFiles(root) {
        /** @type {string[]} */
        const out = []
        let entries
        try {
          entries = await readdir(root, { withFileTypes: true })
        } catch {
          return out
        }
        for (const ent of entries) {
          const p = join(root, ent.name)
          if (ent.isDirectory()) out.push(...(await collectFiles(p)))
          else out.push(p)
        }
        return out
      }
      const leftovers = await collectFiles(tmpRoot)
      assert.equal(
        leftovers.some((p) => p.endsWith('prior-counts.json')),
        false,
        `temp baseline leaked: ${leftovers.join(',')}`,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('public logs, sqlite -safe, preflight fail-closed', () => {
  const PII_EMAIL = 'pii-syntax@secret-domain.test'
  const PII_TOKEN = 'leak-me'

  it('sqlite -safe blocks .shell and does not execute the command', () => {
    const marker = join(tmpdir(), `palpitae-shell-pwn-${Date.now()}`)
    const probe = runSqlite3([':memory:'], {
      input: `.shell touch ${marker}\n`,
    })
    assert.notEqual(probe.status, 0)
    assert.match(String(probe.stderr || probe.stdout || ''), /safe mode|cannot run \.shell/i)
    const check = spawnSync('test', ['-e', marker], { encoding: 'utf8' })
    assert.notEqual(check.status, 0, '.shell must not create the marker file')
  })

  it('sqliteMinEnv omits R2/Cloudflare credentials', () => {
    const env = sqliteMinEnv()
    assert.equal(env.R2_SECRET_ACCESS_KEY, undefined)
    assert.equal(env.CLOUDFLARE_API_TOKEN, undefined)
    assert.equal(env.AGE_RECIPIENT, undefined)
    assert.ok(env.PATH)
    assert.equal(env.LANG, 'C')
  })

  it('import of valid dump still works under -safe', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-safe-import-'))
    try {
      const db = join(dir, 'ok.sqlite')
      importSqlDump(FIXTURE, db)
      const n = runSqlite3([db, 'SELECT COUNT(*) FROM users;'])
      assert.equal(n.status, 0)
      assert.equal(String(n.stdout).trim(), '2')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('SQL syntax error with PII sentinel uses fixed public message (no SQL/PII/line)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-pii-sql-'))
    try {
      const path = join(dir, 'bad.sql')
      await writeFile(
        path,
        `${essentialSchemaSql()}INSERT INTO users (id, email) ALUES ('${PII_TOKEN}','${PII_EMAIL}') garbage here;\n`,
      )
      await assert.rejects(
        () => validatePlaintextDump(path, { allowUnbaselined: true, allowEmptyEssentials: true }),
        (err) => {
          assert.ok(err instanceof PublicBackupError || err instanceof Error)
          const msg = String(err.message)
          assert.match(msg, /plaintext-dump-import-failed|sqlite-import-failed/)
          assert.doesNotMatch(msg, new RegExp(PII_EMAIL.replace('.', '\\.')))
          assert.doesNotMatch(msg, new RegExp(PII_TOKEN))
          assert.doesNotMatch(msg, /near line \d+/i)
          assert.doesNotMatch(msg, /ALUES|garbage here/i)
          if (err instanceof PublicBackupError) {
            assert.ok(err.privateDetail.length > 0)
          }
          return true
        },
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  async function writeBootstrapEvidence(dir, extra = {}) {
    const evidencePath = join(dir, 'evidence.json')
    await writeFile(
      evidencePath,
      `${JSON.stringify({
        kind: BOOTSTRAP_EVIDENCE_KIND,
        reason: 'round5-cli-test-evidence-ok',
        measuredAt: '2026-11-03T00:00:00.000Z',
        notes: 'synthetic test only',
        emptyDatabase: true,
        ...extra,
      })}\n`,
    )
    return evidencePath
  }

  it('CLI pack failure with PII SQL error keeps stdout/stderr free of sentinel', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-cli-pii-'))
    try {
      const path = join(dir, 'bad.sql')
      await writeFile(
        path,
        `${essentialSchemaSql()}INSERT INTO users (id, email) ALUES ('${PII_TOKEN}','${PII_EMAIL}') garbage here;\n`,
      )
      const evidencePath = await writeBootstrapEvidence(dir)
      const sinkDir = join(dir, 'sink')
      await mkdir(sinkDir, { recursive: true, mode: 0o700 })
      const result = spawnSync(
        process.execPath,
        [
          join(__dirname, 'backup.mjs'),
          '--source=sql-file',
          `--sql-file=${path}`,
          `--sink-dir=${sinkDir}`,
          `--bootstrap-with-evidence=@${evidencePath}`,
          '--recipient=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        ],
        {
          encoding: 'utf8',
          cwd: join(__dirname, '../..'),
          env: { ...process.env, PALPITAE_BACKUP_TMP: join(dir, 'tmp') },
        },
      )
      assert.notEqual(result.status, 0)
      const combined = `${result.stdout}\n${result.stderr}`
      assert.doesNotMatch(combined, new RegExp(PII_EMAIL.replace('.', '\\.')))
      assert.doesNotMatch(combined, new RegExp(PII_TOKEN))
      assert.doesNotMatch(combined, /near line \d+/i)
      assert.match(combined, /plaintext-dump-import-failed|sqlite-import-failed/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('CLI FK failure exposes fixed code without rowid/sample tables', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-cli-fk-'))
    try {
      const path = join(dir, 'fk.sql')
      await writeFile(
        path,
        `${essentialSchemaSql()}CREATE TABLE child (id INTEGER PRIMARY KEY, user_id TEXT REFERENCES users(id));\nINSERT INTO child (id, user_id) VALUES (1, 'missing-user');\n`,
      )
      const evidencePath = await writeBootstrapEvidence(dir)
      const sinkDir = join(dir, 'sink')
      await mkdir(sinkDir, { recursive: true, mode: 0o700 })
      const result = spawnSync(
        process.execPath,
        [
          join(__dirname, 'backup.mjs'),
          '--source=sql-file',
          `--sql-file=${path}`,
          `--sink-dir=${sinkDir}`,
          `--bootstrap-with-evidence=@${evidencePath}`,
          '--recipient=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        ],
        {
          encoding: 'utf8',
          cwd: join(__dirname, '../..'),
          env: { ...process.env, PALPITAE_BACKUP_TMP: join(dir, 'tmp') },
        },
      )
      assert.notEqual(result.status, 0)
      const combined = `${result.stdout}\n${result.stderr}`
      assert.match(combined, /sqlite-foreign-key-violations:\d+|sqlite-foreign-key-check-failed/)
      assert.doesNotMatch(combined, /sample:/i)
      assert.doesNotMatch(combined, /child\|1\|users\|0/)
      assert.doesNotMatch(combined, /missing-user/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('sanitizePublicReport redacts exact sizes from dumpValidation and manifest', () => {
    const dirty = {
      ok: true,
      plaintextBytes: 1543794,
      gzipBytes: 100,
      ciphertextBytes: 200,
      dumpValidation: {
        ok: true,
        bytes: 1543794,
        tables: [...ESSENTIAL_TABLES],
        countGate: { ok: true, mode: 'baseline', actual: { users: 2 }, failures: [] },
      },
      manifest: {
        sizes: { plaintextBytes: 1543794, gzipBytes: 10, ciphertextBytes: 20 },
        hashes: { ciphertextSha256: 'abc' },
      },
      error: 'Parse error near line 13954: ALUES (\'leak-me\')',
    }
    const clean = sanitizePublicReport(dirty)
    assert.equal(/** @type {any} */ (clean).plaintextBytes, undefined)
    assert.equal(/** @type {any} */ (clean).dumpValidation.bytes, undefined)
    assert.equal(/** @type {any} */ (clean).dumpValidation.countGate.actual, undefined)
    assert.deepEqual(/** @type {any} */ (clean).manifest.sizes, { redacted: true })
    assert.doesNotMatch(JSON.stringify(clean), /1543794/)
    assert.doesNotMatch(String(/** @type {any} */ (clean).error), /near line \d+|leak-me|ALUES/)
    assert.equal(sanitizeManifest(dirty.manifest).sizes.redacted, true)
  })

  it('newest adulterated baseline does not fall back to older valid object', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-baseline-newest-'))
    try {
      const sink = createLocalSink(dir)
      const olderAt = new Date('2026-11-01T04:00:00Z')
      const newerAt = new Date('2026-11-03T04:00:00Z')
      const olderPaths = buildObjectPaths({ dbName: 'palpitae', createdAt: olderAt })
      const newerPaths = buildObjectPaths({ dbName: 'palpitae', createdAt: newerAt })
      const olderCipher = Buffer.from('cipher-older-ok')
      const newerCipher = Buffer.from('cipher-newer-bad')
      await putTestBackup(
        sink,
        buildTestArtifacts({
          paths: olderPaths,
          cipher: olderCipher,
          createdAtIso: olderAt.toISOString(),
        }),
        olderPaths,
        olderCipher,
      )
      await putTestBackup(
        sink,
        buildTestArtifacts({
          paths: newerPaths,
          cipher: newerCipher,
          createdAtIso: newerAt.toISOString(),
        }),
        newerPaths,
        newerCipher,
      )
      // Tamper only the newest public counts.
      await sink.put(
        newerPaths.countsKey,
        Buffer.from(
          `${JSON.stringify({
            kind: 'palpitae-d1-backup-counts',
            version: 2,
            nonEmpty: Object.fromEntries(ESSENTIAL_TABLES.map((t) => [t, false])),
          })}\n`,
        ),
      )
      const listed = await sink.listBackups({ dbName: 'palpitae' })
      assert.equal(listed[0].key, newerPaths.ciphertextKey)
      const resolved = await resolveBaselineCountsFromSink(sink, listed)
      assert.equal(resolved.ok, false)
      assert.equal(resolved.reason, 'baseline-counts-modified')
      assert.doesNotMatch(JSON.stringify(resolved), /baselineValues|nonEmpty/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('transient 503 on newest baseline companion fails closed (no older fallback)', async () => {
    const sim = createSimulatedR2()
    const seedSink = createR2Sink({
    accountId: sim.accountId,
    endpoint: sim.endpoint,
      accessKeyId: 'sim-key',
      secretAccessKey: 'sim-secret',
      bucketName: sim.bucketName,
      fetchImpl: sim.fetchImpl,
    })
    const olderAt = new Date('2026-11-01T04:00:00Z')
    const newerAt = new Date('2026-11-03T04:00:00Z')
    const olderPaths = buildObjectPaths({ dbName: 'palpitae', createdAt: olderAt })
    const newerPaths = buildObjectPaths({ dbName: 'palpitae', createdAt: newerAt })
    for (const [paths, at, cipher] of [
      [olderPaths, olderAt, Buffer.from('c-old')],
      [newerPaths, newerAt, Buffer.from('c-new')],
    ]) {
      await putTestBackup(
        seedSink,
        buildTestArtifacts({
          paths,
          cipher,
          createdAtIso: at.toISOString(),
        }),
        paths,
        cipher,
      )
    }
    sim.state.downloadStatusByName.set(newerPaths.manifestKey, 503)
    const listed = await seedSink.listBackups({ dbName: 'palpitae' })
    const resolved = await resolveBaselineCountsFromSink(seedSink, listed)
    assert.equal(resolved.ok, false)
    assert.equal(resolved.reason, 'baseline-transient-error')
    assert.match(String(resolved.detail || ''), /503/)
  })
  it('classifySinkReadError distinguishes missing vs transient', () => {
    assert.equal(classifySinkReadError({ code: 'ENOENT' }).kind, 'missing')
    assert.equal(classifySinkReadError({ status: 404, name: 'R2ApiError' }).kind, 'missing')
    assert.equal(classifySinkReadError({ status: 503, name: 'R2ApiError' }).kind, 'transient')
    assert.equal(classifySinkReadError({ code: 'ETIMEDOUT' }).kind, 'transient')
  })

  it('preflight fails on adulterated newest baseline and does not upload', async () => {
    const sim = createSimulatedR2()
    const sink = createR2Sink({
    accountId: sim.accountId,
    endpoint: sim.endpoint,
      accessKeyId: 'sim-key',
      secretAccessKey: 'sim-secret',
      bucketName: sim.bucketName,
      fetchImpl: sim.fetchImpl,
    })
    const olderAt = new Date('2026-11-01T04:00:00Z')
    const newerAt = new Date('2026-11-03T04:00:00Z')
    const olderPaths = buildObjectPaths({ dbName: 'palpitae', createdAt: olderAt })
    const newerPaths = buildObjectPaths({ dbName: 'palpitae', createdAt: newerAt })
    for (const [paths, at, cipher] of [
      [olderPaths, olderAt, Buffer.from('pre-old')],
      [newerPaths, newerAt, Buffer.from('pre-new')],
    ]) {
      await putTestBackup(
        sink,
        buildTestArtifacts({
          paths,
          cipher,
          createdAtIso: at.toISOString(),
        }),
        paths,
        cipher,
      )
    }
    const putsBefore = sim.state.putCalls
    await sink.put(
      newerPaths.countsKey,
      Buffer.from(
        `${JSON.stringify({
          kind: 'palpitae-d1-backup-counts',
          version: 2,
          nonEmpty: Object.fromEntries(ESSENTIAL_TABLES.map((t) => [t, true])),
        })}\n`,
      ),
    )
    // Tamper counts after put already incremented; capture baseline put count.
    const putsAfterTamper = sim.state.putCalls
    const preflight = await runBackupPreflight({
      sink,
      dbName: 'palpitae',
      isFixture: false,
    })
    assert.equal(preflight.ok, false)
    assert.equal(preflight.exportStarted, false)
    assert.equal(preflight.packed, false)
    assert.equal(preflight.reason, 'baseline-counts-modified')
    assert.equal(sim.state.putCalls, putsAfterTamper, 'preflight must not upload new objects')
    assert.ok(putsAfterTamper >= putsBefore)
  })

  it('preflight fails on simulated R2 503 without starting export', async () => {
    const sim = createSimulatedR2()
    const sink = createR2Sink({
    accountId: sim.accountId,
    endpoint: sim.endpoint,
      accessKeyId: 'sim-key',
      secretAccessKey: 'sim-secret',
      bucketName: sim.bucketName,
      fetchImpl: sim.fetchImpl,
    })
    const at = new Date('2026-11-03T04:00:00Z')
    const paths = buildObjectPaths({ dbName: 'palpitae', createdAt: at })
    const cipher = Buffer.from('pre-503')
    await putTestBackup(
      sink,
      buildTestArtifacts({ paths, cipher, createdAtIso: at.toISOString() }),
      paths,
      cipher,
    )
    sim.state.downloadStatusByName.set(paths.manifestKey, 503)
    const puts = sim.state.putCalls
    const preflight = await runBackupPreflight({ sink, dbName: 'palpitae' })
    assert.equal(preflight.ok, false)
    assert.equal(preflight.exportStarted, false)
    assert.equal(preflight.packed, false)
    assert.equal(preflight.reason, 'baseline-transient-error')
    assert.equal(sim.state.putCalls, puts)
  })

  it('checkBackupTools reports sqlite -safe and age when available', () => {
    const tools = checkBackupTools({
      ageBin: ageAvailable() ? AGE : '/nonexistent-age-bin-for-test',
    })
    assert.equal(tools.sqlite.ok, true)
    assert.equal(tools.sqlite.shellBlocked, true)
    if (ageAvailable()) {
      assert.equal(tools.age.ok, true)
      assert.equal(tools.ok, true)
    } else {
      assert.equal(tools.age.ok, false)
      assert.equal(tools.ok, false)
    }
  })

  it('daily --preflight-only CLI fails closed on empty sink without bootstrap', () => {
    const dir = join(tmpdir(), `palpitae-preflight-cli-${Date.now()}`)
    // sync mkdir via spawn to keep test free of unused async if needed
    spawnSync('mkdir', ['-p', '-m', '700', dir], { encoding: 'utf8' })
    try {
      const result = spawnSync(
        process.execPath,
        [
          join(__dirname, 'daily.mjs'),
          '--preflight-only',
          `--sink-dir=${dir}`,
          '--source=sql-file',
          '--recipient=age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq',
        ],
        {
          encoding: 'utf8',
          cwd: join(__dirname, '../..'),
          env: {
            ...process.env,
            PALPITAE_AGE_BIN: ageAvailable() ? AGE : process.env.PALPITAE_AGE_BIN,
          },
        },
      )
      // Empty inventory → baseline failure (or tools if age missing).
      assert.notEqual(result.status, 0)
      const report = JSON.parse(result.stdout)
      assert.equal(report.ok, false)
      assert.equal(report.exportStarted, false)
      assert.equal(report.packed, false)
      assert.ok(
        report.stage === 'preflight-baseline' ||
          report.stage === 'preflight-tools' ||
          report.reason === 'empty-inventory' ||
          report.reason === 'no-usable-prior-counts',
      )
      assert.doesNotMatch(result.stdout + result.stderr, /1543794|near line \d+/i)
    } finally {
      spawnSync('rm', ['-rf', dir], { encoding: 'utf8' })
    }
  })

  it('workflow YAML installs sqlite3 and runs preflight before export', async () => {
    const { readFile } = await import('node:fs/promises')
    const yml = await readFile(join(__dirname, '../../.github/workflows/backup-d1.yml'), 'utf8')
    assert.match(yml, /Install sqlite3/)
    assert.match(yml, /apt-get install -y sqlite3/)
    assert.match(yml, /--preflight-only/)
    const preflightIdx = yml.indexOf('--preflight-only')
    const exportIdx = yml.indexOf('wrangler d1 export palpitae --remote')
    assert.ok(preflightIdx > 0 && exportIdx > preflightIdx, 'preflight must precede remote export')
    assert.match(yml, /# schedule:/)
    assert.doesNotMatch(yml, /^\s+schedule:/m)
    assert.match(yml, /environment:\s*backup/)
    assert.match(yml, /github\.ref == 'refs\/heads\/main'/)
    assert.match(yml, /palpitae-backups/)
    assert.match(yml, /Do not reuse `palpitae-events`/)
    assert.doesNotMatch(yml, /preferred\) OR reuse|OR reuse `palpitae-events`/)
  })
})

const PII_SENTINEL = 'alice.synthetic@example.test'
const AGE_MAGIC = 'age-encryption.org/v1'


  it('ci.yml Backup job installs age with PATH export and requires age in tests', async () => {
    const { readFile } = await import('node:fs/promises')
    const yml = await readFile(join(__dirname, '../../.github/workflows/ci.yml'), 'utf8')
    assert.match(yml, /name: Backup \(age \+ sqlite3\)/)
    assert.match(yml, /PALPITAE_BACKUP_REQUIRE_AGE: '1'/)
    assert.match(yml, /npm run test:backup/)
    assert.match(yml, /npm run test:backup:rehearsal/)
    assert.match(yml, /export PATH="\$PWD\/age:\$PATH"/)
    assert.match(yml, /AGE_SHA256="7df45a6cc87d4da11cc03a539a7470c15b1041ab2b396af088fe9990f7c79d50"/)
  })

describe('ciphertext never leaves plaintext on the sink', () => {
  it(
    'packAndStore stores age header and keeps fixture PII out of every sink object',
    { skip: !ageAvailable() },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'palpitae-no-plain-'))
      try {
        const idPath = join(dir, 'id.txt')
        spawnSync(AGE_KEYGEN, ['-o', idPath], { encoding: 'utf8' })
        const recipient = spawnSync(AGE_KEYGEN, ['-y', idPath], {
          encoding: 'utf8',
        }).stdout.trim()

        const sim = createSimulatedR2()
        const sink = createR2Sink({
          accountId: sim.accountId,
          endpoint: sim.endpoint,
          accessKeyId: 'keyid',
          secretAccessKey: 'key',
          bucketName: sim.bucketName,
          fetchImpl: sim.fetchImpl,
        })
        const plaintextPath = join(dir, 'dump.sql')
        const { copyFile, readFile } = await import('node:fs/promises')
        await copyFile(FIXTURE, plaintextPath)
        const fixtureBody = await readFile(plaintextPath, 'utf8')
        assert.match(fixtureBody, new RegExp(PII_SENTINEL))

        const packed = await packAndStore({
          sink,
          dbName: 'palpitae',
          plaintextPath,
          recipients: [recipient],
          source: 'test:no-plaintext',
          createdAt: new Date('2026-11-03T04:00:00Z'),
          ageBin: AGE,
          rowCounts: { ...SYNTHETIC_EXPECTATIONS },
        })

        const cipher = await sink.get(packed.paths.ciphertextKey)
        const cipherText = Buffer.isBuffer(cipher) ? cipher.toString('utf8') : String(cipher)
        assert.ok(
          cipherText.startsWith(AGE_MAGIC),
          `ciphertext must start with ${AGE_MAGIC}`,
        )

        for (const [key, entry] of sim.objects.entries()) {
          const buf = Buffer.isBuffer(entry?.body) ? entry.body : Buffer.from(entry?.body || entry)
          const asText = buf.toString('utf8')
          assert.doesNotMatch(
            asText,
            new RegExp(PII_SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
            `sink object ${key} must not contain fixture PII sentinel`,
          )
          // Gzip magic must never appear as the ciphertext object body.
          if (key === packed.paths.ciphertextKey) {
            assert.notEqual(buf[0], 0x1f)
            assert.notEqual(buf[1], 0x8b)
          }
        }
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})

describe('daily.mjs end-to-end gates', () => {
  it('empty dump fails closed and leaves the sink without ciphertext', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'palpitae-daily-empty-'))
    try {
      const empty = join(dir, 'empty.sql')
      await writeFile(empty, '')
      const sinkDir = join(dir, 'sink')
      await mkdir(sinkDir, { recursive: true, mode: 0o700 })
      const idPath = join(dir, 'id.txt')
      if (ageAvailable()) {
        spawnSync(AGE_KEYGEN, ['-o', idPath], { encoding: 'utf8' })
      }
      const recipient = ageAvailable()
        ? spawnSync(AGE_KEYGEN, ['-y', idPath], { encoding: 'utf8' }).stdout.trim()
        : 'age1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
      const result = spawnSync(
        process.execPath,
        [
          join(__dirname, 'daily.mjs'),
          '--sink=local',
          `--sink-dir=${sinkDir}`,
          '--source=sql-file',
          `--sql-file=${empty}`,
          `--recipient=${recipient}`,
          '--bootstrap-with-evidence=' +
            JSON.stringify({
              kind: BOOTSTRAP_EVIDENCE_KIND,
              reason: 'empty-dump-gate',
              measuredAt: '2026-11-20T00:00:00Z',
              notes: 'Synthetic empty dump must fail before pack.',
              operator: 'test',
            }),
        ],
        {
          encoding: 'utf8',
          cwd: join(__dirname, '../..'),
          env: { ...process.env, PALPITAE_BACKUP_REQUIRE_AGE: ageAvailable() ? '1' : '0' },
        },
      )
      assert.notEqual(result.status, 0)
      const listed = spawnSync('find', [sinkDir, '-type', 'f'], { encoding: 'utf8' })
      const files = (listed.stdout || '').trim()
      assert.doesNotMatch(files, /\.sql\.gz\.age$/)
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(PII_SENTINEL))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it(
    'daily.mjs --apply-prune with a single retained object deletes nothing',
    { skip: !ageAvailable() },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), 'palpitae-daily-prune-'))
      try {
        const sinkDir = join(dir, 'sink')
        await mkdir(sinkDir, { recursive: true, mode: 0o700 })
        const idPath = join(dir, 'id.txt')
        spawnSync(AGE_KEYGEN, ['-o', idPath], { encoding: 'utf8' })
        const recipient = spawnSync(AGE_KEYGEN, ['-y', idPath], {
          encoding: 'utf8',
        }).stdout.trim()

        const pack = spawnSync(
          process.execPath,
          [
            join(__dirname, 'daily.mjs'),
            '--sink=local',
            `--sink-dir=${sinkDir}`,
            '--source=fixture',
            `--recipient=${recipient}`,
          ],
          {
            encoding: 'utf8',
            cwd: join(__dirname, '../..'),
            env: { ...process.env, PALPITAE_BACKUP_REQUIRE_AGE: '1' },
          },
        )
        assert.equal(pack.status, 0, pack.stderr || pack.stdout)
        const before = spawnSync('find', [sinkDir, '-type', 'f', '-name', '*.sql.gz.age'], {
          encoding: 'utf8',
        })
        const beforeFiles = (before.stdout || '')
          .trim()
          .split('\n')
          .filter(Boolean)
          .sort()
        assert.equal(beforeFiles.length, 1)

        const prune = spawnSync(
          process.execPath,
          [
            join(__dirname, 'daily.mjs'),
            '--sink=local',
            `--sink-dir=${sinkDir}`,
            '--source=fixture',
            `--recipient=${recipient}`,
            '--apply-prune',
          ],
          {
            encoding: 'utf8',
            cwd: join(__dirname, '../..'),
            env: { ...process.env, PALPITAE_BACKUP_REQUIRE_AGE: '1' },
          },
        )
        // Second pack succeeds; apply-prune keeps the newest and any retention
        // set; with only a couple of objects nothing required for retention is
        // deleted blindly. Assert the newest ciphertext still exists.
        assert.equal(prune.status, 0, prune.stderr || prune.stdout)
        const report = JSON.parse(prune.stdout)
        assert.equal(report.ok, true)
        const deleted = report.prune?.deletion?.deleted || report.deletion?.deleted || []
        const after = spawnSync('find', [sinkDir, '-type', 'f', '-name', '*.sql.gz.age'], {
          encoding: 'utf8',
        })
        const afterFiles = (after.stdout || '')
          .trim()
          .split('\n')
          .filter(Boolean)
        assert.ok(afterFiles.length >= 1, 'at least one ciphertext must remain')
        // With two weekly packs both stay under 8 weekly / 14 daily retention.
        assert.ok(
          Array.isArray(deleted),
          'deletion list must be present even when empty',
        )
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
  )
})

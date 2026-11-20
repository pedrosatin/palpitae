#!/usr/bin/env node
/**
 * End-to-end isolated rehearsal with synthetic data:
 *   - generate ephemeral age keypair under a temp dir outside the repo
 *   - pack fixture → local sink
 *   - restore + verify
 *   - exercise retention selection with several dated objects
 *   - scrub keys and workdirs
 *
 * No Cloudflare R2 live calls, no Backblaze, no production data, no published secrets.
 */

import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  createWorkDir,
  packAndStore,
  resolveAgeBins,
  runCommand,
  scrubFile,
} from './lib/pipeline.mjs'
import { createLocalSink } from './lib/sink-local.mjs'
import { selectRetention, DEFAULT_RETENTION } from './lib/retention.mjs'
import { validatePlaintextDump } from './lib/verify-sqlite.mjs'
import { buildRestoreProofFromRecipients } from './lib/restore-proof.mjs'
import { restoreIsolated } from './restore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, 'fixtures', 'synthetic.sql')
const REPO_ROOT = resolve(__dirname, '../..')

function assertOutsideRepo(path) {
  const abs = resolve(path)
  if (abs === REPO_ROOT || abs.startsWith(REPO_ROOT + '/')) {
    throw new Error(`path must stay outside the repository: ${abs}`)
  }
}

async function generateEphemeralIdentity(workDir, ageKeygen) {
  const identityPath = join(workDir, 'rehearsal-identity.txt')
  await runCommand(ageKeygen, ['-o', identityPath])
  const pub = await runCommand(ageKeygen, ['-y', identityPath])
  const recipient = pub.stdout.toString('utf8').trim()
  if (!recipient.startsWith('age1')) throw new Error('age-keygen -y did not return age1 recipient')
  return { identityPath, recipient }
}

async function main() {
  const bins = resolveAgeBins()
  // Probe age early with a clear error.
  const probe = spawnSync(bins.age, ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    throw new Error(
      `age binary unavailable (${bins.age}). Install age or set PALPITAE_AGE_BIN / PALPITAE_AGE_KEYGEN_BIN.`,
    )
  }

  const home = process.env.HOME || process.env.USERPROFILE
  if (!home && !process.env.PALPITAE_BACKUP_REHEARSAL_ROOT) {
    throw new Error(
      'Set HOME or PALPITAE_BACKUP_REHEARSAL_ROOT to a private directory outside the repo (do not use a world-readable /tmp path for identities).',
    )
  }
  const base =
    process.env.PALPITAE_BACKUP_REHEARSAL_ROOT ||
    join(home, '.cache/scratch/palpitae-backup-rehearsal')
  assertOutsideRepo(base)
  await mkdir(base, { recursive: true, mode: 0o700 })

  const session = await createWorkDir(base)
  const sinkDir = join(session.dir, 'sink')
  await mkdir(sinkDir, { recursive: true, mode: 0o700 })
  const sink = createLocalSink(sinkDir)

  try {
    const { identityPath, recipient } = await generateEphemeralIdentity(session.dir, bins.ageKeygen)
    assertOutsideRepo(identityPath)

    const plaintextPath = join(session.dir, 'synthetic.sql')
    await copyFile(FIXTURE, plaintextPath)
    const dumpValidation = await validatePlaintextDump(plaintextPath, {
      allowUnbaselined: true,
    })

    // Primary backup "today"
    const primary = await packAndStore({
      sink,
      dbName: 'palpitae',
      plaintextPath,
      recipient,
      source: 'fixture:synthetic.sql',
      createdAt: new Date('2026-11-03T04:00:00Z'),
      ageBin: bins.age,
      rowCounts: dumpValidation.rowCounts,
      tablesPresent: dumpValidation.tablesPresent,
    })

    // Additional dated objects to exercise retention (same ciphertext rebuilt
    // with different stamps; content identical and synthetic-only).
    const extraDates = [
      '2026-11-02T04:00:00Z',
      '2026-10-27T04:00:00Z', // prior week
      '2026-10-01T04:00:00Z', // prior month
      '2026-09-01T04:00:00Z',
      '2025-11-03T04:00:00Z', // prior year month
    ]
    for (const iso of extraDates) {
      await packAndStore({
        sink,
        dbName: 'palpitae',
        plaintextPath,
        recipient,
        source: 'fixture:synthetic.sql',
        createdAt: new Date(iso),
        ageBin: bins.age,
        rowCounts: dumpValidation.rowCounts,
        tablesPresent: dumpValidation.tablesPresent,
      })
    }

    const restore = await restoreIsolated({
      sink,
      ciphertextKey: primary.paths.ciphertextKey,
      identityPath,
      ageBin: bins.age,
      expect: 'synthetic',
    })
    const proofExample = buildRestoreProofFromRecipients(
      [recipient],
      'rehearsal-local-ok',
    )
    const listed = await sink.listBackups({ dbName: 'palpitae' })
    const { keep, prune, reasons } = selectRetention(
      listed.map((o) => ({ key: o.key, createdAt: o.createdAt })),
      DEFAULT_RETENTION,
    )

    // Dry-run prune only; do not delete during the rehearsal report.
    const prunePlan = await sink.deleteKeys(
      prune.map((p) => p.key),
      { apply: false },
    )

    await scrubFile(plaintextPath)
    await scrubFile(identityPath)

    const report = {
      ok: restore.ok,
      rehearsal: {
        sinkDir,
        objectCount: listed.length,
        retentionPolicy: DEFAULT_RETENTION,
        keepCount: keep.length,
        pruneCandidateCount: prune.length,
        keepSample: keep.slice(0, 3).map((k) => ({
          key: k.key,
          reasons: reasons.get(k.key),
        })),
        pruneDryRun: prunePlan,
        restoreProofExample: proofExample,
        restoreProofNote:
          'Example format only. Replace the operator token after a real isolated rehearsal; this is not an authenticated cryptographic proof of possession.',
      },
      restore,
      proposedGoals: {
        note: 'Values below are proposals derived from this synthetic local rehearsal only. They are not production SLOs.',
        measuredRestoreDurationMs: restore.durationMs,
        measuredPlaintextBytes: restore.sizes.plaintextBytes,
        measuredCiphertextBytes: restore.sizes.ciphertextBytes,
        suggestedRpoHours: 24,
        suggestedRtoMinutesLocal: Math.max(5, Math.ceil(restore.durationMs / 60000) + 5),
        pendingProductionValidation: [
          'Timed wrangler d1 export --remote of production size (export blocks D1 while running).',
          'Upload/download against a real R2 bucket under the free 10 GB allowance.',
          'Restore into an isolated D1 database (not production) and compare critical aggregates.',
          'Confirm Cloudflare plan Time Travel window (7d free / 30d paid) as complementary, not independent.',
          'Confirm actual R2 storage used after retention (14d+8w+12m object set).',
        ],
      },
      distinctions: {
        d1TimeTravel: 'Cloudflare-native PITR; same account/infrastructure; limited retention window.',
        r2EventsExport: 'Analytics Engine cold path (NDJSON events); not a database backup.',
        thisBackup: 'Independent encrypted SQL dump copy intended for private account storage (R2).',
        failover: 'Out of scope; this process does not provide automatic multi-provider availability.',
      },
    }

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.ok) process.exit(2)
  } finally {
    await session.dispose()
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`)
  process.exit(1)
})

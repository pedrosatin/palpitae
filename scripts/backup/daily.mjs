#!/usr/bin/env node
/**
 * Daily backup orchestration against one sink (local or R2).
 *
 * Order (fail-safe):
 *   1. Resolve baseline from a prior object whose manifest + companions/hashes
 *      validate (no age identity required), or require --bootstrap-with-evidence
 *      / fixture. Modified `.counts.json` (hash mismatch) is refused.
 *   2. Pack + store ciphertext + manifest + sealed meta + public counts
 *   3. List inventory on the SAME sink
 *   4. Classify with hybrid verify: full SHA-256 of the new object only;
 *      lightweight manifest+size for older objects; companions always checked
 *   5. Fail the job if inventory is incomplete, corrupted, or the new object
 *      is not fully hash-validated
 *   6. Plan retention (14/8/12); prune only if pack+verify succeeded
 *
 * Default prune is dry-run. Pass --apply-prune to delete candidates on that
 * sink after a successful pack. Apply on R2 requires R2_PRUNE_* credentials.
 * Apply reclassifies in full mode and fails closed on corruption.
 *
 * Scheduling (cron / Actions) stays disabled in-repo until the operator
 * measures wrangler d1 export --remote blocking, configures secrets, and
 * records a restore proof.
 */

import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_RETENTION, selectRetention } from './lib/retention.mjs'
import { createSink } from './lib/sink.mjs'
import { assertPruneSafeToApply } from './lib/prune-guard.mjs'
import { readR2Env } from './lib/r2-client.mjs'
import {
  assertNewObjectFullyValidated,
  classifyBackupInventory,
  inventoryFingerprint,
  summarizeInventoryHealth,
} from './lib/inventory.mjs'
import {
  PUBLIC_COUNTS_KIND,
  PUBLIC_COUNTS_VERSION,
  resolveBaselineCountsFromSink,
} from './lib/counts-baseline.mjs'
import { createWorkDir, scrubFile } from './lib/pipeline.mjs'
import { runBackupPreflight } from './lib/preflight.mjs'
import {
  maybeWritePrivateError,
  sanitizeErrorMessage,
  sanitizePublicReport,
} from './lib/public-report.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))

function usage(code = 0) {
  process.stdout.write(`Usage: node scripts/backup/daily.mjs [options]

Options:
  --sink=local|r2
  --sink-dir=PATH
  --source=fixture|sql-file|d1-local|d1-remote
  --sql-file=PATH
  --recipient=age1... | --recipients-file=PATH
  --prefix=PREFIX
  --db-name=NAME
  --verify-mode=hybrid|full|manifest-size   (default: hybrid)
  --baseline-counts=JSON|@PATH
  --source-counts=JSON|@PATH
  --bootstrap-with-evidence=JSON|@PATH
  --allow-fixture-to-r2
  --apply-prune              Delete prune candidates after successful pack+verify
  --preflight-only           Check tools + sink baseline/R2; do not pack or export
  --i-understand-remote-export
  --help

Notes:
  --allow-unbaselined-counts is refused here. Use fixture, prior .counts.json
  baseline (auto-resolved from the sink when possible), or bootstrap evidence.
  Workflow must run --preflight-only before wrangler d1 export --remote.
`)
  process.exit(code)
}

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {
    sink: 'local',
    sinkDir: resolve(process.cwd(), '.scratch-local/backup-sink'),
    source: 'fixture',
    dbName: 'palpitae',
    prefix: '',
    applyPrune: false,
    verifyMode: 'hybrid',
    preflightOnly: false,
  }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--apply-prune') out.applyPrune = true
    else if (arg === '--preflight-only') out.preflightOnly = true
    else if (arg === '--i-understand-remote-export') out.remoteOk = true
    else if (arg === '--allow-fixture-to-r2') out.allowFixtureToR2 = true
    else if (arg === '--allow-unbaselined-counts') {
      throw new Error(
        'daily.mjs refuses --allow-unbaselined-counts (permanent bypass). Use --source=fixture, auto/prior --baseline-counts from .counts.json, or --bootstrap-with-evidence',
      )
    } else if (arg.startsWith('--sink=')) out.sink = arg.slice(7)
    else if (arg.startsWith('--sink-dir=')) out.sinkDir = resolve(arg.slice(11))
    else if (arg.startsWith('--source=')) out.source = arg.slice(9)
    else if (arg.startsWith('--sql-file=')) out.sqlFile = arg.slice(11)
    else if (arg.startsWith('--recipient=')) out.recipient = arg.slice(12)
    else if (arg.startsWith('--recipients-file=')) out.recipientsFile = arg.slice(18)
    else if (arg.startsWith('--prefix=')) out.prefix = arg.slice(9)
    else if (arg.startsWith('--db-name=')) out.dbName = arg.slice(10)
    else if (arg.startsWith('--verify-mode=')) out.verifyMode = arg.slice(14)
    else if (arg.startsWith('--baseline-counts=')) out.baselineCounts = arg.slice(18)
    else if (arg.startsWith('--source-counts=')) out.sourceCounts = arg.slice(16)
    else if (arg.startsWith('--bootstrap-with-evidence=')) out.bootstrapEvidence = arg.slice(26)
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (out.sink !== 'local' && out.sink !== 'r2') {
    throw new Error(`unsupported --sink=${out.sink}`)
  }
  if (!['hybrid', 'full', 'manifest-size'].includes(String(out.verifyMode))) {
    throw new Error(`unsupported --verify-mode=${out.verifyMode}`)
  }
  return out
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      cwd: resolve(__dirname, '../..'),
    })
    /** @type {Buffer[]} */
    const stdout = []
    /** @type {Buffer[]} */
    const stderr = []
    child.stdout.on('data', (c) => stdout.push(c))
    child.stderr.on('data', (c) => stderr.push(c))
    child.on('error', reject)
    child.on('close', (code) => {
      const out = Buffer.concat(stdout).toString('utf8')
      const err = Buffer.concat(stderr).toString('utf8')
      if (code !== 0) {
        // Child stderr/stdout may contain dump diagnostics; sanitize before
        // surfacing into the daily report / Actions log.
        const raw = err || out
        reject(
          new Error(
            `${scriptPath} exited ${code}: ${sanitizeErrorMessage(raw)}`,
          ),
        )
        return
      }
      resolvePromise({ stdout: out, stderr: err })
    })
  })
}

function resolvePrefix(args) {
  if (args.prefix) return String(args.prefix)
  if (args.sink === 'r2') return readR2Env().namePrefix || ''
  return ''
}

/**
 * Thrown inside the main try so `finally` can scrub temps before process.exit.
 */
class ControlledExit extends Error {
  /**
   * @param {unknown} report
   * @param {number} code
   */
  constructor(report, code) {
    super('controlled-exit')
    this.name = 'ControlledExit'
    this.report = report
    this.exitCode = code
  }
}

/**
 * Fail closed without skipping finally cleanup.
 * @param {unknown} report
 * @param {number} code
 * @returns {never}
 */
function failClosed(report, code) {
  throw new ControlledExit(report, code)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) usage(0)

  const sinkKind = /** @type {'local'|'r2'} */ (String(args.sink))
  const verifyMode = /** @type {'hybrid'|'full'|'manifest-size'} */ (String(args.verifyMode))
  const isFixture = String(args.source) === 'fixture'

  // Daily pack uses daily credentials (no delete). Prune apply switches below.
  const sink = createSink({
    kind: sinkKind,
    sinkDir: String(args.sinkDir),
    r2: {},
  })

  if (args.preflightOnly) {
    const preflight = await runBackupPreflight({
      sink,
      prefix: resolvePrefix(args),
      dbName: String(args.dbName),
      isFixture,
      bootstrapEvidence: Boolean(args.bootstrapEvidence),
      sourceCounts: Boolean(args.sourceCounts),
      explicitBaseline: Boolean(args.baselineCounts),
    })
    process.stdout.write(`${JSON.stringify(sanitizePublicReport(preflight), null, 2)}\n`)
    if (!preflight.ok) process.exit(1)
    return
  }

  /** @type {{ mode: string, countsKey?: string, ciphertextKey?: string, attempts?: string[], baselineMode?: string } | null} */
  let baselineResolution = null
  let baselineCountsArg = args.baselineCounts ? String(args.baselineCounts) : null
  /** @type {string | null} */
  let baselineTempPath = null
  const work = await createWorkDir()
  /** @type {ControlledExit | null} */
  let controlled = null
  /** @type {number} */
  let successExitCode = 0

  try {
    if (!baselineCountsArg && !args.sourceCounts && !args.bootstrapEvidence && !isFixture) {
      const listedPrior = await sink.listBackups({
        prefix: resolvePrefix(args),
        dbName: String(args.dbName),
      })
      const resolved = await resolveBaselineCountsFromSink(sink, listedPrior)
      if (!resolved.ok) {
        failClosed(
          {
            ok: false,
            stage: 'baseline-resolve',
            error:
              resolved.reason === 'baseline-transient-error'
                ? 'baseline resolve hit a transient sink error; refusing to fall back or pack'
                : resolved.reason === 'baseline-counts-modified'
                  ? 'newest baseline counts were modified; refusing to fall back to an older object or pack'
                  : 'no validated prior baseline (manifest+companions/hashes) and no --bootstrap-with-evidence / --source-counts / --source=fixture',
            detail: {
              reason: resolved.reason,
              attemptCount: Array.isArray(resolved.attempts) ? resolved.attempts.length : 0,
            },
            prune: { skipped: true, reason: 'baseline-missing' },
            packed: false,
          },
          1,
        )
      }
      baselineTempPath = join(work.dir, 'prior-counts.json')
      // Write boolean nonEmpty when available so the pack CLI never sees exact
      // public counts in the temp file either; legacy numeric still works.
      const baselineDoc =
        resolved.mode === 'nonEmpty' ||
        Object.values(resolved.baselineValues || {}).every((v) => typeof v === 'boolean')
          ? {
              version: PUBLIC_COUNTS_VERSION,
              kind: PUBLIC_COUNTS_KIND,
              nonEmpty: resolved.baselineValues,
              tables: resolved.tables || undefined,
            }
          : {
              version: 1,
              kind: PUBLIC_COUNTS_KIND,
              rowCounts: resolved.baselineValues,
              tables: resolved.tables || undefined,
            }
      await writeFile(baselineTempPath, `${JSON.stringify(baselineDoc, null, 2)}\n`, {
        mode: 0o600,
      })
      baselineCountsArg = `@${baselineTempPath}`
      baselineResolution = {
        mode: 'prior-counts-validated',
        countsKey: resolved.countsKey,
        ciphertextKey: resolved.ciphertextKey,
        baselineMode: resolved.mode,
        attempts: resolved.attempts,
      }
    } else if (baselineCountsArg) {
      baselineResolution = { mode: 'explicit-baseline-counts' }
    } else if (args.sourceCounts) {
      baselineResolution = { mode: 'source-counts' }
    } else if (args.bootstrapEvidence) {
      baselineResolution = { mode: 'bootstrap-with-evidence' }
    } else if (isFixture) {
      baselineResolution = { mode: 'fixture-self' }
    }

    const packArgs = [
      `--sink=${args.sink}`,
      `--sink-dir=${args.sinkDir}`,
      `--source=${args.source}`,
      `--db-name=${args.dbName}`,
    ]
    if (args.sqlFile) packArgs.push(`--sql-file=${args.sqlFile}`)
    if (args.recipient) packArgs.push(`--recipient=${args.recipient}`)
    if (args.recipientsFile) packArgs.push(`--recipients-file=${args.recipientsFile}`)
    if (args.prefix) packArgs.push(`--prefix=${args.prefix}`)
    if (args.remoteOk) packArgs.push('--i-understand-remote-export')
    if (baselineCountsArg) packArgs.push(`--baseline-counts=${baselineCountsArg}`)
    if (args.sourceCounts) packArgs.push(`--source-counts=${args.sourceCounts}`)
    if (args.bootstrapEvidence) {
      packArgs.push(`--bootstrap-with-evidence=${args.bootstrapEvidence}`)
    }
    if (args.allowFixtureToR2) packArgs.push('--allow-fixture-to-r2')

    let packResult
    try {
      const pack = await runNodeScript(join(__dirname, 'backup.mjs'), packArgs)
      packResult = JSON.parse(pack.stdout)
      if (!packResult.ok) throw new Error('pack reported not ok')
    } catch (err) {
      failClosed(
        {
          ok: false,
          stage: 'pack',
          baselineResolution,
          error: err instanceof Error ? err.message : String(err),
          prune: { skipped: true, reason: 'pack-failed' },
        },
        1,
      )
    }

    let listed
    let classification
    try {
      listed = await sink.listBackups({
        prefix: resolvePrefix(args),
        dbName: String(args.dbName),
      })
      classification = await classifyBackupInventory(sink, listed, {
        verifyMode,
        mustVerifyKeys: [packResult.ciphertextKey],
      })
    } catch (err) {
      failClosed(
        {
          ok: false,
          stage: 'inventory',
          baselineResolution,
          pack: {
            sink: packResult.sink,
            ciphertextKey: packResult.ciphertextKey,
            manifestKey: packResult.manifestKey,
            sealedMetaKey: packResult.sealedMetaKey,
            countsKey: packResult.countsKey,
          },
          error: err instanceof Error ? err.message : String(err),
          prune: { skipped: true, reason: 'inventory-failed' },
        },
        1,
      )
    }

    const inventoryHealth = summarizeInventoryHealth(classification)
    const newObjectCheck = assertNewObjectFullyValidated(
      classification,
      packResult.ciphertextKey,
    )
    if (inventoryHealth.operationalFailure) {
      failClosed(
        {
          ok: false,
          stage: 'inventory-corruption',
          baselineResolution,
          pack: {
            sink: packResult.sink,
            ciphertextKey: packResult.ciphertextKey,
            manifestKey: packResult.manifestKey,
            sealedMetaKey: packResult.sealedMetaKey,
            countsKey: packResult.countsKey,
          },
          inventoryHealth,
          prune: { skipped: true, reason: 'inventory-corruption' },
          note:
            'Inventory presented corruption or incomplete validation (hash/size/manifest/sidecar/counts). No push alert is wired in-repo; this non-zero exit is the detection signal.',
        },
        1,
      )
    }
    if (!newObjectCheck.ok) {
      failClosed(
        {
          ok: false,
          stage: 'post-pack-verify',
          baselineResolution,
          pack: {
            sink: packResult.sink,
            ciphertextKey: packResult.ciphertextKey,
            manifestKey: packResult.manifestKey,
            sealedMetaKey: packResult.sealedMetaKey,
            countsKey: packResult.countsKey,
          },
          newObjectCheck,
          inventoryHealth,
          validation: {
            verifyMode: classification.verifyMode,
            validatedCount: classification.validated.length,
            unvalidatedCount: classification.unvalidated.length,
            incomplete: classification.incomplete,
            hardErrors: classification.hardErrors,
            egressBytes: classification.egressBytes,
            egressEstimate: classification.egressEstimate,
          },
          prune: { skipped: true, reason: 'post-pack-verify-failed' },
        },
        1,
      )
    }

    const validated = classification.validated.map((o) => ({
      key: o.key,
      createdAt: o.createdAt,
    }))
    const unvalidated = classification.unvalidated.map((o) => ({
      key: o.key,
      createdAt: o.createdAt,
      reason: o.reason,
    }))
    const { keep, prune, reasons } = selectRetention(validated, DEFAULT_RETENTION)

    let inventoryChanged = false
    let deletion = { deleted: [], skipped: [], deferred: true }
    /** @type {{ ok: true } | { ok: false, reason: string }} */
    let safety = { ok: true }

    if (args.applyPrune) {
      const pruneSink =
        sinkKind === 'r2'
          ? createSink({
              kind: 'r2',
              r2: {
                ...readR2Env(process.env, { role: 'prune', allowDailyFallback: false }),
              },
            })
          : sink

      const listedAgain = await pruneSink.listBackups({
        prefix: resolvePrefix(args),
        dbName: String(args.dbName),
      })
      inventoryChanged = inventoryFingerprint(listedAgain) !== classification.fingerprint

      // Apply always reclassifies with full ciphertext hashes (operator-run, rare).
      const reclass = await classifyBackupInventory(pruneSink, listedAgain, {
        verifyMode: 'full',
      })
      const reHealth = summarizeInventoryHealth(reclass)
      if (reclass.incomplete || reHealth.corruptionCount > 0 || reHealth.operationalFailure) {
        failClosed(
          {
            ok: false,
            stage: 'prune-reverify',
            error: 'full reclassification found incomplete validation or corruption before apply',
            hardErrors: reclass.hardErrors,
            inventoryHealth: reHealth,
            egressBytes: reclass.egressBytes,
            prune: { skipped: true, reason: 'prune-reverify-corruption' },
          },
          1,
        )
      }
      const reValidated = reclass.validated.map((o) => ({
        key: o.key,
        createdAt: o.createdAt,
      }))
      const reUnvalidated = reclass.unvalidated.map((o) => ({
        key: o.key,
        createdAt: o.createdAt,
        reason: o.reason,
      }))
      const rePlan = selectRetention(reValidated, DEFAULT_RETENTION)

      try {
        safety = assertPruneSafeToApply({
          keep: rePlan.keep,
          prune: rePlan.prune,
          listed: listedAgain.map((o) => ({ key: o.key, createdAt: o.createdAt })),
          validated: reValidated,
          unvalidated: reUnvalidated,
          incomplete: reclass.incomplete,
          inventoryChanged,
          apply: true,
        })
      } catch (err) {
        failClosed(
          {
            ok: false,
            stage: 'prune-safety',
            error: err instanceof Error ? err.message : String(err),
            pack: {
              ciphertextKey: packResult.ciphertextKey,
              manifestKey: packResult.manifestKey,
            },
            prune: { skipped: true, reason: 'prune-safety-failed' },
          },
          2,
        )
      }

      if (safety.ok) {
        deletion = await pruneSink.deleteKeys(
          rePlan.prune.map((p) => p.key),
          { apply: true },
        )
      }
    } else {
      safety = assertPruneSafeToApply({
        keep,
        prune,
        listed: listed.map((o) => ({ key: o.key, createdAt: o.createdAt })),
        validated,
        unvalidated,
        incomplete: classification.incomplete,
        inventoryChanged: false,
        apply: false,
      })
      deletion = await sink.deleteKeys(
        prune.map((p) => p.key),
        { apply: false },
      )
    }

    const report = {
      ok: true,
      stage: 'complete',
      baselineResolution,
      pack: {
        sink: packResult.sink,
        ciphertextKey: packResult.ciphertextKey,
        manifestKey: packResult.manifestKey,
        sealedMetaKey: packResult.sealedMetaKey,
        countsKey: packResult.countsKey,
        sizes: packResult.manifest?.sizes,
        recipientCount: packResult.recipientCount,
        dumpValidation: packResult.dumpValidation,
      },
      newObjectCheck,
      inventoryHealth,
      retention: {
        policy: DEFAULT_RETENTION,
        keepCount: keep.length,
        pruneCount: prune.length,
        apply: Boolean(args.applyPrune),
        safety,
        validation: {
          verifyMode: classification.verifyMode,
          coverage: inventoryHealth.coverage,
          validatedCount: validated.length,
          unvalidatedCount: unvalidated.length,
          incomplete: classification.incomplete,
          hardErrors: classification.hardErrors,
          preservedUnvalidated: unvalidated,
          egressBytes: classification.egressBytes,
          egressEstimate: classification.egressEstimate,
        },
        keepSample: keep.slice(0, 3).map((k) => ({
          key: k.key,
          reasons: reasons.get(k.key) || [],
        })),
        deletion,
      },
      limits: {
        verifyModeDefault: 'hybrid',
        verifyModeNote:
          'hybrid fully hashes only the new object (+ size-mismatch suspects). Older objects use manifest+listed contentLength — coverage is partial. Companions (sealed meta + counts) are always presence/hash checked. Full mode downloads every ciphertext (coverage complete, higher egress). R2 ETag/contentSha1 are never treated as authentication.',
        countGate:
          'Baseline mode detects catastrophic empty only (boolean nonEmpty or legacy numeric). Partial truncation with non-zero COUNTs is not proven. Prefer --source-counts for exact match. Public .counts.json stores nonEmpty+tables; exact COUNTs stay in sealed meta.',
        publicLogs:
          'CLI stdout/stderr use fixed public error codes for sqlite failures and sanitize COUNTs, SQL fragments, rowids, line numbers, and exact byte sizes so Actions logs stay free of dump content and growth proxies.',
        unsignedManifest:
          'Manifests and .counts.json are unsigned; age provides confidentiality to recipients, not publisher authentication. An actor who can rewrite the bucket can rewrite manifests, counts, and ciphertext together.',
        credentials:
          'R2 Object Read & Write tokens are bucket-scoped and include delete. A compromised CI key can overwrite and delete objects in the dedicated backups bucket; mitigate with R2 bucket lock rules whose retention exceeds prune. Prune apply uses R2_PRUNE_ACCESS_KEY_ID / R2_PRUNE_SECRET_ACCESS_KEY on an operator host.',
        monitoring:
          'Inventory corruption fails the job (non-zero exit). No push/alert integration exists in-repo. Freshness monitoring (newest validated stamp vs RPO) is still pending.',
        schedulingNote:
          'In-repo cron/Actions schedule remains disabled until D1 export blocking is measured, secrets are configured, and a restore proof exists. See docs/operations/backup.md.',
      },
    }

    process.stdout.write(`${JSON.stringify(sanitizePublicReport(report), null, 2)}\n`)
    if (args.applyPrune && !safety.ok) successExitCode = 2
  } catch (err) {
    if (err instanceof ControlledExit) {
      controlled = err
    } else {
      throw err
    }
  } finally {
    if (baselineTempPath) await scrubFile(baselineTempPath)
    await work.dispose()
  }

  if (controlled) {
    process.stdout.write(`${JSON.stringify(sanitizePublicReport(controlled.report), null, 2)}\n`)
    process.exit(controlled.exitCode)
  }
  if (successExitCode !== 0) process.exit(successExitCode)
}

main().catch((err) => {
  if (err instanceof ControlledExit) {
    process.stdout.write(`${JSON.stringify(sanitizePublicReport(err.report), null, 2)}\n`)
    process.exit(err.exitCode)
  }
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${sanitizeErrorMessage(msg)}\n`)
  maybeWritePrivateError(err)
  process.exit(1)
})

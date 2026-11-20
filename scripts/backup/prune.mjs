#!/usr/bin/env node
/**
 * Apply retention to a backup sink (local or R2).
 *
 * Default mode is dry-run. Pass --apply to delete. Deletion is limited to
 * objects whose keys match the ciphertext naming convention AND that passed
 * manifest+hash validation. Unvalidated copies are preserved. Safety gates
 * refuse --apply when validation is incomplete, the newest validated backup
 * would be removed, the keep set is empty, only one validated backup exists,
 * or the inventory changed concurrently between plan and apply.
 *
 * Dry-run may use hybrid verification (low egress). --apply always full-hashes
 * every ciphertext before deleting. R2 --apply requires R2_PRUNE_ACCESS_KEY_ID /
 * R2_PRUNE_SECRET_ACCESS_KEY (object-delete), separate from daily CI keys.
 *
 * Prune always lists and deletes on the selected --sink. A local prune does
 * not delete R2 objects (and vice versa). Do not use recursive sync --delete.
 */

import { resolve } from 'node:path'
import { DEFAULT_RETENTION, selectRetention } from './lib/retention.mjs'
import { createSink } from './lib/sink.mjs'
import { assertPruneSafeToApply } from './lib/prune-guard.mjs'
import { readR2Env } from './lib/r2-client.mjs'
import {
  classifyBackupInventory,
  inventoryFingerprint,
  summarizeInventoryHealth,
} from './lib/inventory.mjs'

function usage(code = 0) {
  process.stdout.write(`Usage: node scripts/backup/prune.mjs [options]

Options:
  --sink=local|r2           (default: local)
  --sink-dir=PATH           Local root (when --sink=local)
  --db-name=NAME              (default: palpitae)
  --prefix=PREFIX
  --daily=N --weekly=N --monthly=N
  --verify-mode=hybrid|full|manifest-size
                            Default: hybrid for dry-run, full when --apply
  --apply                     Actually delete prune candidates (default: dry-run)
  --help

R2 dry-run env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET [, R2_ACCOUNT_ID, R2_NAME_PREFIX]
R2 --apply env: R2_PRUNE_ACCESS_KEY_ID, R2_PRUNE_SECRET_ACCESS_KEY (object-delete), same bucket/prefix
`)
  process.exit(code)
}

function parseArgs(argv) {
  /** @type {Record<string, string | boolean | number>} */
  const out = {
    sink: 'local',
    sinkDir: resolve(process.cwd(), '.scratch-local/backup-sink'),
    dbName: 'palpitae',
    prefix: '',
    daily: DEFAULT_RETENTION.daily,
    weekly: DEFAULT_RETENTION.weekly,
    monthly: DEFAULT_RETENTION.monthly,
    apply: false,
  }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--apply') out.apply = true
    else if (arg.startsWith('--sink=')) out.sink = arg.slice(7)
    else if (arg.startsWith('--sink-dir=')) out.sinkDir = resolve(arg.slice(11))
    else if (arg.startsWith('--db-name=')) out.dbName = arg.slice(10)
    else if (arg.startsWith('--prefix=')) out.prefix = arg.slice(9)
    else if (arg.startsWith('--daily=')) out.daily = Number(arg.slice(8))
    else if (arg.startsWith('--weekly=')) out.weekly = Number(arg.slice(9))
    else if (arg.startsWith('--monthly=')) out.monthly = Number(arg.slice(10))
    else if (arg.startsWith('--verify-mode=')) out.verifyMode = arg.slice(14)
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (out.sink !== 'local' && out.sink !== 'r2') {
    throw new Error(`unsupported --sink=${out.sink}`)
  }
  for (const k of ['daily', 'weekly', 'monthly']) {
    if (!Number.isInteger(out[k]) || out[k] < 0) {
      throw new Error(`invalid --${k}`)
    }
  }
  if (out.verifyMode && !['hybrid', 'full', 'manifest-size'].includes(String(out.verifyMode))) {
    throw new Error(`unsupported --verify-mode=${out.verifyMode}`)
  }
  return out
}

function resolvePrefix(args) {
  if (args.prefix) return String(args.prefix)
  if (args.sink === 'r2') return readR2Env().namePrefix || ''
  return ''
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) usage(0)

  const sinkKind = /** @type {'local'|'r2'} */ (String(args.sink))
  const verifyMode = /** @type {'hybrid'|'full'|'manifest-size'} */ (
    args.verifyMode || (args.apply ? 'full' : 'hybrid')
  )

  const sink =
    sinkKind === 'r2' && args.apply
      ? createSink({
          kind: 'r2',
          r2: {
            ...readR2Env(process.env, { role: 'prune', allowDailyFallback: false }),
          },
        })
      : createSink({
          kind: sinkKind,
          sinkDir: String(args.sinkDir),
          r2: {},
        })

  const listed = await sink.listBackups({
    prefix: resolvePrefix(args),
    dbName: String(args.dbName),
  })
  const classification = await classifyBackupInventory(sink, listed, { verifyMode })
  const inventoryHealth = summarizeInventoryHealth(classification)
  const validated = classification.validated.map((o) => ({
    key: o.key,
    createdAt: o.createdAt,
  }))
  const unvalidated = classification.unvalidated.map((o) => ({
    key: o.key,
    createdAt: o.createdAt,
    reason: o.reason,
  }))

  // Full / apply paths must fail closed on corruption rather than quietly
  // preserving bad objects while reporting ok:true.
  if (
    (args.apply || verifyMode === 'full') &&
    (classification.incomplete || inventoryHealth.corruptionCount > 0)
  ) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: false,
          apply: Boolean(args.apply),
          sink: sinkKind,
          error: 'inventory corruption or incomplete validation under full/apply verify',
          inventoryHealth,
          validation: {
            verifyMode: classification.verifyMode,
            validatedCount: validated.length,
            unvalidatedCount: unvalidated.length,
            incomplete: classification.incomplete,
            hardErrors: classification.hardErrors,
            fingerprint: classification.fingerprint,
            preservedUnvalidated: unvalidated,
            egressBytes: classification.egressBytes,
            egressEstimate: classification.egressEstimate,
          },
        },
        null,
        2,
      )}\n`,
    )
    process.exit(1)
  }

  const { keep, prune, reasons } = selectRetention(validated, {
    daily: Number(args.daily),
    weekly: Number(args.weekly),
    monthly: Number(args.monthly),
  })

  let inventoryChanged = false
  if (args.apply) {
    const listedAgain = await sink.listBackups({
      prefix: resolvePrefix(args),
      dbName: String(args.dbName),
    })
    inventoryChanged = inventoryFingerprint(listedAgain) !== classification.fingerprint
  }

  const safety = assertPruneSafeToApply({
    keep,
    prune,
    listed: listed.map((o) => ({ key: o.key, createdAt: o.createdAt })),
    validated,
    unvalidated,
    incomplete: classification.incomplete,
    inventoryChanged,
    apply: Boolean(args.apply),
  })

  let deletion = { deleted: [], skipped: [], deferred: true }
  if (safety.ok) {
    deletion = await sink.deleteKeys(
      prune.map((p) => p.key),
      { apply: Boolean(args.apply) },
    )
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: safety.ok,
        apply: Boolean(args.apply),
        sink: sinkKind,
        safety,
        inventoryHealth,
        validation: {
          verifyMode: classification.verifyMode,
          validatedCount: validated.length,
          unvalidatedCount: unvalidated.length,
          incomplete: classification.incomplete,
          hardErrors: classification.hardErrors,
          fingerprint: classification.fingerprint,
          preservedUnvalidated: unvalidated,
          egressBytes: classification.egressBytes,
          egressEstimate: classification.egressEstimate,
        },
        policy: {
          daily: args.daily,
          weekly: args.weekly,
          monthly: args.monthly,
        },
        keep: keep.map((k) => ({
          key: k.key,
          createdAt: k.createdAt.toISOString(),
          reasons: reasons.get(k.key) || [],
        })),
        prune: prune.map((p) => ({
          key: p.key,
          createdAt: p.createdAt.toISOString(),
        })),
        deletion,
        limits: {
          r2ApplyCredentials: 'R2_PRUNE_ACCESS_KEY_ID / R2_PRUNE_SECRET_ACCESS_KEY required for --apply on R2',
          unsignedManifest:
            'Manifests are unsigned; age encrypts to recipients without publisher authentication.',
          etagNotAuth:
            'R2 ETag/ETag are never treated as end-to-end authentication of backup bytes.',
        },
      },
      null,
      2,
    )}\n`,
  )

  if (!safety.ok && args.apply) process.exit(2)
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`)
  process.exit(1)
})

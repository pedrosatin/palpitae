/**
 * Preflight checks that must pass BEFORE wrangler d1 export --remote.
 * Fail closed: never start a blocking remote export when tools, baseline, or
 * R2 config are not ready.
 */
import { spawnSync } from 'node:child_process'
import { resolveAgeBins } from './pipeline.mjs'
import { runSqlite3 } from './verify-sqlite.mjs'
import { resolveBaselineCountsFromSink } from './counts-baseline.mjs'

/**
 * Confirm sqlite3 supports `-safe` and age is runnable.
 * @param {{ ageBin?: string, ageKeygenBin?: string }} [opts]
 */
export function checkBackupTools(opts = {}) {
  /** @type {string[]} */
  const errors = []
  /** @type {Record<string, unknown>} */
  const sqlite = { ok: false }
  /** @type {Record<string, unknown>} */
  const age = { ok: false }

  const probe = runSqlite3([':memory:', 'select 1;'])
  if (probe.error) {
    errors.push('sqlite3-unavailable')
    sqlite.error = 'spawn-failed'
  } else if (probe.status !== 0) {
    errors.push('sqlite3-safe-probe-failed')
    sqlite.error = 'safe-probe-failed'
  } else if (String(probe.stdout || '').trim() !== '1') {
    errors.push('sqlite3-safe-probe-unexpected')
    sqlite.error = 'unexpected-output'
  } else {
    sqlite.ok = true
    const ver = spawnSync('sqlite3', ['-version'], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
    })
    sqlite.version = String(ver.stdout || '')
      .trim()
      .split(/\s+/)[0]
  }

  // .shell must be rejected under -safe (hardening probe; must not execute).
  const shellProbe = runSqlite3([':memory:'], { input: '.shell echo PWNED-SHOULD-NOT-RUN\n' })
  if (shellProbe.status === 0 && /PWNED-SHOULD-NOT-RUN/.test(String(shellProbe.stdout || ''))) {
    errors.push('sqlite3-safe-allows-shell')
    sqlite.shellBlocked = false
  } else {
    sqlite.shellBlocked = true
  }

  const bins = resolveAgeBins()
  const ageBin = opts.ageBin || bins.age
  const ageVer = spawnSync(ageBin, ['--version'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
  })
  if (ageVer.error || ageVer.status !== 0) {
    errors.push('age-unavailable')
    age.error = 'unavailable'
  } else {
    age.ok = true
    age.version = String(ageVer.stdout || ageVer.stderr || '').trim()
    age.bin = ageBin
  }

  return {
    ok: errors.length === 0,
    errors,
    sqlite,
    age,
  }
}

/**
 * Verify sink list + baseline resolution without packing or exporting.
 * For R2 this exercises authorize + list (+ baseline companion reads).
 *
 * @param {{
 *   sink: any,
 *   prefix?: string,
 *   dbName: string,
 *   requireBaseline?: boolean,
 *   bootstrapEvidence?: boolean,
 *   sourceCounts?: boolean,
 *   explicitBaseline?: boolean,
 *   isFixture?: boolean,
 * }} opts
 */
export async function preflightSinkAndBaseline(opts) {
  const requireBaseline = opts.requireBaseline !== false
  const listed = await opts.sink.listBackups({
    prefix: opts.prefix || '',
    dbName: opts.dbName,
  })

  const inventory = {
    objectCount: listed.length,
  }

  if (
    opts.isFixture ||
    opts.bootstrapEvidence ||
    opts.sourceCounts ||
    opts.explicitBaseline
  ) {
    return {
      ok: true,
      stage: 'preflight',
      inventory,
      baseline: {
        mode: opts.isFixture
          ? 'fixture-self'
          : opts.bootstrapEvidence
            ? 'bootstrap-with-evidence'
            : opts.sourceCounts
              ? 'source-counts'
              : 'explicit-baseline-counts',
        skippedResolve: true,
      },
    }
  }

  if (!requireBaseline) {
    return { ok: true, stage: 'preflight', inventory, baseline: { mode: 'not-required' } }
  }

  const resolved = await resolveBaselineCountsFromSink(opts.sink, listed)
  if (!resolved.ok) {
    return {
      ok: false,
      stage: 'preflight-baseline',
      inventory,
      error: 'preflight-baseline-failed',
      reason: resolved.reason,
      detail: resolved.detail,
      attemptCount: Array.isArray(resolved.attempts) ? resolved.attempts.length : 0,
      // Do not echo attempt key strings that might include operational paths beyond reason codes
      attempts: resolved.attempts,
    }
  }

  return {
    ok: true,
    stage: 'preflight',
    inventory,
    baseline: {
      mode: 'prior-counts-validated',
      baselineMode: resolved.mode,
      ciphertextKey: resolved.ciphertextKey,
      countsKey: resolved.countsKey,
      attemptCount: Array.isArray(resolved.attempts) ? resolved.attempts.length : 0,
    },
  }
}

/**
 * Full preflight: tools + sink/baseline. Never exports D1 and never packs.
 * @param {{
 *   sink: any,
 *   prefix?: string,
 *   dbName: string,
 *   ageBin?: string,
 *   requireBaseline?: boolean,
 *   bootstrapEvidence?: boolean,
 *   sourceCounts?: boolean,
 *   explicitBaseline?: boolean,
 *   isFixture?: boolean,
 * }} opts
 */
export async function runBackupPreflight(opts) {
  const tools = checkBackupTools({ ageBin: opts.ageBin })
  if (!tools.ok) {
    return {
      ok: false,
      stage: 'preflight-tools',
      error: 'preflight-tools-failed',
      tools,
      exportStarted: false,
      packed: false,
    }
  }

  let sinkResult
  try {
    sinkResult = await preflightSinkAndBaseline(opts)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Avoid leaking raw R2 bodies; keep a fixed code when status is present.
    const status =
      err && typeof err === 'object' && typeof /** @type {any} */ (err).status === 'number'
        ? /** @type {any} */ (err).status
        : undefined
    return {
      ok: false,
      stage: 'preflight-sink',
      error: status != null && status >= 500 ? 'preflight-sink-transient-error' : 'preflight-sink-failed',
      detail: status != null ? `status=${status}` : msg.slice(0, 200),
      tools,
      exportStarted: false,
      packed: false,
    }
  }

  if (!sinkResult.ok) {
    return {
      ...sinkResult,
      tools,
      exportStarted: false,
      packed: false,
    }
  }

  return {
    ok: true,
    stage: 'preflight',
    tools: {
      sqlite: { ok: true, version: tools.sqlite.version, shellBlocked: tools.sqlite.shellBlocked },
      age: { ok: true, version: tools.age.version },
    },
    inventory: sinkResult.inventory,
    baseline: sinkResult.baseline,
    exportStarted: false,
    packed: false,
  }
}

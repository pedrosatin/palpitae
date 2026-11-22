#!/usr/bin/env node
/**
 * Isolated restore CLI: download ciphertext (+ manifest + sealed meta) from a
 * local or R2 sink, decrypt with an operator identity outside the repo, import
 * into temporary SQLite, and compare sealed row counts.
 *
 * Never targets production D1. Real remote restores stay a manual operator
 * decision; tests use a simulated R2 client (injected fetch) only.
 */

import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyManifestAgainstCiphertext, sha256File } from './lib/integrity.mjs'
import { companionKeys } from './lib/naming.mjs'
import {
  ageDecryptFile,
  createWorkDir,
  gunzipFile,
  resolveAgeBins,
  scrubFile,
} from './lib/pipeline.mjs'
import { createLocalSink } from './lib/sink-local.mjs'
import { createR2Sink } from './lib/sink-r2.mjs'
import { parseSealedMeta, compareRowCounts } from './lib/sealed-meta.mjs'
import {
  SYNTHETIC_EXPECTATIONS,
  assertSqliteIntegrity,
  countEssentialRows,
  importSqlDump,
  verifyRowCounts,
  verifySyntheticSpotChecks,
  listMissingTables,
} from './lib/verify-sqlite.mjs'


const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

function usage(code = 0) {
  process.stdout.write(`Usage: node scripts/backup/restore.mjs [options]

Options:
  --sink=local|r2
  --sink-dir=PATH           Local object root (sink=local)
  --ciphertext-key=KEY      Object key of the .sql.gz.age file
  --identity=PATH           age identity file (private; outside the repo)
  --expect=synthetic|sealed|none   (default: sealed)
  --report=PATH             Write JSON report
  --help

R2 env (read): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET [, R2_NAME_PREFIX]
`)
  process.exit(code)
}

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {
    sink: 'local',
    sinkDir: resolve(process.cwd(), '.scratch-local/backup-sink'),
    expect: 'sealed',
  }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg.startsWith('--sink=')) out.sink = arg.slice(7)
    else if (arg.startsWith('--sink-dir=')) out.sinkDir = resolve(arg.slice(11))
    else if (arg.startsWith('--ciphertext-key=')) out.ciphertextKey = arg.slice(17)
    else if (arg.startsWith('--identity=')) out.identity = resolve(arg.slice(11))
    else if (arg.startsWith('--expect=')) out.expect = arg.slice(9)
    else if (arg.startsWith('--report=')) out.report = resolve(arg.slice(9))
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (out.sink !== 'local' && out.sink !== 'r2') {
    throw new Error(`unsupported --sink=${out.sink}`)
  }
  return out
}

function assertIdentityOutsideRepo(identityPath) {
  const abs = resolve(identityPath)
  if (abs === REPO_ROOT || abs.startsWith(REPO_ROOT + '/')) {
    throw new Error(
      `refusing identity inside the repository (${abs}). Keep the private key outside the checkout.`,
    )
  }
}

/**
 * @param {{
 *   sink: any,
 *   ciphertextKey: string,
 *   identityPath: string,
 *   expect: string,
 *   ageBin?: string,
 * }} opts
 */
export async function restoreIsolated(opts) {
  const started = Date.now()
  const bins = resolveAgeBins()
  const ageBin = opts.ageBin || bins.age
  const cipherKey = opts.ciphertextKey
  const { manifestKey, sealedMetaKey } = companionKeys(cipherKey)

  const work = await createWorkDir()
  try {
    const agePath = join(work.dir, 'dump.sql.gz.age')
    const gzPath = join(work.dir, 'dump.sql.gz')
    const sqlPath = join(work.dir, 'dump.sql')
    const dbPath = join(work.dir, 'restored.sqlite')
    const manifestPath = join(work.dir, 'manifest.json')
    const sealedAgePath = join(work.dir, 'meta.json.age')
    const sealedPlainPath = join(work.dir, 'meta.json')

    if (typeof opts.sink.pathFor === 'function' && opts.sink.kind === 'local') {
      await copyFile(await opts.sink.pathFor(cipherKey), agePath)
      await copyFile(await opts.sink.pathFor(manifestKey), manifestPath)
      await copyFile(await opts.sink.pathFor(sealedMetaKey), sealedAgePath)
    } else if (typeof opts.sink.downloadTo === 'function') {
      await opts.sink.downloadTo(cipherKey, agePath)
      await opts.sink.downloadTo(manifestKey, manifestPath)
      await opts.sink.downloadTo(sealedMetaKey, sealedAgePath)
    } else {
      const cipherBuf = await opts.sink.get(cipherKey)
      const manifestBuf = await opts.sink.get(manifestKey)
      const sealedBuf = await opts.sink.get(sealedMetaKey)
      await writeFile(agePath, cipherBuf, { mode: 0o600 })
      await writeFile(manifestPath, manifestBuf, { mode: 0o600 })
      await writeFile(sealedAgePath, sealedBuf, { mode: 0o600 })
    }
    await chmod(agePath, 0o600)

    const manifest = await verifyManifestAgainstCiphertext(manifestPath, agePath)
    if (manifest.rowCounts !== undefined) {
      throw new Error('refusing restore: public manifest still exposes cleartext rowCounts')
    }
    if (typeof manifest.hashes?.sealedMetaSha256 !== 'string') {
      throw new Error('refusing restore: manifest missing sealedMetaSha256 (incomplete artifact set)')
    }

    const sealedAgeSha = await sha256File(sealedAgePath)
    if (sealedAgeSha.toLowerCase() !== String(manifest.hashes.sealedMetaSha256).toLowerCase()) {
      throw new Error(
        `sealed meta sha256 mismatch vs manifest: expected ${manifest.hashes.sealedMetaSha256}, got ${sealedAgeSha}`,
      )
    }

    // Public counts companion is required for a complete restore set even when
    // --expect=none (CLI restore must not paper over a missing baseline artifact).
    const { countsKey } = companionKeys(cipherKey)
    const countsPath = join(work.dir, 'counts.json')
    if (typeof opts.sink.pathFor === 'function' && opts.sink.kind === 'local') {
      await copyFile(await opts.sink.pathFor(countsKey), countsPath)
    } else if (typeof opts.sink.downloadTo === 'function') {
      await opts.sink.downloadTo(countsKey, countsPath)
    } else {
      const countsBuf = await opts.sink.get(countsKey)
      await writeFile(countsPath, countsBuf, { mode: 0o600 })
    }
    if (typeof manifest.hashes.countsSha256 === 'string') {
      const countsSha = await sha256File(countsPath)
      if (countsSha.toLowerCase() !== String(manifest.hashes.countsSha256).toLowerCase()) {
        throw new Error(
          `counts.json sha256 mismatch vs manifest: expected ${manifest.hashes.countsSha256}, got ${countsSha}`,
        )
      }
    }

    await ageDecryptFile({
      ageBin,
      inputPath: agePath,
      outputPath: gzPath,
      identityPath: opts.identityPath,
    })
    await gunzipFile(gzPath, sqlPath)
    await chmod(sqlPath, 0o600)

    const plaintextSha = await sha256File(sqlPath)
    if (plaintextSha !== manifest.hashes.plaintextSha256) {
      throw new Error(
        `plaintext sha256 mismatch after decrypt: expected ${manifest.hashes.plaintextSha256}, got ${plaintextSha}`,
      )
    }

    await ageDecryptFile({
      ageBin,
      inputPath: sealedAgePath,
      outputPath: sealedPlainPath,
      identityPath: opts.identityPath,
    })
    const sealedRaw = await import('node:fs/promises').then((fs) =>
      fs.readFile(sealedPlainPath, 'utf8'),
    )
    const sealedParsed = parseSealedMeta(sealedRaw)
    if (!sealedParsed.ok) {
      throw new Error(`sealed meta invalid: ${sealedParsed.reason}`)
    }
    const sealedMeta = sealedParsed.meta
    if (sealedMeta.plaintextSha256 !== plaintextSha) {
      throw new Error(
        `sealed meta plaintextSha256 mismatch: sealed=${sealedMeta.plaintextSha256}, actual=${plaintextSha}`,
      )
    }

    importSqlDump(sqlPath, dbPath)
    const missing = listMissingTables(dbPath)
    if (missing.length > 0) {
      throw new Error(`restored DB missing essential tables: ${missing.join(', ')}`)
    }
    const sqliteIntegrity = assertSqliteIntegrity(dbPath)
    const actualCounts = countEssentialRows(dbPath)
    const sealedCompare = compareRowCounts(actualCounts, sealedMeta.rowCounts)

    /** @type {{ ok: boolean, actual?: Record<string, number>, failures: string[] }} */
    let counts = { ok: true, failures: [], actual: actualCounts }
    /** @type {{ ok: boolean, failures: string[] }} */
    let spots = { ok: true, failures: [] }

    if (opts.expect === 'synthetic') {
      counts = verifyRowCounts(dbPath, SYNTHETIC_EXPECTATIONS)
      spots = verifySyntheticSpotChecks(dbPath)
    } else if (opts.expect === 'sealed') {
      counts = {
        ok: sealedCompare.ok,
        actual: actualCounts,
        failures: sealedCompare.failures,
      }
    } else if (opts.expect !== 'none') {
      throw new Error(`unknown --expect=${opts.expect}`)
    }

    const durationMs = Date.now() - started
    const report = {
      ok: counts.ok && spots.ok && sealedCompare.ok && sqliteIntegrity.ok,
      durationMs,
      sink: opts.sink.kind || 'unknown',
      recoveryPoint: {
        stamp: manifest.stamp,
        createdAt: manifest.createdAt,
        source: manifest.source,
      },
      sizes: manifest.sizes,
      sqliteIntegrity,
      sealedMeta: {
        key: sealedMetaKey,
        rowCounts: sealedMeta.rowCounts,
        compare: sealedCompare,
        consistencyLimits: sealedMeta.consistencyLimits,
      },
      counts,
      spots,
      note:
        'Isolated SQLite restore only. Production D1 was not contacted. Sealed rowCounts compared after age decrypt of .meta.json.age. integrity_check + foreign_key_check required.',
    }

    await scrubFile(sqlPath)
    await scrubFile(gzPath)
    await scrubFile(agePath)
    await scrubFile(dbPath)
    await scrubFile(manifestPath)
    await scrubFile(sealedAgePath)
    await scrubFile(sealedPlainPath)
    await scrubFile(countsPath)

    return report
  } finally {
    await work.dispose()
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) usage(0)
  if (!args.ciphertextKey) throw new Error('--ciphertext-key is required')
  if (!args.identity) throw new Error('--identity is required')
  assertIdentityOutsideRepo(String(args.identity))

  /** @type {any} */
  let sink
  if (args.sink === 'local') {
    await mkdir(String(args.sinkDir), { recursive: true, mode: 0o700 })
    sink = createLocalSink(String(args.sinkDir))
  } else {
    sink = createR2Sink({})
  }

  const report = await restoreIsolated({
    sink,
    ciphertextKey: String(args.ciphertextKey),
    identityPath: String(args.identity),
    expect: String(args.expect),
  })

  if (args.report) {
    await writeFile(String(args.report), `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    })
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ok) process.exit(2)
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`${err.stack || err.message}\n`)
    process.exit(1)
  })
}

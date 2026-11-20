#!/usr/bin/env node
/**
 * Create an encrypted D1 backup object and store it in a sink.
 *
 * Sinks:
 *   --sink=local (default)  filesystem layout under --sink-dir
 *   --sink=r2               Cloudflare R2 S3 API (credentials from env)
 *
 * This script never reads Cloudflare production by default. Sources:
 *   --source=fixture     (synthetic SQL in fixtures/)
 *   --source=sql-file    (--sql-file=path)
 *   --source=d1-local    (wrangler d1 export --local; needs api/ cwd tooling)
 *   --source=d1-remote   (wrangler d1 export --remote; REQUIRES operator auth;
 *                         refused unless --i-understand-remote-export is set)
 *
 * Before encrypting, the plaintext dump is imported into an isolated SQLite
 * file, checked with integrity_check + foreign_key_check, and gated on
 * essential counts vs baseline/source evidence.
 *
 * R2 credentials (never committed): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
 * (optional R2_ACCOUNT_ID, R2_NAME_PREFIX). Daily keys should NOT include
 * object-delete. Prune apply uses R2_PRUNE_* separately.
 *
 * Workdirs default to ~/.cache/scratch/palpitae-backup-tmp (not /tmp) to avoid
 * filling a tmpfs with dumps. Override with PALPITAE_BACKUP_TMP.
 */

import { copyFile, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { packAndStore, resolveAgeBins, createWorkDir, scrubFile } from './lib/pipeline.mjs'
import { createSink } from './lib/sink.mjs'
import { readR2Env } from './lib/r2-client.mjs'
import { resolveRecipients } from './lib/recipients.mjs'
import { validatePlaintextDump } from './lib/verify-sqlite.mjs'
import {
  loadBootstrapEvidence,
  loadCountsArg,
  loadSourceCountsArg,
  parseCountsDocument,
} from './lib/counts-baseline.mjs'
import {
  maybeWritePrivateError,
  resolveCliPath,
  sanitizeErrorMessage,
  sanitizePublicReport,
} from './lib/public-report.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE = join(__dirname, 'fixtures', 'synthetic.sql')

function usage(code = 0) {
  const text = `Usage: node scripts/backup/backup.mjs [options]

Options:
  --db-name=NAME          D1 database name (default: palpitae)
  --source=fixture|sql-file|d1-local|d1-remote
  --sql-file=PATH         Required when --source=sql-file
  --recipient=age1...     Age public recipient(s), comma-separated
  --recipients-file=PATH  File with one or more age1 recipients (public only)
  --sink=local|r2         Destination store (default: local)
  --sink-dir=PATH         Local object root (default: .scratch-local/backup-sink)
  --prefix=PREFIX         Key prefix inside the sink (default: empty / R2_NAME_PREFIX)
  --created-at=ISO        Override timestamp (tests)
  --baseline-counts=JSON|@PATH
                          Prior essential counts (plain map, .counts.json, or decrypted sealed meta)
  --source-counts=JSON|@PATH
                          Live source DB essential-table counts (exact match gate)
  --bootstrap-with-evidence=JSON|@PATH
                          First real pack without prior baseline (requires evidence file)
  --allow-unbaselined-counts
                          Deprecated alias for fixture/bootstrap; prefer --source=fixture
                          or --bootstrap-with-evidence. Refused for non-fixture without bootstrap.
  --allow-fixture-to-r2   Required together with --source=fixture --sink=r2 (tests /
                          disposable prefix only). Never use against the production prefix.
  --i-understand-remote-export
                          Required together with --source=d1-remote
  --help

R2 env (daily): R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET [, R2_ACCOUNT_ID, R2_NAME_PREFIX]
Prune apply uses R2_PRUNE_ACCESS_KEY_ID / R2_PRUNE_SECRET_ACCESS_KEY separately.

Notes:
  --skip-dump-validate was removed as an unsafe bypass. Tests must validate dumps.
`
  process.stdout.write(text)
  process.exit(code)
}

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {
    dbName: 'palpitae',
    source: 'fixture',
    sink: 'local',
    sinkDir: resolve(process.cwd(), '.scratch-local/backup-sink'),
    prefix: '',
  }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--i-understand-remote-export') out.remoteOk = true
    else if (arg === '--skip-dump-validate') {
      throw new Error(
        '--skip-dump-validate was removed: refusing to seal backups without dump validation (integrity_check, foreign_key_check, count gate)',
      )
    } else if (arg === '--allow-unbaselined-counts') out.allowUnbaselined = true
    else if (arg === '--allow-fixture-to-r2') out.allowFixtureToR2 = true
    else if (arg.startsWith('--db-name=')) out.dbName = arg.slice(10)
    else if (arg.startsWith('--source=')) out.source = arg.slice(9)
    else if (arg.startsWith('--sql-file=')) out.sqlFile = arg.slice(11)
    else if (arg.startsWith('--recipient=')) out.recipient = arg.slice(12)
    else if (arg.startsWith('--recipients-file=')) out.recipientsFile = arg.slice(18)
    else if (arg.startsWith('--sink=')) out.sink = arg.slice(7)
    else if (arg.startsWith('--sink-dir=')) out.sinkDir = resolve(arg.slice(11))
    else if (arg.startsWith('--prefix=')) out.prefix = arg.slice(9)
    else if (arg.startsWith('--created-at=')) out.createdAt = arg.slice(13)
    else if (arg.startsWith('--baseline-counts=')) out.baselineCounts = arg.slice(18)
    else if (arg.startsWith('--source-counts=')) out.sourceCounts = arg.slice(16)
    else if (arg.startsWith('--bootstrap-with-evidence=')) out.bootstrapEvidence = arg.slice(26)
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (out.sink !== 'local' && out.sink !== 'r2') {
    throw new Error(`unsupported --sink=${out.sink} (expected local|r2)`)
  }
  return out
}

/**
 * @param {Record<string, string | boolean>} args
 * @param {string} workDir
 */
async function materializePlaintext(args, workDir) {
  const dest = join(workDir, 'dump.sql')
  const source = String(args.source)
  if (source === 'fixture') {
    await copyFile(FIXTURE, dest)
    return { path: dest, label: 'fixture:synthetic.sql' }
  }
  if (source === 'sql-file') {
    if (!args.sqlFile) throw new Error('--sql-file is required for source=sql-file')
    await copyFile(resolve(String(args.sqlFile)), dest)
    return { path: dest, label: `sql-file:${args.sqlFile}` }
  }
  if (source === 'd1-local' || source === 'd1-remote') {
    if (source === 'd1-remote' && !args.remoteOk) {
      throw new Error(
        'refusing d1-remote export without --i-understand-remote-export (blocks production D1 while running)',
      )
    }
    const remoteFlag = source === 'd1-remote' ? '--remote' : '--local'
    const wrangler = spawnSync(
      'npx',
      [
        'wrangler',
        'd1',
        'export',
        String(args.dbName),
        remoteFlag,
        `--output=${dest}`,
        '--config',
        './wrangler.toml',
      ],
      {
        cwd: resolve(process.cwd(), 'api'),
        encoding: 'utf8',
        env: process.env,
      },
    )
    if (wrangler.status !== 0) {
      throw new Error(`wrangler d1 export failed: ${wrangler.stderr || wrangler.stdout}`)
    }
    return { path: dest, label: `wrangler:${source}` }
  }
  throw new Error(`unsupported --source=${source}`)
}

function resolvePrefix(args) {
  if (args.prefix) return String(args.prefix)
  if (args.sink === 'r2') {
    const env = readR2Env()
    return env.namePrefix || ''
  }
  return ''
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) usage(0)

  const recipients = await resolveRecipients(args)
  const bins = resolveAgeBins()
  const work = await createWorkDir()
  try {
    const { path: plaintextPath, label } = await materializePlaintext(args, work.dir)

    const baselineRowCounts = args.baselineCounts
      ? await loadCountsArg(String(args.baselineCounts))
      : null
    const sourceRowCounts = args.sourceCounts
      ? await loadSourceCountsArg(String(args.sourceCounts))
      : null
    /** @type {string[] | null} */
    let expectedTables = null
    if (args.baselineCounts) {
      // Prefer schema list from a public counts document when provided as @path.
      const raw = String(args.baselineCounts)
      if (raw.startsWith('@')) {
        const parsed = parseCountsDocument(await readFile(resolveCliPath(raw.slice(1)), 'utf8'))
        if (parsed.ok && parsed.tables && parsed.tables.length > 0) {
          expectedTables = parsed.tables
        }
      }
    }

    /** @type {Awaited<ReturnType<typeof loadBootstrapEvidence>> | null} */
    let bootstrap = null
    if (args.bootstrapEvidence) {
      bootstrap = await loadBootstrapEvidence(String(args.bootstrapEvidence))
    }

    const isFixture = String(args.source) === 'fixture'
    if (args.allowUnbaselined && !isFixture && !bootstrap) {
      throw new Error(
        '--allow-unbaselined-counts is refused for non-fixture packs without --bootstrap-with-evidence (fail closed)',
      )
    }

    const allowUnbaselined = isFixture || Boolean(bootstrap) || Boolean(args.allowUnbaselined && isFixture)
    const allowEmptyEssentials = Boolean(
      (baselineRowCounts &&
        Object.values(baselineRowCounts).every((n) => n === false || n === 0)) ||
        bootstrap?.emptyDatabase,
    )

    if (!baselineRowCounts && !sourceRowCounts && !allowUnbaselined) {
      throw new Error(
        'refusing pack without count evidence: pass --baseline-counts (prior .counts.json), --source-counts, --bootstrap-with-evidence, or --source=fixture',
      )
    }

    const dumpValidation = await validatePlaintextDump(plaintextPath, {
      baselineRowCounts,
      sourceRowCounts,
      expectedTables,
      allowUnbaselined,
      allowEmptyEssentials,
    })
    const rowCounts = dumpValidation.rowCounts

    const sinkKind = /** @type {'local'|'r2'} */ (String(args.sink))
    if (sinkKind === 'r2' && isFixture && !args.allowFixtureToR2) {
      throw new Error(
        'refusing --source=fixture with --sink=r2 without --allow-fixture-to-r2: synthetic dumps must never land on the production backup prefix',
      )
    }

    const sink = createSink({
      kind: sinkKind,
      sinkDir: String(args.sinkDir),
      r2: {},
    })
    const createdAt = args.createdAt ? new Date(String(args.createdAt)) : new Date()
    if (Number.isNaN(createdAt.getTime())) throw new Error(`invalid --created-at: ${args.createdAt}`)

    const result = await packAndStore({
      sink,
      dbName: String(args.dbName),
      plaintextPath,
      recipients,
      source: label,
      prefix: resolvePrefix(args),
      createdAt,
      ageBin: bins.age,
      rowCounts,
      tablesPresent: dumpValidation.tablesPresent,
    })

    await scrubFile(plaintextPath)

    process.stdout.write(
      `${JSON.stringify(
        sanitizePublicReport({
          ok: true,
          sink: sinkKind,
          sinkDir: sinkKind === 'local' ? String(args.sinkDir) : undefined,
          ciphertextKey: result.paths.ciphertextKey,
          manifestKey: result.paths.manifestKey,
          sealedMetaKey: result.paths.sealedMetaKey,
          countsKey: result.paths.countsKey,
          recipientCount: recipients.length,
          dumpValidation,
          bootstrap,
          manifest: result.manifest,
          publicCounts: result.publicCounts,
        }),
        null,
        2,
      )}\n`,
    )
  } finally {
    await work.dispose()
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err)
  process.stderr.write(`${sanitizeErrorMessage(msg)}\n`)
  maybeWritePrivateError(err)
  process.exit(1)
})

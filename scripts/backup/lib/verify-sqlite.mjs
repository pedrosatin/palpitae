import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Public-safe backup error. `message` is safe for Actions logs.
 * Optional `privateDetail` stays off public reports unless an operator sets
 * PALPITAE_BACKUP_PRIVATE_ERRORS=1 on a private host.
 */
export class PublicBackupError extends Error {
  /**
   * @param {string} publicMessage
   * @param {string} [privateDetail]
   */
  constructor(publicMessage, privateDetail) {
    super(publicMessage)
    this.name = 'PublicBackupError'
    this.publicMessage = publicMessage
    this.privateDetail = privateDetail || ''
  }
}

/**
 * Minimal env for sqlite3 children. Omits R2/Cloudflare/age secrets and the
 * rest of process.env so a malicious dump `.shell` (without -safe) cannot
 * inherit credentials. PATH is kept so `sqlite3` resolves.
 */
export function sqliteMinEnv() {
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    PATH: process.env.PATH || '/usr/bin:/bin',
    LANG: 'C',
    LC_ALL: 'C',
  }
  if (process.env.HOME) env.HOME = process.env.HOME
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR
  return env
}

/**
 * Spawn sqlite3 with `-safe` (blocks .shell/.system/.once) and a minimal env.
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptionsWithStringEncoding} [opts]
 */
export function runSqlite3(args, opts = {}) {
  const { env: extraEnv, ...rest } = opts
  return spawnSync('sqlite3', ['-safe', ...args], {
    encoding: 'utf8',
    ...rest,
    // Never inherit full process.env (R2/Cloudflare secrets). Callers may add
    // non-secret overrides only.
    env: extraEnv ? { ...sqliteMinEnv(), ...extraEnv } : sqliteMinEnv(),
  })
}

/**
 * Private workdir for pre-encrypt validation only.
 * Kept local so this module does not import pipeline.mjs (avoids cycles).
 * Prefers ~/.cache/scratch over /tmp (tmpfs).
 * @param {string} [base]
 */
async function createPrivateWorkDir(base) {
  const root =
    base ||
    (process.env.PALPITAE_BACKUP_TMP
      ? join(process.env.PALPITAE_BACKUP_TMP, 'validate')
      : process.env.HOME || homedir()
        ? join(process.env.HOME || homedir(), '.cache/scratch/palpitae-backup-tmp/validate')
        : join(tmpdir(), 'palpitae-backup-validate'))
  await mkdir(root, { recursive: true, mode: 0o700 })
  const dir = await mkdtemp(join(root, 'validate-'))
  await chmod(dir, 0o700)
  return {
    dir,
    async dispose() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/** @param {string} path */
async function scrubFile(path) {
  try {
    const data = await readFile(path)
    await writeFile(path, Buffer.alloc(data.length, 0))
  } catch {
    // ignore missing
  }
  await rm(path, { force: true })
}

/** Expected row counts for fixtures/synthetic.sql */
export const SYNTHETIC_EXPECTATIONS = Object.freeze({
  users: 2,
  competitions: 1,
  teams: 2,
  matches: 2,
  groups: 1,
  predictions: 3,
})

/**
 * Tables that must exist in a Palpitae D1 dump before we encrypt it.
 * Presence only — production row counts are not assumed.
 */
export const ESSENTIAL_TABLES = Object.freeze([
  'users',
  'competitions',
  'teams',
  'matches',
  'groups',
  'predictions',
])

/** Reject tiny/empty dumps before spending encrypt/upload work. */
export const MIN_PLAINTEXT_BYTES = 64

/**
 * Evidence modes for the pre-encrypt count gate.
 * A legally empty table is valid when the evidence says it should be empty.
 */
export const COUNT_GATE_MODES = Object.freeze({
  /** Fixture / explicit opt-in: dump counts are recorded; no external baseline. */
  self: 'self',
  /** Compare dump counts to a previous sealed baseline. */
  baseline: 'baseline',
  /** Compare dump counts to live source DB counts. */
  source: 'source',
})

/**
 * @param {string} dbPath
 * @param {string} sql
 * @returns {string}
 */
export function sqliteQuery(dbPath, sql) {
  const result = runSqlite3([dbPath, sql])
  if (result.error) throw result.error
  if (result.status !== 0) {
    const privateDetail = String(result.stderr || result.stdout || '').slice(0, 2000)
    throw new PublicBackupError('sqlite-query-failed', privateDetail)
  }
  return (result.stdout || '').trim()
}

/**
 * Apply a SQL dump into a fresh sqlite file via stdin.
 * Uses `sqlite3 -safe` so dump lines like `.shell` are rejected, not executed.
 * @param {string} sqlPath
 * @param {string} dbPath
 */
export function importSqlDump(sqlPath, dbPath) {
  const sql = readFileSync(sqlPath, 'utf8')
  const apply = runSqlite3([dbPath], { input: sql })
  if (apply.error) throw apply.error
  if (apply.status !== 0) {
    const privateDetail = String(apply.stderr || apply.stdout || '').slice(0, 4000)
    throw new PublicBackupError('sqlite-import-failed', privateDetail)
  }
}

/**
 * @param {string} dbPath
 * @param {readonly string[]} [tables]
 * @returns {Record<string, number>}
 */
export function countEssentialRows(dbPath, tables = ESSENTIAL_TABLES) {
  /** @type {Record<string, number>} */
  const actual = {}
  for (const table of tables) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) {
      throw new Error(`refusing unsafe table name for row count: ${table}`)
    }
    const raw = sqliteQuery(dbPath, `SELECT COUNT(*) FROM "${table}";`)
    const count = Number(raw)
    if (!Number.isFinite(count) || count < 0) {
      throw new Error(`invalid COUNT(*) for ${table}: ${raw}`)
    }
    actual[table] = count
  }
  return actual
}

/**
 * @param {string} dbPath
 * @param {Record<string, number>} expectations
 */
export function verifyRowCounts(dbPath, expectations) {
  /** @type {Record<string, number>} */
  const actual = {}
  /** @type {string[]} */
  const failures = []
  for (const [table, expected] of Object.entries(expectations)) {
    const raw = sqliteQuery(dbPath, `SELECT COUNT(*) FROM ${table};`)
    const count = Number(raw)
    actual[table] = count
    if (count !== expected) {
      failures.push(`${table}: expected ${expected}, got ${count}`)
    }
  }
  return { ok: failures.length === 0, actual, failures }
}

/**
 * Structural checks on the SQL text before/after import.
 * A dump cut on a statement boundary can still import cleanly while omitting
 * most of the data — schema presence alone is not enough.
 *
 * @param {string} sqlText
 */
export function inspectSqlDumpText(sqlText) {
  const trimmed = sqlText.replace(/\uFEFF/g, '').trimEnd()
  const hasCreate = /CREATE\s+TABLE/i.test(sqlText)
  const hasInsert = /INSERT\s+INTO/i.test(sqlText)
  const endsCleanly = /;\s*$/.test(trimmed) || trimmed.length === 0
  /** @type {string[]} */
  const issues = []
  if (!endsCleanly) {
    issues.push('sql-does-not-end-on-statement-boundary')
  }
  // Trailing incomplete token after the last semicolon (rare but cheap).
  const afterLastSemi = trimmed.includes(';') ? trimmed.slice(trimmed.lastIndexOf(';') + 1).trim() : trimmed
  if (afterLastSemi.length > 0 && !/^(PRAGMA|BEGIN|COMMIT|END)\b/i.test(afterLastSemi)) {
    // Already covered by endsCleanly when no trailing ';'.
  }
  return {
    hasCreate,
    hasInsert,
    endsCleanly,
    schemaOnly: hasCreate && !hasInsert,
    issues,
  }
}

/**
 * Whether a baseline value indicates the table previously had rows.
 * Accepts numeric counts (legacy v1) or boolean nonEmpty (v2).
 * @param {unknown} prev
 */
export function baselineWasNonEmpty(prev) {
  if (typeof prev === 'boolean') return prev
  if (typeof prev === 'number' && Number.isFinite(prev)) return prev > 0
  return false
}

/**
 * Whether baseline evidence is present for a table.
 * @param {unknown} prev
 */
export function baselineValuePresent(prev) {
  if (typeof prev === 'boolean') return true
  return typeof prev === 'number' && Number.isFinite(prev)
}

/**
 * Prudent data-loss gate (honest about what COUNTs can prove).
 *
 * - Never treats a legally empty table as invalid by itself when evidence says
 *   it should be empty.
 * - With `source` evidence: dump counts must match the source exactly.
 * - With `baseline` evidence: refuse catastrophic drops only (prior non-empty
 *   and dump count === 0 for an essential table). Baseline may be numeric
 *   (legacy) or boolean `nonEmpty`. Partial truncation that leaves non-zero
 *   counts is **not** detected and must not be claimed as detected.
 * - Without source or baseline: fail closed unless `allowUnbaselined` (fixture
 *   or bootstrap-with-evidence). Insufficient evidence must not become "ok".
 * - Self/bootstrap with all essential counts at zero is refused unless
 *   `allowEmptyEssentials` (explicit empty baseline / bootstrap emptyDatabase).
 *
 * Consistency limits: essential-table COUNTs after isolated import do not prove
 * transactional consistency across tables, partial truncation inside a
 * statement-complete dump, or live-DB equality at a later instant. SQLite
 * integrity_check / foreign_key_check are separate gates.
 *
 * Failure strings intentionally omit exact COUNTs so public CI logs stay clean.
 *
 * @param {{
 *   actual: Record<string, number>,
 *   baseline?: Record<string, number | boolean> | null,
 *   source?: Record<string, number> | null,
 *   allowUnbaselined?: boolean,
 *   allowEmptyEssentials?: boolean,
 *   schemaOnly?: boolean,
 *   tables?: readonly string[],
 * }} opts
 */
export function assertCountGate(opts) {
  const tables = opts.tables ?? ESSENTIAL_TABLES
  const actual = opts.actual
  const baseline = opts.baseline || null
  const source = opts.source || null
  /** @type {string[]} */
  const failures = []

  for (const table of tables) {
    if (!Object.prototype.hasOwnProperty.call(actual, table) || !Number.isFinite(actual[table])) {
      failures.push(`${table}: missing actual count`)
    }
  }

  if (source) {
    for (const table of tables) {
      const want = source[table]
      const got = actual[table]
      if (!Number.isFinite(want)) {
        failures.push(`${table}: source evidence missing`)
        continue
      }
      if (got !== want) {
        failures.push(`${table}: dump count does not match source count`)
      }
    }
    return {
      ok: failures.length === 0,
      mode: COUNT_GATE_MODES.source,
      failures,
      actual,
      evidence: { source: true, baseline: Boolean(baseline) },
      limits:
        'Exact match vs source-counts only. Does not add publisher authenticity.',
    }
  }

  if (baseline) {
    for (const table of tables) {
      const prev = baseline[table]
      const got = actual[table]
      if (!baselineValuePresent(prev)) {
        failures.push(`${table}: baseline evidence missing`)
        continue
      }
      // Catastrophic loss only — do not invent % thresholds that pretend to
      // detect partial truncation inside a statement-complete dump.
      if (baselineWasNonEmpty(prev) && got === 0) {
        failures.push(
          `${table}: catastrophic drop vs baseline (table was non-empty, dump empty); refusing to encrypt`,
        )
      }
    }
    if (opts.schemaOnly) {
      const baselineHadRows = tables.some((t) => baselineWasNonEmpty(baseline[t]))
      if (baselineHadRows) {
        failures.push(
          'schema-only dump while baseline has rows; refusing to encrypt (likely truncated or empty export)',
        )
      }
    }
    return {
      ok: failures.length === 0,
      mode: COUNT_GATE_MODES.baseline,
      failures,
      actual,
      evidence: { source: false, baseline: true },
      limits:
        'Catastrophic-empty vs baseline only (numeric or boolean nonEmpty). Partial row loss with non-zero COUNTs is not detected; use --source-counts for exact match.',
    }
  }

  if (!opts.allowUnbaselined) {
    failures.push(
      'insufficient count evidence: provide --baseline-counts / prior .counts.json, --source-counts, --bootstrap-with-evidence (first real pack), or --source=fixture',
    )
    if (opts.schemaOnly) {
      failures.push(
        'schema-only dump with no baseline/source evidence; empty tables are legal only when evidence says so',
      )
    }
    return {
      ok: false,
      mode: 'insufficient',
      failures,
      actual,
      evidence: { source: false, baseline: false },
    }
  }

  // Self-evidencing path (fixture / bootstrap-with-evidence).
  if (opts.schemaOnly) {
    failures.push(
      'schema-only dump refused without an explicit empty baseline; pass baseline counts of 0 if the source DB is truly empty',
    )
  }

  const essentialTotal = tables.reduce((sum, t) => sum + (actual[t] || 0), 0)
  if (essentialTotal === 0 && !opts.allowEmptyEssentials) {
    failures.push(
      'all essential table counts are 0 without empty-database evidence; refusing self/bootstrap pack (pass an explicit empty baseline or bootstrap emptyDatabase:true)',
    )
  }

  return {
    ok: failures.length === 0,
    mode: COUNT_GATE_MODES.self,
    failures,
    actual,
    evidence: {
      source: false,
      baseline: false,
      allowUnbaselined: true,
      allowEmptyEssentials: Boolean(opts.allowEmptyEssentials),
    },
    limits:
      'Self/bootstrap records dump counts only. No prior reference comparison. Partial truncation is not detected.',
  }
}

/**
 * Schema-compatible SQLite integrity gates after isolated import.
 *
 * - `PRAGMA integrity_check` must return exactly `ok`.
 * - `PRAGMA foreign_keys=ON` then `PRAGMA foreign_key_check` must return no
 *   rows. D1 dumps often set `foreign_keys=OFF` during load; we still evaluate
 *   constraints after the import finishes. Schemas without FK definitions pass
 *   with an empty check (compatible).
 *
 * @param {string} dbPath
 */
export function assertSqliteIntegrity(dbPath) {
  let integrity
  try {
    integrity = sqliteQuery(dbPath, 'PRAGMA integrity_check;')
  } catch (err) {
    if (err instanceof PublicBackupError) {
      throw new PublicBackupError('sqlite-integrity-check-failed', err.privateDetail)
    }
    throw err
  }
  if (integrity !== 'ok') {
    throw new PublicBackupError('sqlite-integrity-check-failed', integrity.slice(0, 500))
  }

  // Enable FK enforcement for the check connection, then list violations.
  const fkOn = runSqlite3([dbPath, 'PRAGMA foreign_keys=ON;', 'PRAGMA foreign_key_check;'])
  if (fkOn.error) throw fkOn.error
  if (fkOn.status !== 0) {
    throw new PublicBackupError(
      'sqlite-foreign-key-check-failed',
      String(fkOn.stderr || fkOn.stdout || '').slice(0, 2000),
    )
  }
  const violations = (fkOn.stdout || '').trim()
  if (violations.length > 0) {
    const lines = violations.split(/\n/).filter(Boolean)
    // Public: count only. Private: table/rowid samples (never for Actions).
    throw new PublicBackupError(
      `sqlite-foreign-key-violations:${lines.length}`,
      lines.slice(0, 20).join('\n'),
    )
  }

  return { ok: true, integrityCheck: 'ok', foreignKeyViolations: 0 }
}

/**
 * Spot-check a known synthetic prediction value.
 * @param {string} dbPath
 */
export function verifySyntheticSpotChecks(dbPath) {
  const score = sqliteQuery(
    dbPath,
    "SELECT home_score || '-' || away_score FROM matches WHERE id = 'match_syn_1';",
  )
  const invite = sqliteQuery(dbPath, "SELECT invite_code FROM groups WHERE id = 'group_syn_1';")
  const failures = []
  if (score !== '2-1') failures.push(`match_syn_1 score expected 2-1, got ${score}`)
  if (invite !== 'SYNCODE1') failures.push(`invite_code expected SYNCODE1, got ${invite}`)
  return { ok: failures.length === 0, failures, score, invite }
}

/**
 * @param {string} dbPath
 * @param {readonly string[]} tables
 */
export function listMissingTables(dbPath, tables = ESSENTIAL_TABLES) {
  const missing = []
  for (const table of tables) {
    // Quote identifiers safely: essential names are fixed ASCII identifiers.
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) {
      throw new Error(`refusing unsafe table name for schema check: ${table}`)
    }
    const raw = sqliteQuery(
      dbPath,
      `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='${table}';`,
    )
    if (Number(raw) < 1) missing.push(table)
  }
  return missing
}

/**
 * List user tables present after import (excludes sqlite_* internals).
 * @param {string} dbPath
 * @returns {string[]}
 */
export function listPresentTables(dbPath) {
  const raw = sqliteQuery(
    dbPath,
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
  )
  if (!raw) return []
  return raw
    .split(/\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Detect table loss vs an expected / prior-complete schema.
 * Does **not** claim to detect all truncation — only missing table names.
 *
 * @param {readonly string[]} present
 * @param {readonly string[]} expected
 */
export function assertExpectedTablesPresent(present, expected) {
  const have = new Set(present)
  const missing = expected.filter((t) => {
    if (!/^[a-z_][a-z0-9_]*$/i.test(t)) {
      throw new Error(`refusing unsafe table name for schema check: ${t}`)
    }
    return !have.has(t)
  })
  return {
    ok: missing.length === 0,
    missing,
    present: [...present],
    expected: [...expected],
    limits:
      'Detects missing CREATE TABLE names vs expected/baseline schema only. Does not detect all truncation (truncated INSERTs, partial row loss, or reordered dumps that still create every expected table).',
  }
}

/**
 * Fail-closed pre-encrypt gate: empty/garbage/truncated/schema-only dumps must
 * not become "valid" ciphertext without evidence. Imports into an isolated
 * SQLite file, checks essential schema, records row counts, applies the count
 * gate, then scrubs temp artifacts.
 *
 * A legally empty table is valid when baseline/source evidence says so.
 * Without evidence the gate fails closed (unless allowUnbaselined for fixture /
 * first-backup opt-in).
 *
 * @param {string} sqlPath
 * @param {{
 *   minBytes?: number,
 *   essentialTables?: readonly string[],
 *   expectedTables?: readonly string[] | null,
 *   workDir?: string,
 *   baselineRowCounts?: Record<string, number | boolean> | null,
 *   sourceRowCounts?: Record<string, number> | null,
 *   allowUnbaselined?: boolean,
 *   allowEmptyEssentials?: boolean,
 * }} [opts]
 * @returns {Promise<{
 *   ok: true,
 *   bytes: number,
 *   tables: string[],
 *   tablesPresent: string[],
 *   rowCounts: Record<string, number>,
 *   completeness: ReturnType<typeof inspectSqlDumpText>,
 *   countGate: ReturnType<typeof assertCountGate>,
 *   schemaCheck: ReturnType<typeof assertExpectedTablesPresent> | null,
 *   sqliteIntegrity: ReturnType<typeof assertSqliteIntegrity>,
 * }>}
 */
export async function validatePlaintextDump(sqlPath, opts = {}) {
  const minBytes = opts.minBytes ?? MIN_PLAINTEXT_BYTES
  const essentialTables = opts.essentialTables ?? ESSENTIAL_TABLES

  let st
  try {
    st = statSync(sqlPath)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`plaintext dump unreadable: ${msg}`)
  }
  if (!st.isFile()) {
    throw new Error(`plaintext dump is not a regular file: ${sqlPath}`)
  }
  if (st.size <= 0) {
    throw new PublicBackupError('plaintext-dump-empty')
  }
  if (st.size < minBytes) {
    throw new PublicBackupError(
      'plaintext-dump-too-small',
      `size=${st.size} min=${minBytes}`,
    )
  }

  const sqlText = readFileSync(sqlPath, { encoding: 'utf8', flag: 'r' })
  const head = sqlText.slice(0, 4096)
  if (!/CREATE\s+TABLE/i.test(head) && !/INSERT\s+INTO/i.test(head)) {
    throw new Error(
      'plaintext dump does not look like SQL (no CREATE TABLE / INSERT INTO in the first 4 KiB); refusing to encrypt',
    )
  }

  const completeness = inspectSqlDumpText(sqlText)
  if (!completeness.endsCleanly) {
    throw new Error(
      'plaintext dump does not end on a SQL statement boundary (likely truncated); refusing to encrypt',
    )
  }

  const owned = opts.workDir ? null : await createPrivateWorkDir()
  const workDir = opts.workDir || owned.dir
  const dbPath = join(workDir, 'pre-encrypt-validate.sqlite')

  try {
    try {
      importSqlDump(sqlPath, dbPath)
    } catch (err) {
      if (err instanceof PublicBackupError) {
        throw new PublicBackupError('plaintext-dump-import-failed', err.privateDetail)
      }
      const msg = err instanceof Error ? err.message : String(err)
      throw new PublicBackupError('plaintext-dump-import-failed', msg)
    }

    const missing = listMissingTables(dbPath, essentialTables)
    if (missing.length > 0) {
      throw new Error(
        `plaintext dump missing essential tables after import: ${missing.join(', ')}`,
      )
    }

    const tablesPresent = listPresentTables(dbPath)
    /** @type {ReturnType<typeof assertExpectedTablesPresent> | null} */
    let schemaCheck = null
    const expectedTables = opts.expectedTables
    if (expectedTables && expectedTables.length > 0) {
      schemaCheck = assertExpectedTablesPresent(tablesPresent, expectedTables)
      if (!schemaCheck.ok) {
        throw new Error(
          `plaintext dump missing tables vs expected/baseline schema: ${schemaCheck.missing.join(', ')} (detects table loss only; not all truncation)`,
        )
      }
    }

    const sqliteIntegrity = assertSqliteIntegrity(dbPath)

    const rowCounts = countEssentialRows(dbPath, essentialTables)
    const countGate = assertCountGate({
      actual: rowCounts,
      baseline: opts.baselineRowCounts ?? null,
      source: opts.sourceRowCounts ?? null,
      allowUnbaselined: Boolean(opts.allowUnbaselined),
      allowEmptyEssentials: Boolean(opts.allowEmptyEssentials),
      schemaOnly: completeness.schemaOnly,
      tables: essentialTables,
    })
    if (!countGate.ok) {
      throw new Error(
        `plaintext dump failed count gate (${countGate.mode}): ${countGate.failures.join('; ')}`,
      )
    }

    return {
      ok: true,
      bytes: st.size,
      tables: [...essentialTables],
      tablesPresent,
      rowCounts,
      completeness,
      countGate,
      schemaCheck,
      sqliteIntegrity,
    }
  } finally {
    await scrubFile(dbPath)
    if (owned) await owned.dispose()
  }
}

/**
 * Parse a JSON object of table→count (from CLI flag or baseline file).
 * @param {string} raw
 * @returns {Record<string, number>}
 */
export function parseRowCountsJson(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`invalid row-counts JSON: ${msg}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('row-counts JSON must be an object of table→number')
  }
  /** @type {Record<string, number>} */
  const out = {}
  for (const [k, v] of Object.entries(parsed)) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(k)) {
      throw new Error(`refusing unsafe table name in row-counts: ${k}`)
    }
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new Error(`row-counts.${k} must be a non-negative integer`)
    }
    out[k] = n
  }
  return out
}

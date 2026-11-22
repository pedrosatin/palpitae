/**
 * Sanitize backup CLI reports for public logs (GitHub Actions stdout/stderr).
 *
 * Exact essential-table COUNTs, gate `actual` maps, SQL/sqlite diagnostics
 * (line numbers, statement fragments, FK rowids), and exact byte sizes must
 * not appear in CI logs. Authoritative counts stay in age-sealed
 * `.meta.json.age`. Prefer fixed public error codes at the throw site; the
 * regexes below are defense-in-depth only.
 */

import { resolve } from 'node:path'

/** Size field names that proxy operational volume in public logs. */
const SIZE_KEYS = new Set([
  'bytes',
  'plaintextBytes',
  'gzipBytes',
  'ciphertextBytes',
  'sealedMetaBytes',
  'countsBytes',
  'measuredPlaintextBytes',
  'measuredCiphertextBytes',
  'contentLength',
  'egressBytes',
  'egressEstimate',
])

/**
 * Map residual sqlite/SQL diagnostics to fixed public codes.
 * Prefer throwing PublicBackupError at the source; this is a backstop.
 * @param {string} text
 */
function redactSqliteDiagnostics(text) {
  let out = text
  // Line numbers approximate dump length on D1 one-INSERT-per-line exports.
  if (/\b(?:Parse error |Error: )?near line \d+/i.test(out)) {
    return 'sqlite-import-failed'
  }
  // Indented sqlite context / SQL fragments often carry PII from the dump.
  if (/sqlite3 import failed:/i.test(out) || /plaintext dump failed isolated SQLite import:/i.test(out)) {
    return 'plaintext-dump-import-failed'
  }
  // Only rewrite actual FK failure diagnostics — not prose that merely names the pragma.
  if (
    /sqlite foreign_key_check found \d+/i.test(out) ||
    /sqlite-foreign-key-check-failed/i.test(out) ||
    /\bsample:\s*\w+\|\d+\|\w+\|\d+/i.test(out)
  ) {
    return 'sqlite-foreign-key-check-failed'
  }
  if (/sqlite integrity_check failed:/i.test(out)) {
    return 'sqlite-integrity-check-failed'
  }
  // Drop multi-line indented SQL context blocks if any remain.
  out = out.replace(/\n\s{2,}[^\n]{0,500}/g, '')
  // VALUES (...)/INSERT fragments that may carry emails or tokens.
  out = out.replace(/\bVALUES\s*\([^)]{0,400}\)/gi, 'VALUES(<redacted>)')
  out = out.replace(/\bINSERT\s+INTO\b[^;]{0,400}/gi, 'INSERT INTO <redacted>')
  out = out.replace(/'[^']{0,200}@[^']{0,200}'/g, "'<redacted-email>'")
  return out
}

/**
 * Redact exact integers / sizes / residual SQL from operator-facing strings.
 * Prefer fixed codes at throw sites; regex is defense-in-depth only.
 * @param {unknown} message
 */
export function sanitizeErrorMessage(message) {
  let text = message instanceof Error ? message.message : String(message ?? '')
  text = redactSqliteDiagnostics(text)
  text = text
    .replace(/\bbaseline=\d+/gi, 'baseline=<redacted>')
    .replace(/\bdump count \d+/gi, 'dump count <redacted>')
    .replace(/\bsource count \d+/gi, 'source count <redacted>')
    .replace(/\brestored=\d+/gi, 'restored=<redacted>')
    .replace(/\bsealed=\d+/gi, 'sealed=<redacted>')
    .replace(/\bexpected \d+/gi, 'expected <redacted>')
    .replace(/\bgot \d+/gi, 'got <redacted>')
    .replace(/\bdump=0\b/gi, 'dump=<empty>')
    .replace(/\bsize=\d+/gi, 'size=<redacted>')
    .replace(/\bmin=\d+/gi, 'min=<redacted>')
    .replace(/\b\(\d+ bytes[^)]*\)/gi, '(size <redacted>)')
    .replace(/\b\d+ bytes\b/gi, '<redacted> bytes')
    .replace(/"rowCounts"\s*:\s*\{[^}]*\}/gi, '"rowCounts":"<redacted>"')
    .replace(/"actual"\s*:\s*\{[^}]*\}/gi, '"actual":"<redacted>"')
    .replace(/\bnear line \d+/gi, 'near line <redacted>')
    .replace(/\bsample:\s*[^\n|;]+/gi, 'sample:<redacted>')
  return text
}

/**
 * @param {unknown} countGate
 */
export function sanitizeCountGate(countGate) {
  if (!countGate || typeof countGate !== 'object') return countGate
  const gate = /** @type {Record<string, unknown>} */ (countGate)
  return {
    ok: gate.ok,
    mode: gate.mode,
    evidence: gate.evidence,
    limits: gate.limits,
    failureCount: Array.isArray(gate.failures) ? gate.failures.length : undefined,
    // failures may contain redacted text only — never include raw `actual`
  }
}

/**
 * @param {unknown} dumpValidation
 */
export function sanitizeDumpValidation(dumpValidation) {
  if (!dumpValidation || typeof dumpValidation !== 'object') return dumpValidation
  const dv = /** @type {Record<string, unknown>} */ (dumpValidation)
  const completeness =
    dv.completeness && typeof dv.completeness === 'object'
      ? {
          hasCreate: /** @type {any} */ (dv.completeness).hasCreate,
          hasInsert: /** @type {any} */ (dv.completeness).hasInsert,
          endsCleanly: /** @type {any} */ (dv.completeness).endsCleanly,
          schemaOnly: /** @type {any} */ (dv.completeness).schemaOnly,
          issueCount: Array.isArray(/** @type {any} */ (dv.completeness).issues)
            ? /** @type {any} */ (dv.completeness).issues.length
            : undefined,
        }
      : dv.completeness
  return {
    ok: dv.ok,
    // omit exact bytes (growth proxy)
    tables: dv.tables,
    tablesPresent: dv.tablesPresent,
    completeness,
    countGate: sanitizeCountGate(dv.countGate),
    sqliteIntegrity: dv.sqliteIntegrity
      ? {
          ok: /** @type {any} */ (dv.sqliteIntegrity).ok,
          integrityCheck: /** @type {any} */ (dv.sqliteIntegrity).integrityCheck,
          foreignKeyViolations: /** @type {any} */ (dv.sqliteIntegrity).foreignKeyViolations,
        }
      : dv.sqliteIntegrity,
    // intentionally omit rowCounts and bytes
  }
}

/**
 * @param {unknown} publicCounts
 */
export function sanitizePublicCounts(publicCounts) {
  if (!publicCounts || typeof publicCounts !== 'object') return publicCounts
  const pc = /** @type {Record<string, unknown>} */ (publicCounts)
  return {
    version: pc.version,
    kind: pc.kind,
    dbName: pc.dbName,
    stamp: pc.stamp,
    createdAt: pc.createdAt,
    ciphertextKey: pc.ciphertextKey,
    nonEmpty: pc.nonEmpty,
    tables: pc.tables,
    limits: pc.limits,
    note: pc.note,
    // omit legacy rowCounts if present on older in-memory objects
  }
}

/**
 * Strip exact size maps from a manifest (or nested pack.manifest).
 * @param {unknown} manifest
 */
export function sanitizeManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') return manifest
  const m = { .../** @type {Record<string, unknown>} */ (manifest) }
  if (m.sizes && typeof m.sizes === 'object') {
    m.sizes = { redacted: true }
  }
  for (const key of SIZE_KEYS) {
    if (key in m) delete m[key]
  }
  return m
}

/**
 * Recursively drop known size keys from a plain object (one level + known nests).
 * @param {Record<string, unknown>} obj
 */
function stripSizeKeys(obj) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SIZE_KEYS.has(k)) continue
    out[k] = v
  }
  return out
}

/**
 * Deep-sanitize a CLI JSON report before writing to stdout.
 * @param {unknown} report
 */
export function sanitizePublicReport(report) {
  if (!report || typeof report !== 'object') return report
  const src = /** @type {Record<string, unknown>} */ (report)
  /** @type {Record<string, unknown>} */
  const out = stripSizeKeys({ ...src })

  if (out.dumpValidation) out.dumpValidation = sanitizeDumpValidation(out.dumpValidation)
  if (out.publicCounts) out.publicCounts = sanitizePublicCounts(out.publicCounts)
  if (out.manifest) out.manifest = sanitizeManifest(out.manifest)

  if (out.pack && typeof out.pack === 'object') {
    const pack = stripSizeKeys({ .../** @type {Record<string, unknown>} */ (out.pack) })
    if (pack.dumpValidation) pack.dumpValidation = sanitizeDumpValidation(pack.dumpValidation)
    if (pack.publicCounts) pack.publicCounts = sanitizePublicCounts(pack.publicCounts)
    if (pack.manifest) pack.manifest = sanitizeManifest(pack.manifest)
    if (pack.rowCounts) delete pack.rowCounts
    out.pack = pack
  }

  if (out.countGate) out.countGate = sanitizeCountGate(out.countGate)
  if (out.rowCounts) delete out.rowCounts
  if (out.sizes) out.sizes = { redacted: true }

  if (typeof out.error === 'string') out.error = sanitizeErrorMessage(out.error)
  if (typeof out.detail === 'string') out.detail = sanitizeErrorMessage(out.detail)

  return out
}

/**
 * Resolve a CLI path. Rejects `~` (shell does not expand inside `--flag=...`).
 * Relative paths resolve against process.cwd() — prefer absolute `"$HOME/..."`.
 * @param {string} raw
 */
export function resolveCliPath(raw) {
  const value = String(raw)
  if (value.startsWith('~')) {
    throw new Error(
      'path uses ~ which is not expanded inside --flag=...; pass an absolute path or expand with "$HOME/..." in the shell',
    )
  }
  return resolve(value)
}

/**
 * Optionally emit private error detail on a private operator host.
 * Never call this from CI / public log paths.
 * @param {unknown} err
 * @param {{ write?: (s: string) => void }} [opts]
 */
export function maybeWritePrivateError(err, opts = {}) {
  if (process.env.PALPITAE_BACKUP_PRIVATE_ERRORS !== '1') return
  const detail =
    err && typeof err === 'object' && 'privateDetail' in err
      ? String(/** @type {any} */ (err).privateDetail || '')
      : ''
  if (!detail) return
  const write = opts.write || ((s) => process.stderr.write(s))
  write(`private-error-detail: ${detail}\n`)
}

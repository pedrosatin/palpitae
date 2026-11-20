/**
 * Public operational counts baseline for the next pack's count gate.
 *
 * Why a separate `.counts.json` (not sealed meta, not cleartext rowCounts in
 * the unsigned manifest):
 * - CI / daily pack has only age public recipients — it cannot decrypt
 *   `.meta.json.age` to recover yesterday's counts.
 * - Putting exact rowCounts in the public companion (and CI logs) leaks
 *   operational shape. v2 stores boolean `nonEmpty` per essential table —
 *   enough for the catastrophic-empty baseline gate — plus `tables` for
 *   schema-loss detection. Exact COUNTs stay in age-sealed `.meta.json.age`.
 *
 * Threat model (honest): `.counts.json` is unsigned. An actor with Object RW
 * can forge counts and a matching dump. This artifact only enables fail-closed
 * comparison against a prior pack; it is not publisher authentication and not
 * a restore proof. Authoritative restore comparison uses decrypted sealed meta.
 *
 * Migration: v1 documents with numeric `rowCounts` remain readable. New packs
 * write v2 `nonEmpty` + `tables` and omit exact public rowCounts.
 */

import { readFile } from 'node:fs/promises'
import { ESSENTIAL_TABLES, parseRowCountsJson } from './verify-sqlite.mjs'
import { sha256Buffer } from './integrity.mjs'
import { companionKeys } from './naming.mjs'
import { resolveCliPath } from './public-report.mjs'

/**
 * Minimal manifest parse for baseline selection (avoids importing inventory.mjs
 * and creating a cycle with parseCountsDocument).
 * @param {unknown} raw
 * @returns {{ ok: true, manifest: any } | { ok: false, reason: string }}
 */
function parseManifestForBaseline(raw) {
  let manifest
  try {
    manifest = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return { ok: false, reason: 'manifest-json-invalid' }
  }
  if (!manifest || typeof manifest !== 'object') {
    return { ok: false, reason: 'manifest-not-object' }
  }
  if (manifest.kind !== 'palpitae-d1-backup') {
    return { ok: false, reason: 'manifest-kind-mismatch' }
  }
  if (manifest.rowCounts !== undefined) {
    return { ok: false, reason: 'manifest-exposes-rowCounts' }
  }
  if (typeof manifest.hashes?.sealedMetaSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(manifest.hashes.sealedMetaSha256)) {
    return { ok: false, reason: 'manifest-sealed-meta-hash-malformed' }
  }
  if (typeof manifest.hashes?.countsSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(manifest.hashes.countsSha256)) {
    return { ok: false, reason: 'manifest-counts-hash-malformed' }
  }
  if (typeof manifest.sealedMetaKey !== 'string' || !manifest.sealedMetaKey.endsWith('.meta.json.age')) {
    return { ok: false, reason: 'manifest-missing-sealed-meta-key' }
  }
  if (typeof manifest.countsKey !== 'string' || !manifest.countsKey.endsWith('.counts.json')) {
    return { ok: false, reason: 'manifest-missing-counts-key' }
  }
  return { ok: true, manifest }
}

export const PUBLIC_COUNTS_KIND = 'palpitae-d1-backup-counts'
/** v2: boolean nonEmpty + tables; v1 numeric rowCounts still accepted on read. */
export const PUBLIC_COUNTS_VERSION = 2
export const BOOTSTRAP_EVIDENCE_KIND = 'palpitae-backup-bootstrap-evidence'

export const SNAPSHOT_LIMITS =
  'Public companion stores boolean nonEmpty (and tables) for the next pack catastrophic-empty gate + schema-loss check. Exact COUNTs live only in age-sealed .meta.json.age. Detects empty vs prior non-empty and missing tables vs prior/expected schema. Does not prove partial truncation with non-zero COUNTs, cross-table transactional consistency, live-DB equality at a later instant, or publisher authenticity of the unsigned counts companion.'

/**
 * @param {Record<string, number>} rowCounts
 * @returns {Record<string, boolean>}
 */
export function rowCountsToNonEmpty(rowCounts) {
  /** @type {Record<string, boolean>} */
  const nonEmpty = {}
  for (const [table, n] of Object.entries(rowCounts)) {
    nonEmpty[table] = Number(n) > 0
  }
  return nonEmpty
}

/**
 * @param {{
 *   dbName: string,
 *   stamp: string,
 *   ciphertextKey: string,
 *   rowCounts: Record<string, number>,
 *   tables?: string[],
 *   createdAtIso: string,
 * }} fields
 */
export function buildPublicCounts(fields) {
  const tables =
    fields.tables && fields.tables.length > 0
      ? [...fields.tables]
      : [...ESSENTIAL_TABLES]
  return {
    version: PUBLIC_COUNTS_VERSION,
    kind: PUBLIC_COUNTS_KIND,
    dbName: fields.dbName,
    stamp: fields.stamp,
    createdAt: fields.createdAtIso,
    ciphertextKey: fields.ciphertextKey,
    nonEmpty: rowCountsToNonEmpty(fields.rowCounts),
    tables,
    limits: SNAPSHOT_LIMITS,
    note:
      'Public operational baseline for the next pack (boolean nonEmpty + tables). Unsigned. Exact rowCounts are only in .meta.json.age (age-sealed). Legacy v1 numeric rowCounts remain readable for migration.',
  }
}

/**
 * @param {ReturnType<typeof buildPublicCounts>} counts
 */
export function publicCountsBody(counts) {
  const body = `${JSON.stringify(counts, null, 2)}\n`
  return { body, sha256: sha256Buffer(body), bytes: Buffer.byteLength(body) }
}

/**
 * Normalize a baseline map for the count gate (number or boolean per table).
 * @param {Record<string, unknown>} values
 * @returns {Record<string, number | boolean>}
 */
export function normalizeBaselineValues(values) {
  /** @type {Record<string, number | boolean>} */
  const out = {}
  for (const [k, v] of Object.entries(values)) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(k)) {
      throw new Error(`refusing unsafe table name in baseline: ${k}`)
    }
    if (typeof v === 'boolean') {
      out[k] = v
      continue
    }
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new Error(`baseline.${k} must be a boolean or non-negative integer`)
    }
    out[k] = n
  }
  return out
}

/**
 * Parse a counts document from JSON text or object.
 * Accepts: plain table→number map, public counts v1/v2, or sealed-meta shape
 * (operator decrypted offline).
 *
 * @param {unknown} raw
 * @returns {{
 *   ok: true,
 *   baselineValues: Record<string, number | boolean>,
 *   numericRowCounts: Record<string, number> | null,
 *   tables: string[] | null,
 *   source: string,
 *   mode: 'numeric' | 'nonEmpty',
 * } | { ok: false, reason: string }}
 */
export function parseCountsDocument(raw) {
  let doc = raw
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, reason: `counts-json-invalid:${msg}` }
    }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, reason: 'counts-not-object' }
  }

  /** @type {string[] | null} */
  let tables = Array.isArray(doc.tables)
    ? doc.tables.filter((t) => typeof t === 'string')
    : null

  try {
    if (doc.kind === PUBLIC_COUNTS_KIND) {
      if (doc.nonEmpty && typeof doc.nonEmpty === 'object' && !Array.isArray(doc.nonEmpty)) {
        const baselineValues = normalizeBaselineValues(
          /** @type {Record<string, unknown>} */ (doc.nonEmpty),
        )
        for (const table of ESSENTIAL_TABLES) {
          if (!Object.prototype.hasOwnProperty.call(baselineValues, table)) {
            return { ok: false, reason: `counts-missing-essential:${table}` }
          }
        }
        return {
          ok: true,
          baselineValues,
          numericRowCounts: null,
          tables,
          source: 'public-counts-nonEmpty',
          mode: 'nonEmpty',
        }
      }
      if (doc.rowCounts && typeof doc.rowCounts === 'object') {
        const rowCounts = parseRowCountsJson(JSON.stringify(doc.rowCounts))
        for (const table of ESSENTIAL_TABLES) {
          if (!Object.prototype.hasOwnProperty.call(rowCounts, table)) {
            return { ok: false, reason: `counts-missing-essential:${table}` }
          }
        }
        return {
          ok: true,
          baselineValues: rowCounts,
          numericRowCounts: rowCounts,
          tables,
          source: 'public-counts-legacy-rowCounts',
          mode: 'numeric',
        }
      }
      return { ok: false, reason: 'counts-public-missing-nonEmpty-or-rowCounts' }
    }

    if (doc.kind === 'palpitae-d1-backup-meta') {
      const rowCounts = parseRowCountsJson(JSON.stringify(doc.rowCounts))
      for (const table of ESSENTIAL_TABLES) {
        if (!Object.prototype.hasOwnProperty.call(rowCounts, table)) {
          return { ok: false, reason: `counts-missing-essential:${table}` }
        }
      }
      return {
        ok: true,
        baselineValues: rowCounts,
        numericRowCounts: rowCounts,
        tables,
        source: 'sealed-meta-decrypted',
        mode: 'numeric',
      }
    }

    if (doc.rowCounts && typeof doc.rowCounts === 'object') {
      const rowCounts = parseRowCountsJson(JSON.stringify(doc.rowCounts))
      for (const table of ESSENTIAL_TABLES) {
        if (!Object.prototype.hasOwnProperty.call(rowCounts, table)) {
          return { ok: false, reason: `counts-missing-essential:${table}` }
        }
      }
      return {
        ok: true,
        baselineValues: rowCounts,
        numericRowCounts: rowCounts,
        tables,
        source: 'wrapped-rowCounts',
        mode: 'numeric',
      }
    }

    // Plain table→number map (or boolean map for tests / explicit baseline).
    const baselineValues = normalizeBaselineValues(/** @type {Record<string, unknown>} */ (doc))
    for (const table of ESSENTIAL_TABLES) {
      if (!Object.prototype.hasOwnProperty.call(baselineValues, table)) {
        return { ok: false, reason: `counts-missing-essential:${table}` }
      }
    }
    const allBool = Object.values(baselineValues).every((v) => typeof v === 'boolean')
    const allNum = Object.values(baselineValues).every((v) => typeof v === 'number')
    if (!allBool && !allNum) {
      return { ok: false, reason: 'counts-mixed-boolean-and-numeric' }
    }
    return {
      ok: true,
      baselineValues,
      numericRowCounts: allNum
        ? /** @type {Record<string, number>} */ (baselineValues)
        : null,
      tables,
      source: allBool ? 'plain-nonEmpty' : 'plain-map',
      mode: allBool ? 'nonEmpty' : 'numeric',
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, reason: msg }
  }
}

/**
 * Load baseline values from CLI flag: JSON inline or @path.
 * Accepts numeric or boolean maps (and public counts v1/v2).
 * @param {string} value
 * @returns {Promise<Record<string, number | boolean>>}
 */
export async function loadCountsArg(value) {
  const raw = String(value)
  const text = raw.startsWith('@')
    ? await readFile(resolveCliPath(raw.slice(1)), 'utf8')
    : raw
  const parsed = parseCountsDocument(text)
  if (!parsed.ok) {
    throw new Error(`invalid counts argument: ${parsed.reason}`)
  }
  return parsed.baselineValues
}

/**
 * Load exact numeric counts (for --source-counts). Rejects boolean-only docs.
 * @param {string} value
 * @returns {Promise<Record<string, number>>}
 */
export async function loadSourceCountsArg(value) {
  const raw = String(value)
  const text = raw.startsWith('@')
    ? await readFile(resolveCliPath(raw.slice(1)), 'utf8')
    : raw
  const parsed = parseCountsDocument(text)
  if (!parsed.ok) {
    throw new Error(`invalid source-counts argument: ${parsed.reason}`)
  }
  if (!parsed.numericRowCounts) {
    throw new Error(
      'invalid source-counts argument: exact numeric rowCounts required (boolean nonEmpty baseline is not enough for source mode)',
    )
  }
  return parsed.numericRowCounts
}

/**
 * Bootstrap evidence required for the first real pack without a prior baseline.
 * Fixture packs do not need this.
 *
 * @param {unknown} raw
 */
export function parseBootstrapEvidence(raw) {
  let doc = raw
  if (typeof raw === 'string') {
    try {
      doc = JSON.parse(raw)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, reason: `bootstrap-json-invalid:${msg}` }
    }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return { ok: false, reason: 'bootstrap-not-object' }
  }
  if (doc.kind !== BOOTSTRAP_EVIDENCE_KIND) {
    return { ok: false, reason: 'bootstrap-kind-mismatch' }
  }
  const reason = typeof doc.reason === 'string' ? doc.reason.trim() : ''
  const measuredAt = typeof doc.measuredAt === 'string' ? doc.measuredAt.trim() : ''
  const notes = typeof doc.notes === 'string' ? doc.notes.trim() : ''
  if (!reason || reason.length < 8) {
    return { ok: false, reason: 'bootstrap-reason-too-short' }
  }
  if (!measuredAt) {
    return { ok: false, reason: 'bootstrap-measuredAt-required' }
  }
  if (!notes || notes.length < 16) {
    return {
      ok: false,
      reason: 'bootstrap-notes-required',
      detail: 'Describe how essential counts were measured (e.g. D1 SELECT COUNT) and why this is the first pack.',
    }
  }
  return {
    ok: true,
    evidence: {
      kind: BOOTSTRAP_EVIDENCE_KIND,
      reason,
      measuredAt,
      notes,
      operator: typeof doc.operator === 'string' ? doc.operator : undefined,
      emptyDatabase: Boolean(doc.emptyDatabase),
    },
  }
}

/**
 * @param {string} value @path or inline JSON
 */
export async function loadBootstrapEvidence(value) {
  const raw = String(value)
  const text = raw.startsWith('@')
    ? await readFile(resolveCliPath(raw.slice(1)), 'utf8')
    : raw
  const parsed = parseBootstrapEvidence(text)
  if (!parsed.ok) {
    throw new Error(
      `invalid --bootstrap-with-evidence: ${parsed.reason}${parsed.detail ? ` (${parsed.detail})` : ''}`,
    )
  }
  return parsed.evidence
}

/**
 * Classify a sink read failure so baseline resolution can fail closed on
 * transient/remote errors instead of treating them as "missing companion".
 * @param {unknown} err
 * @returns {{ kind: 'missing' | 'transient' | 'error', status?: number, code?: string }}
 */
export function classifySinkReadError(err) {
  const e = /** @type {{ code?: string, status?: number, name?: string, message?: string }} */ (
    err && typeof err === 'object' ? err : {}
  )
  const code = typeof e.code === 'string' ? e.code : undefined
  const status = typeof e.status === 'number' ? e.status : undefined
  if (code === 'ENOENT' || status === 404) {
    return { kind: 'missing', code, status }
  }
  if (
    (typeof status === 'number' && status >= 500) ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN' ||
    code === 'ENOTFOUND' ||
    code === 'ECONNREFUSED' ||
    code === 'EPIPE'
  ) {
    return { kind: 'transient', code, status }
  }
  // Any other R2 API failure while reading baseline is fail-closed (not "skip").
  if (e.name === 'R2ApiError') {
    return { kind: 'transient', code, status }
  }
  return { kind: 'error', code, status }
}

/**
 * Incomplete orphan companions (true 404/ENOENT) may soft-skip to an older
 * object. Everything else on the candidate under evaluation is fail-closed.
 * @param {string} reason
 */
export function isSoftBaselineSkipReason(reason) {
  return (
    reason === 'baseline-manifest-missing' ||
    reason === 'baseline-sealed-meta-missing' ||
    reason === 'baseline-counts-missing'
  )
}

/**
 * @param {string} reason
 */
export function isHardBaselineFailureReason(reason) {
  if (!reason) return false
  if (reason === 'baseline-transient-error') return true
  if (reason === 'baseline-counts-modified') return true
  if (reason === 'baseline-sealed-meta-hash-mismatch') return true
  if (reason === 'baseline-sealed-meta-empty') return true
  if (reason === 'baseline-counts-empty') return true
  if (reason.startsWith('baseline-counts-parse-')) return true
  if (reason.startsWith('baseline-manifest-') && reason !== 'baseline-manifest-missing') {
    return true
  }
  if (reason === 'baseline-manifest-read-error' || reason === 'baseline-read-error') return true
  return false
}

/**
 * Read a companion/object from a sink as Buffer.
 * @param {any} sink
 * @param {string} key
 */
async function readSinkObject(sink, key) {
  if (typeof sink.pathFor === 'function') {
    const { readFile: rf } = await import('node:fs/promises')
    return rf(await sink.pathFor(key))
  }
  return sink.get(key)
}

/**
 * @param {unknown} err
 * @param {string} missingReason
 * @param {string} cipherKey
 */
function baselineReadFailure(err, missingReason, cipherKey) {
  const classified = classifySinkReadError(err)
  if (classified.kind === 'missing') {
    return {
      ok: false,
      reason: missingReason,
      softMissing: true,
      cipherKey,
      detail: classified.status != null ? `status=${classified.status}` : classified.code || 'missing',
    }
  }
  if (classified.kind === 'transient') {
    return {
      ok: false,
      reason: 'baseline-transient-error',
      softMissing: false,
      cipherKey,
      detail:
        classified.status != null
          ? `transient-status=${classified.status}`
          : `transient-code=${classified.code || 'unknown'}`,
    }
  }
  return {
    ok: false,
    reason: 'baseline-read-error',
    softMissing: false,
    cipherKey,
    detail: 'baseline companion read failed',
  }
}

/**
 * Fail-closed: validate manifest + companions/hashes for a listed backup
 * before trusting its public counts as the next pack's baseline. Refuses a
 * modified `.counts.json` (hash mismatch) or incomplete companions.
 *
 * Does not download/hash the ciphertext (baseline selection only needs the
 * unsigned manifest pin of the counts companion). Ciphertext integrity is
 * still checked on restore / inventory classify.
 *
 * Distinguishes soft missing (404/ENOENT orphan) from transient remote errors
 * (e.g. R2 503) so callers do not silently fall back to an older baseline.
 *
 * @param {any} sink
 * @param {{ key: string, createdAt: Date }} object
 */
export async function validateBaselineCandidate(sink, object) {
  const cipherKey = object.key
  const keys = companionKeys(cipherKey)
  /** @type {string[]} */
  const attempts = []

  let manifestBuf
  try {
    manifestBuf = await readSinkObject(sink, keys.manifestKey)
  } catch (err) {
    return baselineReadFailure(err, 'baseline-manifest-missing', cipherKey)
  }

  const parsedManifest = parseManifestForBaseline(manifestBuf.toString('utf8'))
  if (!parsedManifest.ok) {
    return {
      ok: false,
      reason: `baseline-manifest-${parsedManifest.reason}`,
      softMissing: false,
      cipherKey,
    }
  }
  const manifest = parsedManifest.manifest

  // Sealed meta presence + hash (restore requires it; refuse baseline from a
  // pack that cannot be restored).
  let sealedBuf
  try {
    sealedBuf = await readSinkObject(sink, manifest.sealedMetaKey || keys.sealedMetaKey)
  } catch (err) {
    return baselineReadFailure(err, 'baseline-sealed-meta-missing', cipherKey)
  }
  if (!sealedBuf || sealedBuf.byteLength === 0) {
    return { ok: false, reason: 'baseline-sealed-meta-empty', softMissing: false, cipherKey }
  }
  const sealedActual = sha256Buffer(sealedBuf).toLowerCase()
  if (sealedActual !== String(manifest.hashes.sealedMetaSha256).toLowerCase()) {
    return { ok: false, reason: 'baseline-sealed-meta-hash-mismatch', softMissing: false, cipherKey }
  }

  let countsBuf
  try {
    countsBuf = await readSinkObject(sink, manifest.countsKey || keys.countsKey)
  } catch (err) {
    return baselineReadFailure(err, 'baseline-counts-missing', cipherKey)
  }
  if (!countsBuf || countsBuf.byteLength === 0) {
    return { ok: false, reason: 'baseline-counts-empty', softMissing: false, cipherKey }
  }
  const countsActual = sha256Buffer(countsBuf).toLowerCase()
  if (countsActual !== String(manifest.hashes.countsSha256).toLowerCase()) {
    return {
      ok: false,
      reason: 'baseline-counts-modified',
      softMissing: false,
      detail:
        'public .counts.json sha256 does not match validated manifest; refusing forged/modified baseline',
      cipherKey,
    }
  }

  const countsParsed = parseCountsDocument(countsBuf.toString('utf8'))
  if (!countsParsed.ok) {
    return {
      ok: false,
      reason: `baseline-counts-parse-${countsParsed.reason}`,
      softMissing: false,
      cipherKey,
    }
  }

  return {
    ok: true,
    cipherKey,
    countsKey: manifest.countsKey || keys.countsKey,
    baselineValues: countsParsed.baselineValues,
    numericRowCounts: countsParsed.numericRowCounts,
    tables: countsParsed.tables,
    source: countsParsed.source,
    mode: countsParsed.mode,
    attempts,
  }
}

/**
 * Resolve baseline from sink inventory, newest-first, fail-closed.
 *
 * Soft-skips only true incomplete orphans (404/ENOENT companions). If the
 * newest complete-looking candidate has modified counts, hash mismatch, parse
 * failure, or a transient read error (e.g. R2 503), returns that failure
 * immediately — does **not** silently fall back to an older object (which
 * would pack+upload a new object against a stale baseline while leaving
 * corruption in place).
 *
 * @param {{
 *   get: (key: string) => Promise<Buffer>,
 *   pathFor?: (key: string) => Promise<string>,
 * }} sink
 * @param {Array<{ key: string, createdAt: Date }>} listed newest-first preferred
 * @param {{ excludeKeys?: Iterable<string> }} [opts]
 */
export async function resolveBaselineCountsFromSink(sink, listed, opts = {}) {
  const exclude = new Set(opts.excludeKeys || [])
  const ordered = [...listed].sort((a, b) => b.createdAt - a.createdAt)
  /** @type {string[]} */
  const attempts = []

  for (const obj of ordered) {
    if (exclude.has(obj.key)) continue
    const validated = await validateBaselineCandidate(sink, obj)
    if (!validated.ok) {
      attempts.push(`${obj.key}:${validated.reason}`)
      const soft =
        validated.softMissing === true || isSoftBaselineSkipReason(validated.reason)
      if (soft && !isHardBaselineFailureReason(validated.reason)) {
        // Incomplete orphan only — try an older validated object.
        continue
      }
      // Adulterated / transient / parse / hash: fail closed before pack/upload.
      return {
        ok: false,
        reason: validated.reason,
        detail: validated.detail,
        ciphertextKey: validated.cipherKey || obj.key,
        attempts,
      }
    }
    return {
      ok: true,
      // Prefer boolean baseline values for the gate; numeric legacy still works.
      baselineValues: validated.baselineValues,
      /** @deprecated use baselineValues — kept for callers that expect rowCounts shape */
      rowCounts: validated.baselineValues,
      tables: validated.tables,
      countsKey: validated.countsKey,
      ciphertextKey: validated.cipherKey,
      source: validated.source,
      mode: validated.mode,
      attempts,
    }
  }

  return {
    ok: false,
    reason: listed.length === 0 ? 'empty-inventory' : 'no-usable-prior-counts',
    attempts,
  }
}

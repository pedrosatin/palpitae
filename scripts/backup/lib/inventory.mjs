/**
 * Inventory classification for retention/prune.
 *
 * A listed ciphertext is "validated" only when its companion manifest exists,
 * parses as a palpitae-d1-backup, and integrity checks for the active verify
 * mode succeed. Anything else is "unvalidated" and must be preserved.
 *
 * Verify modes (egress vs integrity tradeoff):
 * - `full`: download every ciphertext and compare SHA-256 to the manifest.
 * - `hybrid` (default for daily): full SHA-256 only for `mustVerifyKeys` and
 *   size-mismatch suspects; other objects get manifest parse + contentLength
 *   vs manifest.sizes.ciphertextBytes (no ciphertext download).
 * - `manifest-size`: never download ciphertext; manifest + size only.
 *
 * R2 list/upload ETag are **not** used as authentication.
 * They may detect transport corruption from R2's perspective, but an actor
 * who can rewrite bucket objects can rewrite those metadata too. End-to-end
 * proof for a just-written object is: download bytes → local SHA-256 →
 * compare to the manifest hash we recorded at pack time. Manifests themselves
 * are unsigned (age encrypts to recipients; it does not authenticate the
 * publisher).
 *
 * Validation I/O failures mark the result incomplete so --apply / daily can
 * fail closed.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWorkDir, scrubFile } from './pipeline.mjs'
import { sha256Buffer, sha256File } from './integrity.mjs'
import { companionKeys } from './naming.mjs'
import { parseCountsDocument } from './counts-baseline.mjs'

/** @typedef {'full' | 'hybrid' | 'manifest-size'} VerifyMode */

/**
 * @param {unknown} raw
 * @returns {{ ok: true, manifest: any } | { ok: false, reason: string }}
 */
export function parseBackupManifest(raw) {
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
  if (!manifest.hashes || typeof manifest.hashes.ciphertextSha256 !== 'string') {
    return { ok: false, reason: 'manifest-missing-ciphertext-hash' }
  }
  if (!/^[0-9a-f]{64}$/i.test(manifest.hashes.ciphertextSha256)) {
    return { ok: false, reason: 'manifest-ciphertext-hash-malformed' }
  }
  // Restore requires sealed meta; inventory must refuse objects whose manifest
  // omits the sidecar hash (legacy packs without sealedMetaSha256 stay
  // unvalidated rather than silently "ok").
  if (typeof manifest.hashes.sealedMetaSha256 !== 'string') {
    return { ok: false, reason: 'manifest-missing-sealed-meta-hash' }
  }
  if (!/^[0-9a-f]{64}$/i.test(manifest.hashes.sealedMetaSha256)) {
    return { ok: false, reason: 'manifest-sealed-meta-hash-malformed' }
  }
  if (typeof manifest.hashes.countsSha256 !== 'string') {
    return { ok: false, reason: 'manifest-missing-counts-hash' }
  }
  if (!/^[0-9a-f]{64}$/i.test(manifest.hashes.countsSha256)) {
    return { ok: false, reason: 'manifest-counts-hash-malformed' }
  }
  if (typeof manifest.sealedMetaKey !== 'string' || !manifest.sealedMetaKey.endsWith('.meta.json.age')) {
    return { ok: false, reason: 'manifest-missing-sealed-meta-key' }
  }
  if (typeof manifest.countsKey !== 'string' || !manifest.countsKey.endsWith('.counts.json')) {
    return { ok: false, reason: 'manifest-missing-counts-key' }
  }
  // Cleartext rowCounts in the public manifest are no longer allowed.
  if (manifest.rowCounts !== undefined) {
    return { ok: false, reason: 'manifest-exposes-rowCounts' }
  }
  return { ok: true, manifest }
}

/**
 * Estimate ciphertext download bytes for a classify pass.
 * Manifest JSON downloads are omitted (typically << 1 KiB each).
 *
 * @param {Array<{ key: string, contentLength?: number }>} listed
 * @param {{
 *   verifyMode?: VerifyMode,
 *   mustVerifyKeys?: Iterable<string>,
 * }} [opts]
 */
export function estimateCiphertextEgressBytes(listed, opts = {}) {
  const mode = opts.verifyMode || 'hybrid'
  const must = new Set(opts.mustVerifyKeys || [])
  let bytes = 0
  let fullHashObjects = 0
  let lightweightObjects = 0

  for (const obj of listed) {
    const size = typeof obj.contentLength === 'number' ? obj.contentLength : 0
    const forceFull = must.has(obj.key)
    if (mode === 'full' || forceFull) {
      bytes += size
      fullHashObjects += 1
    } else if (mode === 'hybrid' || mode === 'manifest-size') {
      lightweightObjects += 1
    }
  }

  return {
    verifyMode: mode,
    estimatedCiphertextDownloadBytes: bytes,
    fullHashObjects,
    lightweightObjects,
    listedObjects: listed.length,
    note:
      'Estimate uses listed contentLength for objects that would be fully hashed. Manifest downloads and size mismatches that escalate to full hash are not included. R2 free tier includes Class A/B ops and 10 GB storage; confirm on the Cloudflare pricing page.',
  }
}

/**
 * @param {{
 *   key: string,
 *   createdAt: Date,
 *   fileId?: string,
 *   contentLength?: number,
 * }} object
 * @param {{
 *   get: (key: string) => Promise<Buffer>,
 *   pathFor?: (key: string) => Promise<string>,
 *   downloadTo?: (key: string, dest: string) => Promise<string>,
 * }} sink
 * @param {{
 *   workDir: string,
 *   verifyMode: VerifyMode,
 *   mustVerifyKeys: Set<string>,
 * }} ctx
 */
/**
 * Fetch a companion object as a Buffer from the sink.
 * @param {any} sink
 * @param {string} key
 */
async function readCompanion(sink, key) {
  if (typeof sink.pathFor === 'function') {
    return readFile(await sink.pathFor(key))
  }
  return sink.get(key)
}

/**
 * Validate sealed-meta + public-counts companions against the manifest hashes.
 * Missing or mismatched companions make the backup unrestorable / unusable as
 * a next-day baseline — treat as corruption, not a soft skip.
 *
 * @param {any} sink
 * @param {any} manifest
 * @param {string} cipherKey
 */
async function verifyCompanions(sink, manifest, cipherKey) {
  const keys = companionKeys(cipherKey)
  const sealedKey = manifest.sealedMetaKey || keys.sealedMetaKey
  const countsKey = manifest.countsKey || keys.countsKey

  let sealedBuf
  try {
    sealedBuf = await readCompanion(sink, sealedKey)
  } catch (err) {
    const status = /** @type {any} */ (err)?.status
    const msg = err instanceof Error ? err.message : String(err)
    if (status === 404 || /not_found|ENOENT|download failed \(404\)/i.test(msg)) {
      return { ok: false, reason: 'sealed-meta-missing' }
    }
    return { ok: false, reason: 'sealed-meta-read-error', hardError: true, error: msg }
  }
  if (!sealedBuf || sealedBuf.byteLength === 0) {
    return { ok: false, reason: 'sealed-meta-empty' }
  }
  const expectedSealedBytes = manifest.sizes?.sealedMetaBytes
  if (typeof expectedSealedBytes === 'number' && sealedBuf.byteLength !== expectedSealedBytes) {
    return { ok: false, reason: 'sealed-meta-size-mismatch' }
  }
  const sealedActual = sha256Buffer(sealedBuf).toLowerCase()
  if (sealedActual !== String(manifest.hashes.sealedMetaSha256).toLowerCase()) {
    return { ok: false, reason: 'sealed-meta-hash-mismatch' }
  }

  let countsBuf
  try {
    countsBuf = await readCompanion(sink, countsKey)
  } catch (err) {
    const status = /** @type {any} */ (err)?.status
    const msg = err instanceof Error ? err.message : String(err)
    if (status === 404 || /not_found|ENOENT|download failed \(404\)/i.test(msg)) {
      return { ok: false, reason: 'counts-missing' }
    }
    return { ok: false, reason: 'counts-read-error', hardError: true, error: msg }
  }
  if (!countsBuf || countsBuf.byteLength === 0) {
    return { ok: false, reason: 'counts-empty' }
  }
  const expectedCountsBytes = manifest.sizes?.countsBytes
  if (typeof expectedCountsBytes === 'number' && countsBuf.byteLength !== expectedCountsBytes) {
    return { ok: false, reason: 'counts-size-mismatch' }
  }
  const countsActual = sha256Buffer(countsBuf).toLowerCase()
  if (countsActual !== String(manifest.hashes.countsSha256).toLowerCase()) {
    return { ok: false, reason: 'counts-hash-mismatch' }
  }
  const countsParsed = parseCountsDocument(countsBuf.toString('utf8'))
  if (!countsParsed.ok) {
    // Normalize to a stable corruption class; detail stays in the suffix for operators.
    return { ok: false, reason: `counts-parse-${countsParsed.reason}` }
  }

  return {
    ok: true,
    sealedMetaBytes: sealedBuf.byteLength,
    countsBytes: countsBuf.byteLength,
    baselineValues: countsParsed.baselineValues,
    rowCounts: countsParsed.numericRowCounts || countsParsed.baselineValues,
    tables: countsParsed.tables,
  }
}

export async function classifyOneBackup(object, sink, ctx) {
  const cipherKey = object.key
  const { manifestKey } = companionKeys(cipherKey)
  /** @type {{
   *   key: string,
   *   createdAt: Date,
   *   fileId?: string,
   *   contentLength?: number,
   *   status: 'validated'|'unvalidated',
   *   reason?: string,
   *   verification?: 'full'|'lightweight',
   *   hardError?: boolean,
   *   error?: string,
   *   egressBytes?: number,
   *   manifest?: any,
   *   companions?: any,
   * }} */
  const base = {
    key: cipherKey,
    createdAt: object.createdAt,
    fileId: object.fileId,
    contentLength: object.contentLength,
    status: 'unvalidated',
    egressBytes: 0,
  }

  let manifestRaw
  try {
    if (typeof sink.pathFor === 'function') {
      try {
        manifestRaw = await readFile(await sink.pathFor(manifestKey))
      } catch (err) {
        if (err && /** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
          return { ...base, reason: 'manifest-missing' }
        }
        throw err
      }
    } else {
      manifestRaw = await sink.get(manifestKey)
    }
  } catch (err) {
    const status = /** @type {any} */ (err)?.status
    const msg = err instanceof Error ? err.message : String(err)
    if (status === 404 || /not_found|ENOENT|download failed \(404\)/i.test(msg)) {
      return { ...base, reason: 'manifest-missing' }
    }
    return { ...base, reason: 'manifest-read-error', hardError: true, error: msg }
  }

  const parsed = parseBackupManifest(manifestRaw.toString('utf8'))
  if (!parsed.ok) {
    return { ...base, reason: parsed.reason }
  }

  const companions = await verifyCompanions(sink, parsed.manifest, cipherKey)
  if (!companions.ok) {
    return {
      ...base,
      reason: companions.reason,
      hardError: Boolean(companions.hardError),
      error: companions.error,
      manifest: parsed.manifest,
      verification: 'companions',
    }
  }

  const expected = parsed.manifest.hashes.ciphertextSha256.toLowerCase()
  const expectedBytes = parsed.manifest.sizes?.ciphertextBytes

  const sizeMismatch =
    typeof object.contentLength === 'number' &&
    typeof expectedBytes === 'number' &&
    object.contentLength !== expectedBytes

  const wantFullHash =
    ctx.verifyMode === 'full' ||
    ctx.mustVerifyKeys.has(cipherKey) ||
    (ctx.verifyMode === 'hybrid' && sizeMismatch)

  if (!wantFullHash) {
    if (sizeMismatch) {
      return {
        ...base,
        reason: 'ciphertext-size-mismatch',
        manifest: parsed.manifest,
        companions,
        verification: 'lightweight',
      }
    }
    if (
      typeof object.contentLength === 'number' &&
      typeof expectedBytes === 'number' &&
      object.contentLength === expectedBytes
    ) {
      return {
        ...base,
        status: 'validated',
        reason: 'manifest-size-ok',
        verification: 'lightweight',
        manifest: parsed.manifest,
        companions,
      }
    }
    // Missing contentLength or sizes: cannot lightweight-validate safely.
    if (ctx.verifyMode === 'manifest-size') {
      return {
        ...base,
        reason: 'ciphertext-size-unavailable',
        verification: 'lightweight',
        manifest: parsed.manifest,
        companions,
      }
    }
    // hybrid without sizes → fall through to full hash for this object.
  }

  let actual
  let egressBytes = 0
  try {
    if (typeof sink.pathFor === 'function') {
      actual = await sha256File(await sink.pathFor(cipherKey))
      egressBytes = typeof object.contentLength === 'number' ? object.contentLength : 0
    } else if (typeof sink.downloadTo === 'function') {
      const dest = join(ctx.workDir, `${Buffer.from(cipherKey).toString('hex').slice(0, 32)}.age`)
      await sink.downloadTo(cipherKey, dest)
      actual = await sha256File(dest)
      const stSize = typeof object.contentLength === 'number' ? object.contentLength : 0
      egressBytes = stSize
      await scrubFile(dest)
    } else {
      const buf = await sink.get(cipherKey)
      actual = sha256Buffer(buf)
      egressBytes = buf.byteLength
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      ...base,
      reason: 'ciphertext-read-error',
      hardError: true,
      error: msg,
      manifest: parsed.manifest,
      companions,
      egressBytes,
    }
  }

  if (actual.toLowerCase() !== expected) {
    return {
      ...base,
      reason: 'ciphertext-hash-mismatch',
      verification: 'full',
      egressBytes,
      manifest: parsed.manifest,
      companions,
    }
  }

  return {
    ...base,
    status: 'validated',
    reason: 'manifest-hash-ok',
    verification: 'full',
    egressBytes,
    manifest: parsed.manifest,
    companions,
  }
}

/**
 * @param {{
 *   get: Function,
 *   pathFor?: Function,
 *   downloadTo?: Function,
 * }} sink
 * @param {Array<{ key: string, createdAt: Date, fileId?: string, contentLength?: number }>} listed
 * @param {{
 *   workDir?: string,
 *   verifyMode?: VerifyMode,
 *   mustVerifyKeys?: Iterable<string>,
 * }} [opts]
 */
export async function classifyBackupInventory(sink, listed, opts = {}) {
  const ownedWork = opts.workDir ? null : await createWorkDir()
  const workDir = opts.workDir || ownedWork.dir
  await mkdir(workDir, { recursive: true, mode: 0o700 })
  const verifyMode = opts.verifyMode || 'hybrid'
  const mustVerifyKeys = new Set(opts.mustVerifyKeys || [])

  /** @type {Awaited<ReturnType<typeof classifyOneBackup>>[]} */
  const validated = []
  /** @type {Awaited<ReturnType<typeof classifyOneBackup>>[]} */
  const unvalidated = []
  let incomplete = false
  /** @type {string[]} */
  const hardErrors = []
  let egressBytes = 0

  try {
    for (const obj of listed) {
      const result = await classifyOneBackup(obj, sink, {
        workDir,
        verifyMode,
        mustVerifyKeys,
      })
      egressBytes += result.egressBytes || 0
      if (result.hardError) {
        incomplete = true
        hardErrors.push(`${result.key}:${result.reason}`)
      }
      if (result.status === 'validated') validated.push(result)
      else unvalidated.push(result)
    }
  } finally {
    if (ownedWork) await ownedWork.dispose()
  }

  const egressEstimate = estimateCiphertextEgressBytes(listed, {
    verifyMode,
    mustVerifyKeys,
  })

  return {
    validated,
    unvalidated,
    incomplete,
    hardErrors,
    fingerprint: inventoryFingerprint(listed),
    verifyMode,
    mustVerifyKeys: [...mustVerifyKeys],
    egressBytes,
    egressEstimate,
  }
}

/**
 * Stable fingerprint of a list inventory for concurrency checks.
 * @param {Array<{ key: string, fileId?: string, contentLength?: number, createdAt?: Date }>} listed
 */
export function inventoryFingerprint(listed) {
  const rows = listed
    .map((o) => {
      const created = o.createdAt instanceof Date ? o.createdAt.toISOString() : ''
      return `${o.key}\t${o.fileId || ''}\t${o.contentLength ?? ''}\t${created}`
    })
    .sort()
  return sha256Buffer(`${rows.join('\n')}\n`)
}

/**
 * Persist a small classification report (no ciphertext bytes).
 * @param {string} path
 * @param {Awaited<ReturnType<typeof classifyBackupInventory>>} classification
 */
export async function writeClassificationReport(path, classification) {
  const body = {
    validatedCount: classification.validated.length,
    unvalidatedCount: classification.unvalidated.length,
    incomplete: classification.incomplete,
    hardErrors: classification.hardErrors,
    fingerprint: classification.fingerprint,
    verifyMode: classification.verifyMode,
    egressBytes: classification.egressBytes,
    egressEstimate: classification.egressEstimate,
    unvalidated: classification.unvalidated.map((u) => ({
      key: u.key,
      reason: u.reason,
      verification: u.verification,
      createdAt: u.createdAt.toISOString(),
    })),
    validated: classification.validated.map((v) => ({
      key: v.key,
      createdAt: v.createdAt.toISOString(),
      reason: v.reason,
      verification: v.verification,
    })),
  }
  await writeFile(path, `${JSON.stringify(body, null, 2)}\n`, { mode: 0o600 })
  return body
}

/**
 * Require that a specific ciphertext was fully hash-validated.
 * @param {Awaited<ReturnType<typeof classifyBackupInventory>>} classification
 * @param {string} ciphertextKey
 */
export function assertNewObjectFullyValidated(classification, ciphertextKey) {
  if (classification.incomplete) {
    return {
      ok: false,
      reason: 'inventory-validation-incomplete',
      hardErrors: classification.hardErrors,
    }
  }
  const hit =
    classification.validated.find((o) => o.key === ciphertextKey) ||
    classification.unvalidated.find((o) => o.key === ciphertextKey)
  if (!hit) {
    return { ok: false, reason: 'new-object-missing-from-inventory', ciphertextKey }
  }
  if (hit.status !== 'validated') {
    return {
      ok: false,
      reason: 'new-object-unvalidated',
      ciphertextKey,
      detail: hit.reason,
    }
  }
  if (hit.verification !== 'full' || hit.reason !== 'manifest-hash-ok') {
    return {
      ok: false,
      reason: 'new-object-not-fully-hashed',
      ciphertextKey,
      verification: hit.verification,
      detail: hit.reason,
    }
  }
  return { ok: true, ciphertextKey, verification: hit.verification }
}

/** Exact reasons that indicate ciphertext/manifest/companion corruption or tampering. */
export const CORRUPTION_REASONS = Object.freeze([
  'ciphertext-hash-mismatch',
  'ciphertext-size-mismatch',
  'manifest-json-invalid',
  'manifest-kind-mismatch',
  'manifest-missing-ciphertext-hash',
  'manifest-ciphertext-hash-malformed',
  'manifest-missing-sealed-meta-hash',
  'manifest-sealed-meta-hash-malformed',
  'manifest-missing-counts-hash',
  'manifest-counts-hash-malformed',
  'manifest-missing-sealed-meta-key',
  'manifest-missing-counts-key',
  'manifest-exposes-rowCounts',
  'sealed-meta-missing',
  'sealed-meta-empty',
  'sealed-meta-size-mismatch',
  'sealed-meta-hash-mismatch',
  'counts-missing',
  'counts-empty',
  'counts-size-mismatch',
  'counts-hash-mismatch',
  'counts-parse-invalid',
])

/**
 * True when an unvalidated reason is corruption/tampering (including dynamic
 * `counts-parse-*` reasons from parseCountsDocument).
 * @param {unknown} reason
 */
export function isCorruptionReason(reason) {
  const r = String(reason || '')
  if (CORRUPTION_REASONS.includes(r)) return true
  // parseCountsDocument returns counts-parse-<detail>; treat all as corruption
  // so prune --apply fails closed instead of deleting around a bad companion.
  if (r === 'counts-parse-invalid' || r.startsWith('counts-parse-')) return true
  return false
}

/**
 * Summarize inventory health for operators and jobs.
 *
 * - `coverage: complete` only when verifyMode is `full` (every ciphertext hashed).
 * - `coverage: partial` for hybrid / manifest-size (lightweight checks on older objects).
 * - Corruption signals (hash/size/manifest parse failures) are an **operational
 *   failure** for the job that ran the check. There is **no** push/alert
 *   integration in this repository; operators must watch job exit codes / logs.
 * - Freshness monitoring (alert when the newest validated backup is older than
 *   N hours) is **not implemented** yet.
 *
 * @param {Awaited<ReturnType<typeof classifyBackupInventory>>} classification
 */
export function summarizeInventoryHealth(classification) {
  const coverage =
    classification.verifyMode === 'full'
      ? 'complete'
      : classification.verifyMode === 'hybrid'
        ? 'partial'
        : 'lightweight-only'

  const corruption = classification.unvalidated.filter((u) => isCorruptionReason(u.reason))
  const operationalFailure =
    classification.incomplete || corruption.length > 0

  return {
    coverage,
    verifyMode: classification.verifyMode,
    operationalFailure,
    incomplete: classification.incomplete,
    hardErrors: classification.hardErrors,
    corruptionCount: corruption.length,
    corruption: corruption.map((u) => ({ key: u.key, reason: u.reason })),
    validatedCount: classification.validated.length,
    unvalidatedCount: classification.unvalidated.length,
    monitoring: {
      inventoryCorruptionDetection: 'job-exit-code',
      pushAlerts: 'none-implemented',
      freshnessMonitoring: 'pending',
      freshnessNote:
        'No automated check yet that the newest validated backup is within an RPO window. Operators must inspect daily job success and object stamps until freshness monitoring exists.',
    },
  }
}

/**
 * Age-encrypted sidecar metadata for a backup object.
 *
 * The public `.manifest.json` stays readable for inventory/hybrid verify, but
 * row counts and the plaintext fingerprint that restore must compare are also
 * sealed to the same age recipients. Anyone who can rewrite the bucket can
 * still re-encrypt a forged sidecar (age does not authenticate the publisher);
 * this is confidentiality + restore cross-check, not publisher authentication.
 *
 * Encryption/decryption of the sidecar lives in pipeline.mjs to avoid import
 * cycles; this module only builds/parses/compares the JSON payload.
 */

import { sha256Buffer } from './integrity.mjs'

export const SEALED_META_KIND = 'palpitae-d1-backup-meta'
export const SEALED_META_VERSION = 1

/**
 * @param {{
 *   dbName: string,
 *   stamp: string,
 *   ciphertextKey: string,
 *   plaintextSha256: string,
 *   rowCounts: Record<string, number>,
 *   ageRecipientFingerprint: string,
 *   ageRecipientFingerprints?: string[],
 *   createdAtIso: string,
 * }} fields
 */
export function buildSealedMeta(fields) {
  const fingerprints =
    fields.ageRecipientFingerprints && fields.ageRecipientFingerprints.length > 0
      ? fields.ageRecipientFingerprints
      : [fields.ageRecipientFingerprint]
  return {
    version: SEALED_META_VERSION,
    kind: SEALED_META_KIND,
    dbName: fields.dbName,
    stamp: fields.stamp,
    createdAt: fields.createdAtIso,
    ciphertextKey: fields.ciphertextKey,
    plaintextSha256: fields.plaintextSha256,
    rowCounts: { ...fields.rowCounts },
    encryption: {
      tool: 'age',
      recipientFingerprint: fields.ageRecipientFingerprint,
      recipientFingerprints: fingerprints,
      recipientCount: fingerprints.length,
      note:
        'Sealed with age to the backup recipients. Confidentiality only — not an authenticated publisher proof. Compare rowCounts after decrypt/restore.',
    },
    consistencyLimits:
      'rowCounts are essential-table COUNTs after isolated SQLite import of this dump (with integrity_check + foreign_key_check). They do not prove partial truncation with non-zero COUNTs, cross-table transactional consistency beyond FK check, live-DB equality at a later instant, or publisher authenticity.',
  }
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, meta: any } | { ok: false, reason: string }}
 */
export function parseSealedMeta(raw) {
  let meta
  try {
    meta = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return { ok: false, reason: 'sealed-meta-json-invalid' }
  }
  if (!meta || typeof meta !== 'object') {
    return { ok: false, reason: 'sealed-meta-not-object' }
  }
  if (meta.kind !== SEALED_META_KIND) {
    return { ok: false, reason: 'sealed-meta-kind-mismatch' }
  }
  if (meta.version !== SEALED_META_VERSION) {
    return { ok: false, reason: 'sealed-meta-version-mismatch' }
  }
  if (!meta.rowCounts || typeof meta.rowCounts !== 'object') {
    return { ok: false, reason: 'sealed-meta-missing-row-counts' }
  }
  if (typeof meta.plaintextSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(meta.plaintextSha256)) {
    return { ok: false, reason: 'sealed-meta-plaintext-hash-malformed' }
  }
  return { ok: true, meta }
}

/**
 * @param {ReturnType<typeof buildSealedMeta>} meta
 */
export function sealedMetaBody(meta) {
  const body = `${JSON.stringify(meta, null, 2)}\n`
  return { body, sha256: sha256Buffer(body), bytes: Buffer.byteLength(body) }
}

/**
 * Compare restored DB counts to sealed meta counts.
 * @param {Record<string, number>} actual
 * @param {Record<string, number>} expected
 */
export function compareRowCounts(actual, expected) {
  /** @type {string[]} */
  const failures = []
  const keys = new Set([...Object.keys(actual), ...Object.keys(expected)])
  for (const table of keys) {
    const a = actual[table]
    const e = expected[table]
    if (a !== e) {
      failures.push(`${table}: restored=${a}, sealed=${e}`)
    }
  }
  return { ok: failures.length === 0, failures, actual, expected }
}

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'

/**
 * @param {Buffer | string} data
 * @returns {string} hex sha256
 */
export function sha256Buffer(data) {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export async function sha256File(filePath) {
  const hash = createHash('sha256')
  const stream = createReadStream(filePath)
  for await (const chunk of stream) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/**
 * Build an unencrypted manifest for a backup object.
 * Never includes private keys, tokens, plaintext dump contents, or cleartext
 * rowCounts (those live in age-sealed .meta.json.age; the next pack's
 * operational baseline is the separate unsigned .counts.json companion).
 *
 * Manifests are intentionally unsigned. age encrypts to recipients but does
 * not authenticate the publisher. Treat R2 ETag as transport
 * checks only, never as end-to-end authentication of backup bytes.
 *
 * @param {{
 *   dbName: string,
 *   stamp: string,
 *   ciphertextKey: string,
 *   sealedMetaKey: string,
 *   countsKey: string,
 *   ciphertextSha256: string,
 *   plaintextSha256: string,
 *   gzipSha256: string,
 *   sealedMetaSha256: string,
 *   countsSha256: string,
 *   plaintextBytes: number,
 *   gzipBytes: number,
 *   ciphertextBytes: number,
 *   sealedMetaBytes: number,
 *   countsBytes: number,
 *   ageRecipientFingerprint: string,
 *   ageRecipientFingerprints?: string[],
 *   ageRecipientCount?: number,
 *   source: string,
 *   createdAtIso: string,
 *   snapshotLimits?: string,
 * }} fields
 */
export function buildManifest(fields) {
  const fingerprints =
    fields.ageRecipientFingerprints && fields.ageRecipientFingerprints.length > 0
      ? fields.ageRecipientFingerprints
      : [fields.ageRecipientFingerprint]
  return {
    version: 1,
    kind: 'palpitae-d1-backup',
    dbName: fields.dbName,
    stamp: fields.stamp,
    createdAt: fields.createdAtIso,
    source: fields.source,
    ciphertextKey: fields.ciphertextKey,
    sealedMetaKey: fields.sealedMetaKey,
    countsKey: fields.countsKey,
    hashes: {
      plaintextSha256: fields.plaintextSha256,
      gzipSha256: fields.gzipSha256,
      ciphertextSha256: fields.ciphertextSha256,
      sealedMetaSha256: fields.sealedMetaSha256,
      countsSha256: fields.countsSha256,
    },
    sizes: {
      plaintextBytes: fields.plaintextBytes,
      gzipBytes: fields.gzipBytes,
      ciphertextBytes: fields.ciphertextBytes,
      sealedMetaBytes: fields.sealedMetaBytes,
      countsBytes: fields.countsBytes,
    },
    snapshotLimits:
      fields.snapshotLimits ||
      'Essential COUNT(*) after isolated import. Catastrophic-empty vs baseline and exact match vs source-counts only. Partial truncation inside a statement-complete dump is not proven. Unsigned companions are not publisher authentication.',
    encryption: {
      tool: 'age',
      recipientFingerprint: fields.ageRecipientFingerprint,
      recipientFingerprints: fingerprints,
      recipientCount: fields.ageRecipientCount ?? fingerprints.length,
      note:
        'Private identities are held by the operator outside this repository and outside CI. Manifest is unsigned; age provides confidentiality to recipients, not publisher authentication.',
    },
  }
}

/**
 * @param {string} manifestPath
 * @param {string} ciphertextPath
 */
export async function verifyManifestAgainstCiphertext(manifestPath, ciphertextPath) {
  const raw = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw)
  if (manifest.kind !== 'palpitae-d1-backup') {
    throw new Error(`unexpected manifest kind: ${manifest.kind}`)
  }
  const actual = await sha256File(ciphertextPath)
  if (actual !== manifest.hashes.ciphertextSha256) {
    throw new Error(
      `ciphertext sha256 mismatch: expected ${manifest.hashes.ciphertextSha256}, got ${actual}`,
    )
  }
  return manifest
}

/**
 * Short stable fingerprint of an age recipient string (public only).
 * @param {string} recipient
 */
export function recipientFingerprint(recipient) {
  return sha256Buffer(recipient.trim() + '\n').slice(0, 16)
}

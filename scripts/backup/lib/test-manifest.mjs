/**
 * Test helpers to build a complete unsigned manifest + companions.
 * Production packs use packAndStore; these helpers only feed inventory tests.
 */

import { buildManifest, sha256Buffer } from './integrity.mjs'
import { buildPublicCounts, publicCountsBody } from './counts-baseline.mjs'
import { SYNTHETIC_EXPECTATIONS } from './verify-sqlite.mjs'

/**
 * @param {{
 *   paths: { stamp: string, ciphertextKey: string, manifestKey: string, sealedMetaKey: string, countsKey: string },
 *   cipher: Buffer,
 *   createdAtIso: string,
 *   rowCounts?: Record<string, number>,
 *   ciphertextSha256?: string,
 *   source?: string,
 * }} opts
 */
export function buildTestArtifacts(opts) {
  const rowCounts = opts.rowCounts || { ...SYNTHETIC_EXPECTATIONS }
  const sealedBytes = Buffer.from(`sealed-meta-placeholder:${opts.paths.stamp}\n`)
  const counts = buildPublicCounts({
    dbName: 'palpitae',
    stamp: opts.paths.stamp,
    ciphertextKey: opts.paths.ciphertextKey,
    rowCounts,
    createdAtIso: opts.createdAtIso,
  })
  const { body: countsBody, sha256: countsSha256, bytes: countsBytes } = publicCountsBody(counts)
  const sealedMetaSha256 = sha256Buffer(sealedBytes)
  const manifest = buildManifest({
    dbName: 'palpitae',
    stamp: opts.paths.stamp,
    ciphertextKey: opts.paths.ciphertextKey,
    sealedMetaKey: opts.paths.sealedMetaKey,
    countsKey: opts.paths.countsKey,
    ciphertextSha256: opts.ciphertextSha256 || sha256Buffer(opts.cipher),
    plaintextSha256: sha256Buffer('p'),
    gzipSha256: sha256Buffer('g'),
    sealedMetaSha256,
    countsSha256,
    plaintextBytes: 1,
    gzipBytes: 1,
    ciphertextBytes: opts.cipher.byteLength,
    sealedMetaBytes: sealedBytes.byteLength,
    countsBytes,
    ageRecipientFingerprint: 'abcd',
    source: opts.source || 'test',
    createdAtIso: opts.createdAtIso,
  })
  return {
    manifest,
    sealedBytes,
    countsBody: Buffer.from(countsBody),
    counts,
  }
}

/**
 * @param {any} sink
 * @param {ReturnType<typeof buildTestArtifacts>} artifacts
 * @param {{ ciphertextKey: string, manifestKey: string, sealedMetaKey: string, countsKey: string }} paths
 * @param {Buffer} cipher
 */
export async function putTestBackup(sink, artifacts, paths, cipher) {
  await sink.put(paths.ciphertextKey, cipher)
  await sink.put(paths.manifestKey, `${JSON.stringify(artifacts.manifest)}\n`)
  await sink.put(paths.sealedMetaKey, artifacts.sealedBytes)
  await sink.put(paths.countsKey, artifacts.countsBody)
}

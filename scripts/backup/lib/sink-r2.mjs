/**
 * Cloudflare R2 sink (S3 API) that stores ciphertext + manifests under the same
 * key layout as the local sink. Deletes target objects by key from a fresh list —
 * never a local-only rm, and never a recursive "sync --delete" of an unrelated tree.
 */

import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { parseCiphertextKey } from './naming.mjs'
import { createR2Client, readR2Env } from './r2-client.mjs'

/**
 * @param {string} key
 */
function assertSafeKey(key) {
  const safe = key.replace(/^\/+/, '')
  if (!safe || safe.includes('..') || safe.split('/').some((p) => p === '.' || p === '')) {
    throw new Error(`refusing unsafe object key: ${key}`)
  }
  return safe
}

/**
 * @param {{
 *   client?: ReturnType<typeof createR2Client>,
 *   accountId?: string,
 *   bucketName?: string,
 *   namePrefix?: string,
 *   accessKeyId?: string,
 *   secretAccessKey?: string,
 *   endpoint?: string,
 *   fetchImpl?: typeof fetch,
 * }} [opts]
 */
export function createR2Sink(opts = {}) {
  const envCreds = opts.client ? null : readR2Env()
  const client =
    opts.client ||
    createR2Client({
      accountId: opts.accountId || envCreds.accountId,
      accessKeyId: opts.accessKeyId || envCreds.accessKeyId,
      secretAccessKey: opts.secretAccessKey || envCreds.secretAccessKey,
      bucketName: opts.bucketName || envCreds.bucketName,
      namePrefix: opts.namePrefix ?? envCreds.namePrefix,
      endpoint: opts.endpoint || envCreds.endpoint,
      fetchImpl: opts.fetchImpl,
    })

  /** @type {Map<string, string>} fileName → fileId/etag from last list/put */
  const fileIds = new Map()

  return {
    kind: 'r2',
    client,

    /**
     * @param {string} key
     * @param {Buffer | string | { path: string, contentType?: string }} body
     */
    async put(key, body) {
      const fileName = assertSafeKey(key)
      let uploaded
      if (body && typeof body === 'object' && 'path' in body) {
        uploaded = await client.uploadFile({
          fileName,
          path: body.path,
          contentType: body.contentType,
        })
      } else {
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8')
        uploaded = await client.uploadFile({
          fileName,
          body: buf,
          contentType: fileName.endsWith('.json') ? 'application/json' : 'application/octet-stream',
        })
      }
      fileIds.set(uploaded.fileName, uploaded.etag || uploaded.fileName)
      return uploaded
    },

    /**
     * @param {string} key
     */
    async get(key) {
      const fileName = assertSafeKey(key)
      return client.downloadFileByName(fileName)
    },

    /**
     * @param {string} key
     * @param {string} destPath
     */
    async downloadTo(key, destPath) {
      const fileName = assertSafeKey(key)
      if (typeof client.downloadFileByNameToPath === 'function') {
        return client.downloadFileByNameToPath(fileName, destPath)
      }
      const buf = await client.downloadFileByName(fileName)
      await mkdir(dirname(destPath), { recursive: true, mode: 0o700 })
      await writeFile(destPath, buf, { mode: 0o600 })
      return destPath
    },

    /**
     * @param {{ prefix?: string, dbName: string }} listOpts
     */
    async listBackups({ prefix = '', dbName }) {
      const basePrefix = prefix.replace(/\/+$/, '')
      const rel = [basePrefix, 'd1', dbName].filter(Boolean).join('/')
      const listed = await client.listFileNames({ prefix: rel ? `${rel}/` : '' })
      fileIds.clear()
      for (const f of listed) fileIds.set(f.fileName, f.fileId)

      return listed
        .filter((f) => f.fileName.endsWith('.sql.gz.age'))
        .map((f) => {
          const parsed = parseCiphertextKey(f.fileName, basePrefix)
          if (!parsed) return null
          return {
            key: parsed.key,
            createdAt: parsed.createdAt,
            fileId: f.fileId,
            contentLength: f.contentLength,
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.createdAt - a.createdAt)
    },

    /**
     * Delete ciphertext (+ companions) on R2.
     * @param {string[]} keys
     * @param {{ apply: boolean }} deleteOpts
     */
    async deleteKeys(keys, { apply }) {
      const deleted = []
      const skipped = []
      for (const key of keys) {
        const fileName = assertSafeKey(key)
        if (!parseCiphertextKey(fileName)) {
          skipped.push({ key: fileName, reason: 'unrecognized-name' })
          continue
        }
        const manifestKey = fileName.replace(/\.sql\.gz\.age$/, '.manifest.json')
        const sealedMetaKey = fileName.replace(/\.sql\.gz\.age$/, '.meta.json.age')
        const countsKey = fileName.replace(/\.sql\.gz\.age$/, '.counts.json')
        if (!apply) {
          deleted.push({ key: fileName, dryRun: true, sink: 'r2' })
          continue
        }

        const alsoDeleted = []
        const tipId = fileIds.get(fileName)
        if (!tipId) {
          // Refresh tip via list for this exact key
          const listed = await client.listFileNames({ prefix: fileName })
          const hit = listed.find((f) => f.fileName === fileName)
          if (!hit) {
            skipped.push({ key: fileName, reason: 'missing-file-id-refresh-list' })
            continue
          }
          fileIds.set(fileName, hit.fileId)
        }

        await client.deleteFileVersion({ fileName, fileId: fileIds.get(fileName) })
        fileIds.delete(fileName)

        for (const companion of [manifestKey, sealedMetaKey, countsKey]) {
          const listed = await client.listFileNames({ prefix: companion })
          const hit = listed.find((f) => f.fileName === companion)
          if (hit) {
            await client.deleteFileVersion({ fileName: companion, fileId: hit.fileId })
            alsoDeleted.push(companion)
            fileIds.delete(companion)
          }
        }

        deleted.push({
          key: fileName,
          dryRun: false,
          sink: 'r2',
          versionsDeleted: 1,
          alsoDeleted: [...new Set(alsoDeleted)],
        })
      }
      return { deleted, skipped }
    },
  }
}

/**
 * @param {string} dest
 * @param {Buffer} buf
 */
export async function writeBufferFile(dest, buf) {
  await mkdir(dirname(dest), { recursive: true, mode: 0o700 })
  await pipeline(Readable.from(buf), createWriteStream(dest, { mode: 0o600 }))
}

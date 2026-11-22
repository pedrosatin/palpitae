import { copyFile, chmod, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parseCiphertextKey } from './naming.mjs'

/**
 * Local filesystem sink that mirrors the R2 object key layout.
 * Used for synthetic rehearsals and offline verification. Never talks to R2.
 * Local deletes do not affect R2 — prune the R2 sink separately when that is
 * the system of record.
 */
export function createLocalSink(rootDir) {
  async function resolve(key) {
    const safe = key.replace(/^\/+/, '')
    if (safe.includes('..') || safe.split('/').some((p) => p === '.')) {
      throw new Error(`refusing path traversal in key: ${key}`)
    }
    return join(rootDir, safe)
  }

  return {
    kind: 'local',
    rootDir,

    /**
     * Atomic put: write to .partial then rename.
     * Accepts Buffer/string or { path } so callers can avoid re-buffering large dumps.
     * @param {string} key
     * @param {Buffer | string | { path: string }} body
     */
    async put(key, body) {
      const dest = await resolve(key)
      await mkdir(dirname(dest), { recursive: true, mode: 0o700 })
      const partial = `${dest}.partial`
      if (body && typeof body === 'object' && 'path' in body) {
        await copyFile(body.path, partial)
        await chmod(partial, 0o600)
      } else {
        await writeFile(partial, body, { mode: 0o600 })
      }
      await rename(partial, dest)
      await chmod(dest, 0o600)
      return dest
    },

    /**
     * @param {string} key
     */
    async get(key) {
      return readFile(await resolve(key))
    },

    /**
     * @param {string} key
     */
    async pathFor(key) {
      return resolve(key)
    },

    /**
     * List ciphertext objects under prefix/d1/dbName.
     * @param {{ prefix?: string, dbName: string }} opts
     */
    async listBackups({ prefix = '', dbName }) {
      const basePrefix = prefix.replace(/\/+$/, '')
      const rel = [basePrefix, 'd1', dbName].filter(Boolean).join('/')
      const baseDir = join(rootDir, rel)
      /** @type {string[]} */
      const keys = []
      async function walk(dir, relParts) {
        let entries
        try {
          entries = await readdir(dir, { withFileTypes: true })
        } catch (err) {
          if (err && err.code === 'ENOENT') return
          throw err
        }
        for (const entry of entries) {
          const nextRel = [...relParts, entry.name]
          const full = join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(full, nextRel)
          } else if (entry.isFile() && entry.name.endsWith('.sql.gz.age')) {
            keys.push(nextRel.join('/'))
          }
        }
      }
      await walk(baseDir, rel.split('/').filter(Boolean))
      /** @type {Array<{ key: string, createdAt: Date, contentLength: number }>} */
      const out = []
      for (const key of keys) {
        const parsed = parseCiphertextKey(key, basePrefix)
        if (!parsed) continue
        const info = await stat(join(rootDir, key))
        out.push({
          key: parsed.key,
          createdAt: parsed.createdAt,
          contentLength: info.size,
        })
      }
      return out.sort((a, b) => b.createdAt - a.createdAt)
    },

    /**
     * Delete only keys that already matched our naming parser.
     * @param {string[]} keys
     * @param {{ apply: boolean }} opts
     */
    async deleteKeys(keys, { apply }) {
      const deleted = []
      const skipped = []
      for (const key of keys) {
        if (!parseCiphertextKey(key)) {
          skipped.push({ key, reason: 'unrecognized-name' })
          continue
        }
        const manifestKey = key.replace(/\.sql\.gz\.age$/, '.manifest.json')
        const sealedMetaKey = key.replace(/\.sql\.gz\.age$/, '.meta.json.age')
        const countsKey = key.replace(/\.sql\.gz\.age$/, '.counts.json')
        if (!apply) {
          deleted.push({ key, dryRun: true, sink: 'local' })
          continue
        }
        await rm(await resolve(key), { force: true })
        await rm(await resolve(manifestKey), { force: true })
        await rm(await resolve(sealedMetaKey), { force: true })
        await rm(await resolve(countsKey), { force: true })
        deleted.push({
          key,
          dryRun: false,
          sink: 'local',
          alsoDeleted: [manifestKey, sealedMetaKey, countsKey],
        })
      }
      return { deleted, skipped }
    },
  }
}

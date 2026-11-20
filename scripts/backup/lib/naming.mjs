/**
 * Object naming for independent D1 backups.
 *
 * Layout under the configured prefix:
 *   {prefix}/d1/{dbName}/{YYYY}/{MM}/{DD}/{dbName}-d1-{ISO_COMPACT}.sql.gz.age
 *   {prefix}/d1/{dbName}/{YYYY}/{MM}/{DD}/{dbName}-d1-{ISO_COMPACT}.manifest.json
 *   {prefix}/d1/{dbName}/{YYYY}/{MM}/{DD}/{dbName}-d1-{ISO_COMPACT}.meta.json.age
 *   {prefix}/d1/{dbName}/{YYYY}/{MM}/{DD}/{dbName}-d1-{ISO_COMPACT}.counts.json
 *
 * The ISO stamp is UTC (YYYYMMDDTHHMMSSZ). Manifests are unencrypted metadata
 * (sizes, hashes, labels) without cleartext rowCounts. Ciphertext lives in the
 * .sql.gz.age object. Sealed row-count metadata lives in the .meta.json.age
 * sidecar (same recipients). Public `.counts.json` is an unsigned operational
 * baseline for the next pack (CI has no age identity).
 */

const OBJECT_RE =
  /^(?<prefix>.+\/)?d1\/(?<db>[^/]+)\/(?<y>\d{4})\/(?<m>\d{2})\/(?<d>\d{2})\/(?<db2>[^/]+)-d1-(?<stamp>\d{8}T\d{6}Z)\.sql\.gz\.age$/

/**
 * @param {Date} date
 * @returns {string} YYYYMMDDTHHMMSSZ
 */
export function toCompactUtc(date = new Date()) {
  const iso = date.toISOString()
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

/**
 * @param {string} stamp YYYYMMDDTHHMMSSZ
 * @returns {Date}
 */
export function fromCompactUtc(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp)
  if (!m) throw new Error(`invalid compact UTC stamp: ${stamp}`)
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`)
}

/**
 * @param {{ prefix?: string, dbName: string, createdAt?: Date }} opts
 */
export function buildObjectPaths({ prefix = '', dbName, createdAt = new Date() }) {
  const stamp = toCompactUtc(createdAt)
  const y = stamp.slice(0, 4)
  const mo = stamp.slice(4, 6)
  const d = stamp.slice(6, 8)
  const basePrefix = prefix.replace(/\/+$/, '')
  const dir = [basePrefix, 'd1', dbName, y, mo, d].filter(Boolean).join('/')
  const stem = `${dbName}-d1-${stamp}`
  return {
    stamp,
    ciphertextKey: `${dir}/${stem}.sql.gz.age`,
    manifestKey: `${dir}/${stem}.manifest.json`,
    sealedMetaKey: `${dir}/${stem}.meta.json.age`,
    countsKey: `${dir}/${stem}.counts.json`,
  }
}

/**
 * Companion keys for a ciphertext object key.
 * @param {string} ciphertextKey
 */
export function companionKeys(ciphertextKey) {
  if (!ciphertextKey.endsWith('.sql.gz.age')) {
    throw new Error(`not a ciphertext key: ${ciphertextKey}`)
  }
  const stem = ciphertextKey.slice(0, -'.sql.gz.age'.length)
  return {
    manifestKey: `${stem}.manifest.json`,
    sealedMetaKey: `${stem}.meta.json.age`,
    countsKey: `${stem}.counts.json`,
  }
}

/**
 * @param {string} key
 * @param {string} [expectedPrefix]
 * @returns {null | { dbName: string, stamp: string, createdAt: Date, key: string }}
 */
export function parseCiphertextKey(key, expectedPrefix = '') {
  const normalized = key.replace(/^\/+/, '')
  if (normalized.split('/').some((part) => part === '..' || part === '.')) return null
  const match = OBJECT_RE.exec(normalized)
  if (!match || !match.groups) return null
  if (match.groups.db !== match.groups.db2) return null
  const keyPrefix = (match.groups.prefix ?? '').replace(/\/+$/, '')
  const want = expectedPrefix.replace(/\/+$/, '')
  if (want && keyPrefix !== want) return null
  return {
    dbName: match.groups.db,
    stamp: match.groups.stamp,
    createdAt: fromCompactUtc(match.groups.stamp),
    key: normalized,
  }
}

/**
 * Minimal Cloudflare R2 client via the S3-compatible API (SigV4).
 *
 * No AWS SDK. Credentials never logged. Fetch is injectable for simulated tests.
 * Endpoint: https://<accountId>.r2.cloudflarestorage.com
 * Region fixed to "auto" (R2 requirement).
 */

import { createHash, createHmac } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'

const REGION = 'auto'
const SERVICE = 's3'

/**
 * @param {Buffer | string} data
 */
export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * @param {string} filePath
 */
export async function sha256File(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

/**
 * @param {string} key
 * @param {Buffer | string} msg
 */
function hmac(key, msg) {
  return createHmac('sha256', key).update(msg, typeof msg === 'string' ? 'utf8' : undefined).digest()
}

/**
 * @param {string} secret
 * @param {string} dateStamp YYYYMMDD
 */
function getSigningKey(secret, dateStamp) {
  const kDate = hmac(`AWS4${secret}`, dateStamp)
  const kRegion = hmac(kDate, REGION)
  const kService = hmac(kRegion, SERVICE)
  return hmac(kService, 'aws4_request')
}

/**
 * Percent-encode a path segment for S3 canonical URI (RFC 3986, slash preserved between segments).
 * @param {string} key
 */
export function encodeS3Key(key) {
  return key
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`),
    )
    .join('/')
}

/**
 * @typedef {{
 *   accountId: string,
 *   accessKeyId: string,
 *   secretAccessKey: string,
 *   bucketName: string,
 *   namePrefix?: string,
 *   endpoint?: string,
 *   fetchImpl?: typeof fetch,
 * }} R2ClientOptions
 */

/**
 * @param {R2ClientOptions} opts
 */
export function createR2Client(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable; pass fetchImpl for tests or use Node >= 18')
  }
  if (!opts.accountId) throw new Error('R2 accountId is required')
  if (!opts.accessKeyId || !opts.secretAccessKey) {
    throw new Error('R2 accessKeyId and secretAccessKey are required')
  }
  if (!opts.bucketName) throw new Error('R2 bucketName is required')

  const endpoint = (opts.endpoint || `https://${opts.accountId}.r2.cloudflarestorage.com`).replace(
    /\/+$/,
    '',
  )
  const host = new URL(endpoint).host

  /**
   * @param {string} message
   * @param {number} [status]
   * @param {unknown} [body]
   */
  function apiError(message, status, body) {
    const err = /** @type {Error & { status?: number, body?: unknown }} */ (new Error(message))
    err.name = 'R2ApiError'
    err.status = status
    err.body = body
    return err
  }

  /**
   * @param {{
   *   method: string,
   *   key?: string,
   *   query?: Record<string, string>,
   *   headers?: Record<string, string>,
   *   body?: Buffer | string | null,
   *   unsignedPayload?: boolean,
   * }} req
   */
  async function signedFetch(req) {
    const method = req.method.toUpperCase()
    const keyPath = req.key ? `/${opts.bucketName}/${encodeS3Key(req.key)}` : `/${opts.bucketName}`
    const query = req.query || {}
    const qs = Object.keys(query)
      .sort()
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
      .join('&')
    const url = `${endpoint}${keyPath}${qs ? `?${qs}` : ''}`

    const now = new Date()
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const dateStamp = amzDate.slice(0, 8)

    const payloadHash = req.unsignedPayload
      ? 'UNSIGNED-PAYLOAD'
      : sha256Hex(req.body == null ? '' : req.body)

    /** @type {Record<string, string>} */
    const headers = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...req.headers,
    }
    if (req.body != null && !headers['content-type'] && !headers['Content-Type']) {
      headers['content-type'] = 'application/octet-stream'
    }
    if (req.body != null && Buffer.isBuffer(req.body)) {
      headers['content-length'] = String(req.body.byteLength)
    }

    const signedHeaderNames = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .sort()
    const canonicalHeaders = signedHeaderNames
      .map((name) => {
        const raw = headers[name] ?? headers[Object.keys(headers).find((k) => k.toLowerCase() === name) || '']
        return `${name}:${String(raw).trim()}`
      })
      .join('\n')
    const signedHeaders = signedHeaderNames.join(';')

    const canonicalRequest = [
      method,
      keyPath,
      qs,
      `${canonicalHeaders}\n`,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const credentialScope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n')

    const signature = createHmac('sha256', getSigningKey(opts.secretAccessKey, dateStamp))
      .update(stringToSign, 'utf8')
      .digest('hex')

    headers.authorization = `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    const res = await fetchImpl(url, {
      method,
      headers,
      body: req.body == null ? undefined : req.body,
    })
    return res
  }

  /**
   * @param {{
   *   fileName: string,
   *   path?: string,
   *   body?: Buffer,
   *   contentType?: string,
   * }} upload
   */
  async function uploadFile(upload) {
    let body
    if (upload.path) {
      body = await readFile(upload.path)
    } else if (upload.body) {
      body = upload.body
    } else {
      throw new Error('uploadFile requires path or body')
    }
    const res = await signedFetch({
      method: 'PUT',
      key: upload.fileName,
      headers: {
        'content-type': upload.contentType || 'application/octet-stream',
      },
      body,
    })
    if (!res.ok) {
      const text = await res.text()
      throw apiError(`R2 PutObject failed (${res.status}) for ${upload.fileName}`, res.status, text)
    }
    return {
      fileName: upload.fileName,
      contentLength: body.byteLength,
      etag: res.headers.get('etag') || '',
    }
  }

  /**
   * @param {string} fileName
   */
  async function downloadFileByName(fileName) {
    const res = await signedFetch({ method: 'GET', key: fileName, body: null })
    if (!res.ok) {
      const text = await res.text()
      throw apiError(`R2 GetObject failed (${res.status}) for ${fileName}`, res.status, text)
    }
    return Buffer.from(await res.arrayBuffer())
  }

  /**
   * @param {string} fileName
   * @param {string} destPath
   */
  async function downloadFileByNameToPath(fileName, destPath) {
    const { createWriteStream } = await import('node:fs')
    const { mkdir } = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    const { pipeline } = await import('node:stream/promises')
    const { Readable } = await import('node:stream')

    const res = await signedFetch({ method: 'GET', key: fileName, body: null })
    if (!res.ok) {
      const text = await res.text()
      throw apiError(`R2 GetObject failed (${res.status}) for ${fileName}`, res.status, text)
    }
    await mkdir(dirname(destPath), { recursive: true, mode: 0o700 })
    const nodeStream =
      res.body && typeof Readable.fromWeb === 'function'
        ? Readable.fromWeb(/** @type {any} */ (res.body))
        : Readable.from(Buffer.from(await res.arrayBuffer()))
    await pipeline(nodeStream, createWriteStream(destPath, { mode: 0o600 }))
    return destPath
  }

  /**
   * @param {{ prefix?: string, maxKeys?: number, continuationToken?: string }} [listOpts]
   */
  async function listObjects(listOpts = {}) {
    const prefix = listOpts.prefix ?? opts.namePrefix ?? ''
    /** @type {Array<{ fileName: string, contentLength: number, lastModified: string, etag: string }>} */
    const files = []
    let continuationToken = listOpts.continuationToken
    for (;;) {
      /** @type {Record<string, string>} */
      const query = {
        'list-type': '2',
        'max-keys': String(listOpts.maxKeys || 1000),
      }
      if (prefix) query.prefix = prefix
      if (continuationToken) query['continuation-token'] = continuationToken

      const res = await signedFetch({ method: 'GET', query, body: null })
      const text = await res.text()
      if (!res.ok) {
        throw apiError(`R2 ListObjectsV2 failed (${res.status})`, res.status, text)
      }
      const contents = [...text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)]
      for (const m of contents) {
        const block = m[1]
        const key = block.match(/<Key>([^<]*)<\/Key>/)?.[1]
        if (!key) continue
        const size = Number(block.match(/<Size>([^<]*)<\/Size>/)?.[1] || 0)
        const lastModified = block.match(/<LastModified>([^<]*)<\/LastModified>/)?.[1] || ''
        const etag = (block.match(/<ETag>([^<]*)<\/ETag>/)?.[1] || '').replace(/&quot;/g, '"')
        files.push({
          fileName: decodeXml(key),
          contentLength: size,
          lastModified,
          etag,
        })
      }
      const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(text)
      const next = text.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/)?.[1]
      if (!truncated || !next) break
      continuationToken = decodeXml(next)
    }
    return files
  }

  /**
   * Alias matching the B2-shaped surface used by the sink.
   * @param {{ prefix?: string }} [listOpts]
   */
  async function listFileNames(listOpts = {}) {
    const listed = await listObjects(listOpts)
    return listed.map((f) => ({
      fileName: f.fileName,
      fileId: f.etag || f.fileName,
      contentLength: f.contentLength,
      uploadTimestamp: f.lastModified ? Date.parse(f.lastModified) : 0,
      contentSha1: '',
    }))
  }

  /**
   * R2 does not version by default like B2; return the tip as a single "version".
   * @param {{ prefix?: string }} [listOpts]
   */
  async function listFileVersions(listOpts = {}) {
    const listed = await listFileNames(listOpts)
    return listed.map((f) => ({ ...f, action: 'upload' }))
  }

  /**
   * @param {{ fileName: string, fileId?: string }} target
   */
  async function deleteFileVersion(target) {
    const res = await signedFetch({ method: 'DELETE', key: target.fileName, body: null })
    if (!res.ok && res.status !== 204) {
      const text = await res.text()
      throw apiError(`R2 DeleteObject failed (${res.status}) for ${target.fileName}`, res.status, text)
    }
    return { fileName: target.fileName, fileId: target.fileId || '' }
  }

  return {
    uploadFile,
    downloadFileByName,
    downloadFileByNameToPath,
    listObjects,
    listFileNames,
    listFileVersions,
    deleteFileVersion,
    getSessionPublic() {
      return {
        accountId: opts.accountId,
        endpoint,
        bucketName: opts.bucketName,
        allowedNamePrefix: opts.namePrefix || null,
      }
    },
  }
}

/**
 * @param {string} s
 */
function decodeXml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/**
 * Read R2 credentials from the environment. Never prints values.
 *
 * Roles:
 * - `daily` (default): R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY — Object Read & Write
 *   on the dedicated backups bucket (R2 scopes tokens per bucket, not prefix). Used by
 *   pack/CI. A compromised key can overwrite and delete objects; bucket lock rules
 *   are the mitigation.
 * - `prune`: prefers R2_PRUNE_ACCESS_KEY_ID / R2_PRUNE_SECRET_ACCESS_KEY for apply deletes.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @param {{ role?: 'daily' | 'prune', allowDailyFallback?: boolean }} [opts]
 */
export function readR2Env(env = process.env, opts = {}) {
  const role = opts.role || 'daily'
  const accountId = env.R2_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID || ''
  const bucketName = env.R2_BUCKET || env.R2_BUCKET_NAME || ''
  const namePrefix = env.R2_NAME_PREFIX || env.R2_PREFIX || ''
  const endpoint = env.R2_ENDPOINT || ''

  if (role === 'prune') {
    const pruneId = env.R2_PRUNE_ACCESS_KEY_ID || ''
    const pruneKey = env.R2_PRUNE_SECRET_ACCESS_KEY || ''
    if (pruneId && pruneKey) {
      return {
        role: 'prune',
        accountId,
        accessKeyId: pruneId,
        secretAccessKey: pruneKey,
        bucketName: bucketName || undefined,
        namePrefix: namePrefix || undefined,
        endpoint: endpoint || undefined,
      }
    }
    if (!opts.allowDailyFallback) {
      throw new Error(
        'prune apply requires R2_PRUNE_ACCESS_KEY_ID and R2_PRUNE_SECRET_ACCESS_KEY (separate from daily CI keys)',
      )
    }
  }

  const accessKeyId = env.R2_ACCESS_KEY_ID || ''
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY || ''
  return {
    role: role === 'prune' ? 'prune-fallback-daily' : 'daily',
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName: bucketName || undefined,
    namePrefix: namePrefix || undefined,
    endpoint: endpoint || undefined,
  }
}

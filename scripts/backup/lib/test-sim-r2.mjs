/**
 * In-memory R2 (S3 API) simulator for unit tests. No network, no real account.
 */
import { createHash } from 'node:crypto'

/**
 * @param {object} [options]
 */
export function createSimulatedR2(options = {}) {
  /** @type {Map<string, { body: Buffer, lastModified: string, etag: string }>} */
  const objects = new Map()
  const accountId = options.accountId || 'sim-account'
  const bucketName = options.bucketName || 'sim-bucket'
  const endpoint = options.endpoint || `https://${accountId}.r2.cloudflarestorage.com`
  /** @type {{ putCalls: number, downloadStatusByName: Map<string, number>, authFailOnce: boolean, listFailStatus: number | null }} */
  const state = {
    putCalls: 0,
    downloadStatusByName: new Map(
      options.downloadStatusByName instanceof Map
        ? options.downloadStatusByName
        : Object.entries(options.downloadStatusByName || {}),
    ),
    authFailOnce: Boolean(options.authFailOnce),
    listFailStatus: options.listFailStatus ?? null,
  }

  function etagFor(buf) {
    return `"${createHash('md5').update(buf).digest('hex')}"`
  }

  function xmlEscape(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  /** @type {typeof fetch} */
  async function fetchImpl(url, init = {}) {
    const u = new URL(String(url))
    const method = (init.method || 'GET').toUpperCase()
    const auth = String(init.headers?.authorization || init.headers?.Authorization || '')

    if (state.authFailOnce) {
      state.authFailOnce = false
      return new Response('Forbidden', { status: 403 })
    }
    if (!auth.includes('AWS4-HMAC-SHA256')) {
      return new Response('Unauthorized', { status: 401 })
    }

    // Path: /bucket/key...
    const parts = u.pathname.replace(/^\/+/, '').split('/')
    const bucket = decodeURIComponent(parts[0] || '')
    const key = parts.slice(1).map((p) => decodeURIComponent(p)).join('/')

    if (bucket !== bucketName) {
      return new Response(`NoSuchBucket ${bucket}`, { status: 404 })
    }

    if (method === 'PUT' && key) {
      state.putCalls += 1
      let bodyBuf
      if (Buffer.isBuffer(init.body)) bodyBuf = init.body
      else if (typeof init.body === 'string') bodyBuf = Buffer.from(init.body)
      else bodyBuf = Buffer.alloc(0)
      const etag = etagFor(bodyBuf)
      objects.set(key, {
        body: bodyBuf,
        lastModified: new Date().toISOString(),
        etag,
      })
      return new Response(null, { status: 200, headers: { etag } })
    }

    if (method === 'GET' && !key && u.searchParams.get('list-type') === '2') {
      if (typeof state.listFailStatus === 'number') {
        const status = state.listFailStatus
        state.listFailStatus = null
        return new Response('service unavailable', { status })
      }
      const prefix = u.searchParams.get('prefix') || ''
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort()
      const contents = keys
        .map((k) => {
          const o = objects.get(k)
          return `<Contents><Key>${xmlEscape(k)}</Key><Size>${o.body.byteLength}</Size><LastModified>${o.lastModified}</LastModified><ETag>${xmlEscape(o.etag)}</ETag></Contents>`
        })
        .join('')
      const xml = `<?xml version="1.0"?><ListBucketResult><Name>${xmlEscape(bucketName)}</Name><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`
      return new Response(xml, { status: 200, headers: { 'Content-Type': 'application/xml' } })
    }

    if (method === 'GET' && key) {
      const forced = state.downloadStatusByName.get(key)
      if (typeof forced === 'number' && forced !== 200) {
        return new Response(`forced ${forced}`, { status: forced })
      }
      const o = objects.get(key)
      if (!o) return new Response('NoSuchKey', { status: 404 })
      return new Response(o.body, { status: 200, headers: { etag: o.etag } })
    }

    if (method === 'DELETE' && key) {
      objects.delete(key)
      return new Response(null, { status: 204 })
    }

    return new Response(`not found ${method} ${u.pathname}`, { status: 404 })
  }

  return {
    fetchImpl,
    objects,
    bucketName,
    accountId,
    endpoint,
    state,
    accessKeyId: 'sim-access',
    secretAccessKey: 'sim-secret',
  }
}

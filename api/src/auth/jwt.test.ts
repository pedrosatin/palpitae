import { describe, expect, it } from 'vitest'
import { importHmacKey, HMAC_SHA256 } from './crypto'
import { base64UrlEncode } from './encoding'
import { signJwt, verifyJwt } from './jwt'

const SECRET = 'test-secret-for-unit-tests-only'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** Troca o bit mais baixo do último caractere, que não entra nos bytes quando há sobra. */
function flipLowBit(segment: string): string {
  return `${segment.slice(0, -1)}${ALPHABET[ALPHABET.indexOf(segment.at(-1)!) ^ 1]}`
}

/** Com `-` ou `_` na assinatura, a troca de alfabeto muda o texto do token. */
async function tokenWithUrlSafeSignature(): Promise<string> {
  for (let attempt = 0; attempt < 500; attempt++) {
    const token = await signJwt(
      { sub: 'user-1', email: 'a@b.com', jti: `${attempt}` },
      SECRET,
      3600,
    )
    if (/[-_]/.test(token.slice(token.lastIndexOf('.') + 1))) return token
  }
  throw new Error('nenhuma assinatura com - ou _ em 500 tentativas')
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer)
}

/** Assina `header.body` como estiver escrito, com a chave certa. */
async function signRaw(header: string, body: string): Promise<string> {
  const key = await importHmacKey(SECRET)
  const input = new TextEncoder().encode(`${header}.${body}`)
  return `${header}.${body}.${base64UrlEncode(await crypto.subtle.sign(HMAC_SHA256, key, input))}`
}

describe('signJwt', () => {
  it('produces a 3-part dot-separated JWT', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, 3600)
    expect(token.split('.')).toHaveLength(3)
  })

  it('encodes sub and email in the payload', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, 3600)
    const [, body] = token.split('.')
    const payload = JSON.parse(atob(body!.replace(/-/g, '+').replace(/_/g, '/')))
    expect(payload.sub).toBe('user-1')
    expect(payload.email).toBe('a@b.com')
  })
})

describe('verifyJwt', () => {
  it('returns the payload for a valid token', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, 3600)
    const payload = await verifyJwt(token, SECRET)
    expect(payload.sub).toBe('user-1')
    expect(payload.email).toBe('a@b.com')
  })

  it('throws for a token signed with a different secret', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, 3600)
    await expect(verifyJwt(token, 'wrong-secret')).rejects.toThrow('Invalid JWT signature')
  })

  it('throws for a tampered payload', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, 3600)
    const [h, , s] = token.split('.')
    const tamperedBody = btoa(
      JSON.stringify({
        sub: 'attacker',
        email: 'evil@x.com',
        iat: 0,
        exp: 9999999999,
      }),
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
    await expect(verifyJwt(`${h}.${tamperedBody}.${s}`, SECRET)).rejects.toThrow()
  })

  it('throws for an expired token', async () => {
    const token = await signJwt({ sub: 'user-1', email: 'a@b.com' }, SECRET, -1)
    await expect(verifyJwt(token, SECRET)).rejects.toThrow('JWT expired')
  })

  it('throws for a malformed token', async () => {
    await expect(verifyJwt('not.a.valid.jwt', SECRET)).rejects.toThrow('Invalid JWT format')
  })

  it('aceita os tokens do signJwt com payload de qualquer tamanho', async () => {
    // Os três restos do tamanho do payload por 3 cobrem os três finais de base64url.
    for (const sub of ['u', 'us', 'use', 'user', 'user-', 'user-1']) {
      const token = await signJwt({ sub, email: 'a@b.com', jti: crypto.randomUUID() }, SECRET, 3600)
      await expect(verifyJwt(token, SECRET)).resolves.toMatchObject({ sub })
    }
  })

  it.each([
    ['`=` no fim', (sig: string) => `${sig}=`],
    ['bits de sobra no último caractere', flipLowBit],
    ['alfabeto `+` e `/`', (sig: string) => sig.replace(/-/g, '+').replace(/_/g, '/')],
    ['espaço interno', (sig: string) => `${sig.slice(0, 10)} ${sig.slice(10)}`],
  ])('recusa assinatura válida reescrita com %s', async (_name, rewrite) => {
    const token = await tokenWithUrlSafeSignature()
    const cut = token.lastIndexOf('.') + 1
    const rewritten = `${token.slice(0, cut)}${rewrite(token.slice(cut))}`
    expect(rewritten).not.toBe(token)

    await expect(verifyJwt(token, SECRET)).resolves.toMatchObject({ sub: 'user-1' })
    await expect(verifyJwt(rewritten, SECRET)).rejects.toThrow('Invalid JWT encoding')
  })

  it('recusa header ou payload reescrito mesmo quando a assinatura confere', async () => {
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' })
    // 49 bytes de payload: o base64url termina com 4 bits de sobra.
    const body = encodeJson({ sub: 'user-1', email: 'a@b.c', exp: 9999999999 })
    expect(body.length % 4).toBe(2)
    await expect(verifyJwt(await signRaw(header, body), SECRET)).resolves.toMatchObject({
      sub: 'user-1',
    })

    for (const [rewrittenHeader, rewrittenBody] of [
      [`${header.slice(0, 4)} ${header.slice(4)}`, body],
      [`${header}=`, body],
      [header, `${body}==`],
      [header, flipLowBit(body)],
    ] as const) {
      const token = await signRaw(rewrittenHeader, rewrittenBody)
      await expect(verifyJwt(token, SECRET)).rejects.toThrow('Invalid JWT encoding')
    }
  })
})

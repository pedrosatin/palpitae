/**
 * Shared HMAC-SHA256 primitives used by jwt.ts and unsubscribeToken.ts.
 * Centralised so an algorithm change propagates to both without silent divergence.
 */

export const HMAC_SHA256 = { name: 'HMAC', hash: 'SHA-256' } as const

export function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    HMAC_SHA256,
    false,
    ['sign', 'verify'],
  )
}

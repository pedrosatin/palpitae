import { describe, expect, it } from 'vitest'
import { buildAuthUrl, generateNonce, generatePkce, generateState } from './google'

describe('generateState', () => {
  it('returns a URL-safe base64 string', () => {
    expect(generateState()).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('is at least 20 characters long', () => {
    expect(generateState().length).toBeGreaterThanOrEqual(20)
  })

  it('generates unique values on each call', () => {
    expect(generateState()).not.toBe(generateState())
  })
})

describe('generateNonce', () => {
  it('returns a URL-safe base64 string', () => {
    expect(generateNonce()).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('generatePkce', () => {
  it('returns a verifier and challenge that are different', async () => {
    const { verifier, challenge } = await generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier).not.toBe(challenge)
  })

  it('challenge is the SHA-256 hash of the verifier (base64url)', async () => {
    const { verifier, challenge } = await generatePkce()
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const expected = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
    expect(challenge).toBe(expected)
  })

  it('produces unique pairs on each call', async () => {
    const a = await generatePkce()
    const b = await generatePkce()
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe('buildAuthUrl', () => {
  const base = {
    clientId: 'test-client-id',
    redirectUri: 'http://localhost:8787/auth/callback',
    state: 'test-state',
    nonce: 'test-nonce',
    codeChallenge: 'test-challenge',
  }

  it('points to Google OAuth endpoint', () => {
    const url = new URL(buildAuthUrl(base))
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
  })

  it('sets response_type=code', () => {
    expect(new URL(buildAuthUrl(base)).searchParams.get('response_type')).toBe('code')
  })

  it('includes openid in scope', () => {
    expect(new URL(buildAuthUrl(base)).searchParams.get('scope')).toContain('openid')
  })

  it('passes state, nonce, and PKCE challenge', () => {
    const url = new URL(buildAuthUrl(base))
    expect(url.searchParams.get('state')).toBe('test-state')
    expect(url.searchParams.get('nonce')).toBe('test-nonce')
    expect(url.searchParams.get('code_challenge')).toBe('test-challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('sets the correct client_id and redirect_uri', () => {
    const url = new URL(buildAuthUrl(base))
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
    expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:8787/auth/callback')
  })
})

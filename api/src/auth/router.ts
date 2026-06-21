import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import {
  buildAuthUrl,
  exchangeCode,
  generateNonce,
  generatePkce,
  generateState,
  upsertUser,
  verifyGoogleIdToken,
} from './google'
import { getFeatureFlags } from './permissions'
import { signJwt } from './jwt'
import { requireAuth } from './middleware'
import { hashUserId, logEvent } from '../observability'
import type { AppContext } from '../types'

const SESSION_COOKIE = 'session'
const STATE_COOKIE = 'oauth_state'
const NONCE_COOKIE = 'oauth_nonce'
const VERIFIER_COOKIE = 'oauth_verifier'
const REDIRECT_COOKIE = 'oauth_redirect'
const SESSION_TTL = 24 * 60 * 60 // 24 hours

// Conjunto conhecido de códigos de erro do Google OAuth. Limita a cardinalidade
// do evento oauth_error — o parâmetro `error` do callback é público e arbitrário.
const KNOWN_OAUTH_ERRORS = new Set([
  'access_denied',
  'invalid_request',
  'unauthorized_client',
  'unsupported_response_type',
  'invalid_scope',
  'server_error',
  'temporarily_unavailable',
])

function cookieDomain(baseUrl: string): string | undefined {
  if (!baseUrl.startsWith('https')) return undefined
  const hostname = new URL(baseUrl).hostname
  const parts = hostname.split('.')
  // api.palpitae.com.br → .palpitae.com.br (shares with palpitae.com.br)
  return parts.length > 2 ? '.' + parts.slice(1).join('.') : undefined
}

function cookieOptions(baseUrl: string, maxAge?: number) {
  const domain = cookieDomain(baseUrl)
  return {
    httpOnly: true,
    secure: baseUrl.startsWith('https'),
    sameSite: 'Lax' as const,
    path: '/',
    ...(domain && { domain }),
    ...(maxAge !== undefined && { maxAge }),
  }
}

export const authRouter = new Hono<AppContext>()

// GET /auth/google — initiate OAuth flow
authRouter.get('/google', async (c) => {
  const state = generateState()
  const nonce = generateNonce()
  const { verifier, challenge } = await generatePkce()
  const redirectUri = `${c.env.BASE_URL}/auth/callback`

  const url = buildAuthUrl({
    clientId: c.env.GOOGLE_CLIENT_ID,
    redirectUri,
    state,
    nonce,
    codeChallenge: challenge,
  })

  const tempOpts = cookieOptions(c.env.BASE_URL, 300) // 5 min TTL for temp cookies
  setCookie(c, STATE_COOKIE, state, tempOpts)
  setCookie(c, NONCE_COOKIE, nonce, tempOpts)
  setCookie(c, VERIFIER_COOKIE, verifier, tempOpts)

  // Store the post-login redirect (only allow relative query strings to prevent open redirect)
  const postRedirect = c.req.query('redirect') ?? ''
  if (postRedirect.startsWith('?')) {
    setCookie(c, REDIRECT_COOKIE, postRedirect, tempOpts)
  }

  return c.redirect(url)
})

// GET /auth/callback — handle Google redirect
authRouter.get('/callback', async (c) => {
  const { code, state, error } = c.req.query()

  if (error) {
    const errorCode = KNOWN_OAUTH_ERRORS.has(error) ? error : 'other'
    logEvent(c.env.AE, 'oauth_error', { blobs: [errorCode] })
    return c.redirect(`${c.env.FRONTEND_URL}?auth_error=${encodeURIComponent(error)}`)
  }

  const storedState = getCookie(c, STATE_COOKIE)
  const storedNonce = getCookie(c, NONCE_COOKIE)
  const codeVerifier = getCookie(c, VERIFIER_COOKIE)

  // Clear temp cookies regardless of outcome
  const clearOpts = { path: '/' }
  deleteCookie(c, STATE_COOKIE, clearOpts)
  deleteCookie(c, NONCE_COOKIE, clearOpts)
  deleteCookie(c, VERIFIER_COOKIE, clearOpts)

  const storedRedirect = getCookie(c, REDIRECT_COOKIE) ?? ''
  deleteCookie(c, REDIRECT_COOKIE, clearOpts)

  if (!storedState || !storedNonce || !codeVerifier) {
    logEvent(c.env.AE, 'login_failure', { blobs: ['session_expired'] })
    return c.redirect(`${c.env.FRONTEND_URL}?auth_error=session_expired`)
  }

  if (state !== storedState) {
    logEvent(c.env.AE, 'login_failure', { blobs: ['state_mismatch'] })
    return c.redirect(`${c.env.FRONTEND_URL}?auth_error=state_mismatch`)
  }

  try {
    const tokens = await exchangeCode({
      code,
      codeVerifier,
      clientId: c.env.GOOGLE_CLIENT_ID,
      clientSecret: c.env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${c.env.BASE_URL}/auth/callback`,
    })

    const googleUser = await verifyGoogleIdToken(
      tokens.id_token,
      c.env.GOOGLE_CLIENT_ID,
      storedNonce,
    )

    const user = await upsertUser(c.env.DB, {
      email: googleUser.email,
      providerId: googleUser.sub,
      provider: 'google',
      name: googleUser.name,
      avatarUrl: googleUser.picture,
    })

    const sessionToken = await signJwt(
      { sub: user.id, email: user.email },
      c.env.JWT_SECRET,
      SESSION_TTL,
    )

    setCookie(c, SESSION_COOKIE, sessionToken, cookieOptions(c.env.BASE_URL, SESSION_TTL))

    logEvent(c.env.AE, 'login_success', { blobs: [await hashUserId(user.id)] })

    const destination = storedRedirect.startsWith('?')
      ? `${c.env.FRONTEND_URL}${storedRedirect}`
      : c.env.FRONTEND_URL
    return c.redirect(destination)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'auth_failed'
    logEvent(c.env.AE, 'login_failure', { blobs: ['exchange_failed', message] })
    return c.redirect(`${c.env.FRONTEND_URL}?auth_error=${encodeURIComponent(message)}`)
  }
})

// POST /auth/logout
authRouter.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  return c.json({ ok: true })
})

// GET /auth/me — return authenticated user
authRouter.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')

  const user = await c.env.DB
    .prepare('SELECT u.id, u.email, p.nickname, p.avatar_url FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?')
    .bind(userId)
    .first<{ id: string; email: string; nickname: string | null; avatar_url: string | null }>()

  if (!user) return c.json({ error: 'User not found' }, 404)

  return c.json({
    user: {
      ...user,
      feature_flags: getFeatureFlags(user.email),
    },
  })
})

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
import { signJwt } from './jwt'
import { requireAuth } from './middleware'
import type { AppContext } from '../types'

const SESSION_COOKIE = 'session'
const STATE_COOKIE = 'oauth_state'
const NONCE_COOKIE = 'oauth_nonce'
const VERIFIER_COOKIE = 'oauth_verifier'
const SESSION_TTL = 24 * 60 * 60 // 24 hours

function cookieOptions(baseUrl: string, maxAge?: number) {
  return {
    httpOnly: true,
    secure: baseUrl.startsWith('https'),
    sameSite: 'Lax' as const,
    path: '/',
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

  return c.redirect(url)
})

// GET /auth/callback — handle Google redirect
authRouter.get('/callback', async (c) => {
  const { code, state, error } = c.req.query()

  if (error) {
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

  if (!storedState || !storedNonce || !codeVerifier) {
    return c.redirect(`${c.env.FRONTEND_URL}?auth_error=session_expired`)
  }

  if (state !== storedState) {
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

    return c.redirect(c.env.FRONTEND_URL)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'auth_failed'
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

  return c.json({ user })
})

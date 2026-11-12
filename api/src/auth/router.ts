import { Hono, type Context } from 'hono'
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
import { requireAuth, resolveSession } from './middleware'
import { revokeAllSessions, revokeSession, SessionStorageError } from './session'
import { hashUserId, logError, logEvent, tryLogEvent } from '../observability'
import { parseSignupOrigin } from '../observability/signupOrigin'
import type { AppContext } from '../types'

const SESSION_COOKIE = 'session'
const STATE_COOKIE = 'oauth_state'
const NONCE_COOKIE = 'oauth_nonce'
const VERIFIER_COOKIE = 'oauth_verifier'
const REDIRECT_COOKIE = 'oauth_redirect'
const ORIGIN_COOKIE = 'oauth_origin'
const OAUTH_COOKIES = [STATE_COOKIE, NONCE_COOKIE, VERIFIER_COOKIE, REDIRECT_COOKIE, ORIGIN_COOKIE]
const SESSION_TTL = 30 * 24 * 60 * 60 // 30 days (1 month)

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

function tempCookieClearOptions(baseUrl: string) {
  const domain = cookieDomain(baseUrl)
  return { path: '/', ...(domain && { domain }) }
}

/**
 * Destino pós-login aceito: só caminho que resolve para a origem do frontend.
 * Vale para a query de `/auth/google` e de novo para o cookie no callback,
 * porque cookie também vem do navegador.
 */
function sameOriginDestination(value: string, frontendUrl: string): URL | null {
  if (!value) return null
  try {
    const parsed = new URL(value, frontendUrl)
    return parsed.origin === new URL(frontendUrl).origin ? parsed : null
  } catch {
    return null
  }
}

/**
 * Lê e apaga o contexto da tentativa (state, nonce, verifier, destino e origem).
 * O callback chama antes de qualquer ramo, então sucesso, recusa do Google,
 * state inválido, cookie vencido e falha na troca terminam sem deixar contexto
 * para a próxima tentativa.
 */
function takeOAuthContext(c: Context<AppContext>) {
  const context = {
    state: getCookie(c, STATE_COOKIE),
    nonce: getCookie(c, NONCE_COOKIE),
    verifier: getCookie(c, VERIFIER_COOKIE),
    redirect: getCookie(c, REDIRECT_COOKIE) ?? '',
    // O cookie vem do navegador: ausente ou fora da lista vira "desconhecida".
    signupOrigin: parseSignupOrigin(getCookie(c, ORIGIN_COOKIE)),
  }
  const clearOpts = tempCookieClearOptions(c.env.BASE_URL)
  for (const name of OAUTH_COOKIES) deleteCookie(c, name, clearOpts)
  return context
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

  // Sempre grava, mesmo vazio: sem isso, a origem de uma tentativa anterior valeria
  // nesta. Só token reconhecido entra no cookie; o callback valida de novo.
  const origin = c.req.query('origem') ?? ''
  const originIsKnown = parseSignupOrigin(origin).category !== 'desconhecida'
  setCookie(c, ORIGIN_COOKIE, originIsKnown ? origin : '', tempOpts)

  // Também sempre grava: login sem destino, ou com destino recusado, não pode
  // levar ao destino de uma tentativa anterior que não chegou ao callback.
  const destination = sameOriginDestination(c.req.query('redirect') ?? '', c.env.FRONTEND_URL)
  const redirectPath = destination
    ? destination.pathname + destination.search + destination.hash
    : ''
  setCookie(c, REDIRECT_COOKIE, redirectPath, tempOpts)

  return c.redirect(url)
})

// GET /auth/callback — handle Google redirect
authRouter.get('/callback', async (c) => {
  const { code, state, error } = c.req.query()
  const oauth = takeOAuthContext(c)

  if (error) {
    const errorCode = KNOWN_OAUTH_ERRORS.has(error) ? error : 'other'
    logEvent(c.env.AE, 'oauth_error', { blobs: [errorCode] })
    return c.redirect(`${c.env.FRONTEND_URL}?auth_error=${encodeURIComponent(errorCode)}`)
  }

  const { state: storedState, nonce: storedNonce, verifier: codeVerifier, signupOrigin } = oauth

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

    // Junto da escrita no D1, para a soma das origens bater com os cadastros.
    if (user.isNew) {
      tryLogEvent(c.env.AE, 'account_created', {
        blobs: [signupOrigin.category, signupOrigin.guideSlug],
      })
    }

    const sessionToken = await signJwt(
      { sub: user.id, email: user.email, jti: crypto.randomUUID() },
      c.env.JWT_SECRET,
      SESSION_TTL,
    )

    setCookie(c, SESSION_COOKIE, sessionToken, cookieOptions(c.env.BASE_URL, SESSION_TTL))

    tryLogEvent(c.env.AE, 'login_success', { blobs: [await hashUserId(user.id)] })

    const destination = sameOriginDestination(oauth.redirect, c.env.FRONTEND_URL)
    return c.redirect(destination?.toString() ?? c.env.FRONTEND_URL)
  } catch (err) {
    console.error('OAuth callback failed:', err)
    logEvent(c.env.AE, 'login_failure', { blobs: ['exchange_failed'] })
    return c.redirect(`${c.env.FRONTEND_URL}?auth_error=exchange_failed`)
  }
})

// POST /auth/logout
authRouter.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  const domain = cookieDomain(c.env.BASE_URL)
  // O cookie sai do navegador mesmo se a revogação no D1 falhar.
  deleteCookie(c, SESSION_COOKIE, { path: '/', ...(domain && { domain }) })
  if (token) {
    try {
      await revokeSession(token, c.env.JWT_SECRET, c.env.DB)
    } catch (error) {
      logError(c.env.AE, 'security_storage_error', '[auth] Revogação no logout falhou:', error, {
        blobs: ['logout'],
      })
      return c.json({ error: 'Não foi possível encerrar a sessão no servidor' }, 503)
    }
  }
  return c.json({ ok: true })
})

// POST /auth/logout-all — encerra todas as sessões do usuário, inclusive esta.
//
// Grava o corte em `users.sessions_valid_after`; a verificação de sessão rejeita
// tokens emitidos até esse instante. Se o D1 falhar, o cookie fica no navegador
// para o usuário tentar de novo, porque as outras sessões continuam válidas.
authRouter.post('/logout-all', requireAuth, async (c) => {
  const userId = c.get('userId')
  try {
    await revokeAllSessions(userId, c.env.DB)
  } catch (error) {
    logError(
      c.env.AE,
      'security_storage_error',
      '[auth] Saída de todas as sessões falhou:',
      error,
      {
        blobs: ['logout_all'],
      },
    )
    return c.json({ error: 'Não foi possível encerrar as sessões no servidor' }, 503)
  }
  const domain = cookieDomain(c.env.BASE_URL)
  deleteCookie(c, SESSION_COOKIE, { path: '/', ...(domain && { domain }) })
  logEvent(c.env.AE, 'logout_all', { blobs: [await hashUserId(userId)] })
  return c.json({ ok: true })
})

// GET /auth/me — return authenticated user
//
// Não usa `requireAuth`: essa rota é chamada em toda visita (inclusive
// anônima) só para checar se há sessão. Um 401 aqui é o estado normal de
// "deslogado" — não um erro — mas o Chrome loga qualquer resposta 4xx/5xx de
// fetch/XHR como erro no console, o que reprovava a auditoria de Best
// Practices do Lighthouse. Retornar 200 com `{ authenticated: false }`
// resolve isso sem mudar o comportamento percebido pelo usuário.
authRouter.get('/me', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (!token) return c.json({ authenticated: false }, 200)

  const session = await resolveSession(c)
  if (!session || 'error' in session) {
    if (session?.error instanceof SessionStorageError) {
      return c.json({ error: 'Sessão indisponível' }, 503)
    }
    return c.json({ authenticated: false }, 200)
  }
  const userId = session.payload.sub

  const user = await c.env.DB.prepare(
    'SELECT u.id, u.email, p.nickname, p.avatar_url FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = ?',
  )
    .bind(userId)
    .first<{
      id: string
      email: string
      nickname: string | null
      avatar_url: string | null
    }>()

  if (!user) return c.json({ error: 'User not found' }, 404)

  return c.json({
    user: {
      ...user,
      feature_flags: getFeatureFlags(user.email),
    },
  })
})

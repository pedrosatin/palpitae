import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { SessionStorageError, verifySession } from './session'
import type { AppContext, SessionState } from '../types'

/**
 * Verifica o cookie de sessão uma vez por requisição. O limitador global chama
 * primeiro; o requireAuth e o /auth/me reaproveitam o resultado guardado no
 * contexto em vez de consultar `revoked_sessions` de novo.
 */
export async function resolveSession(c: Context<AppContext>): Promise<SessionState | undefined> {
  const cached = c.get('session')
  if (cached) return cached
  const token = getCookie(c, 'session')
  if (!token) return undefined
  let state: SessionState
  try {
    state = { payload: await verifySession(token, c.env.JWT_SECRET, c.env.DB) }
  } catch (error) {
    state = { error }
  }
  c.set('session', state)
  return state
}

export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const session = await resolveSession(c)
  if (!session) return c.json({ error: 'Unauthorized' }, 401)
  if ('error' in session) {
    if (session.error instanceof SessionStorageError) {
      return c.json({ error: 'Sessão indisponível' }, 503)
    }
    return c.json({ error: 'Unauthorized' }, 401)
  }
  c.set('userId', session.payload.sub)
  c.set('userEmail', session.payload.email)
  await next()
})

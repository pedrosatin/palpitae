import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { SessionStorageError, verifySession } from './session'
import type { AppContext } from '../types'

export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const token = getCookie(c, 'session')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const payload = await verifySession(token, c.env.JWT_SECRET, c.env.DB)
    c.set('userId', payload.sub)
    c.set('userEmail', payload.email)
  } catch (error) {
    if (error instanceof SessionStorageError) return c.json({ error: 'Sessão indisponível' }, 503)
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

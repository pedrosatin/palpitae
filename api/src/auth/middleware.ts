import { createMiddleware } from 'hono/factory'
import { getCookie } from 'hono/cookie'
import { verifyJwt } from './jwt'
import type { AppContext } from '../types'

export const requireAuth = createMiddleware<AppContext>(async (c, next) => {
  const token = getCookie(c, 'session')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const payload = await verifyJwt(token, c.env.JWT_SECRET)
    c.set('userId', payload.sub)
    c.set('userEmail', payload.email)
    await next()
  } catch {
    return c.json({ error: 'Unauthorized' }, 401)
  }
})

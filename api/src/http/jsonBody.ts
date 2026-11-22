import type { Context } from 'hono'
import type { AppContext } from '../types'

export const INVALID_BODY = 'Body JSON inválido'

/**
 * Lê o corpo como objeto JSON. Devolve `null` para JSON inválido, `null`, lista
 * ou valor solto, e o handler responde 400. Os campos chegam sem garantia de
 * tipo: cada handler confere os que usa.
 */
export async function readJsonObject<T extends object>(c: Context<AppContext>): Promise<T | null> {
  const body: unknown = await c.req.json().catch(() => null)
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as T) : null
}

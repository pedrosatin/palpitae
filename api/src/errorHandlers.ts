import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppContext } from './types'

/** Rota inexistente: 404 com `{ error }`, no lugar do texto padrão do Hono. */
export function jsonNotFound(c: Context<AppContext>): Response {
  return c.json({ error: 'Rota não encontrada' }, 404)
}

const INTERNAL_ERROR = 'Erro interno. Tente novamente.'

/**
 * Erro que escapou de uma rota. `HTTPException` mantém o status e os headers que
 * carrega e só troca o corpo por `{ error }`; num 5xx a mensagem vira a genérica e
 * o erro vai para o log. O resto é falha interna: vai para o log e responde 500
 * com mensagem genérica.
 */
export function jsonError(error: Error, c: Context<AppContext>): Response {
  const internal = !(error instanceof HTTPException) || error.status >= 500
  if (internal) {
    console.error(`[api] Exceção não tratada em ${c.req.method} ${c.req.path}:`, error)
  }
  if (error instanceof HTTPException) {
    const headers = new Headers(error.getResponse().headers)
    headers.set('Content-Type', 'application/json')
    const message = internal ? INTERNAL_ERROR : error.message || 'Erro na requisição'
    return new Response(JSON.stringify({ error: message }), { status: error.status, headers })
  }
  return c.json({ error: INTERNAL_ERROR }, 500)
}

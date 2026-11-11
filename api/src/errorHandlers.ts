import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppContext } from './types'

/** Rota inexistente: 404 com `{ error }`, no lugar do texto padrão do Hono. */
export function jsonNotFound(c: Context<AppContext>): Response {
  return c.json({ error: 'Rota não encontrada' }, 404)
}

/**
 * Erro que escapou de uma rota. `HTTPException` mantém o status e os headers que
 * carrega e só troca o corpo por `{ error }`. O resto é falha interna: vai para o
 * log e responde 500 com mensagem genérica.
 */
export function jsonError(error: Error, c: Context<AppContext>): Response {
  if (error instanceof HTTPException) {
    const headers = new Headers(error.getResponse().headers)
    headers.set('Content-Type', 'application/json')
    const body = JSON.stringify({ error: error.message || 'Erro na requisição' })
    return new Response(body, { status: error.status, headers })
  }
  console.error(`[api] Exceção não tratada em ${c.req.method} ${c.req.path}:`, error)
  return c.json({ error: 'Erro interno. Tente novamente.' }, 500)
}

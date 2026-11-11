import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { describe, expect, it, vi } from 'vitest'
import { jsonError } from './errorHandlers'
import type { AppContext } from './types'

function appThrowing(error: Error) {
  const app = new Hono<AppContext>()
  app.onError(jsonError)
  app.get('/', () => {
    throw error
  })
  return app
}

describe('jsonError', () => {
  it('mantém o status e os headers de uma HTTPException, com corpo { error }', async () => {
    const error = new HTTPException(409, {
      res: new Response('conflito', { status: 409, headers: { 'Retry-After': '30' } }),
      message: 'Grupo cheio',
    })

    const res = await appThrowing(error).request('/')

    expect(res.status).toBe(409)
    expect(res.headers.get('Retry-After')).toBe('30')
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Grupo cheio' })
  })

  it('responde 500 genérico, sem expor a mensagem, para falha interna', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await appThrowing(new Error('D1_ERROR: no such table: groups')).request('/')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Erro interno. Tente novamente.' })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })

  it('HTTPException 5xx mantém o status sem expor a mensagem interna', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const cause = new Error('D1_ERROR: no such table: private_table')
    const error = new HTTPException(503, { cause, message: cause.message })

    const res = await appThrowing(error).request('/')

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Erro interno. Tente novamente.' })
    expect(log).toHaveBeenCalled()
    log.mockRestore()
  })
})

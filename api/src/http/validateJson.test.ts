import { Hono } from 'hono'
import * as v from 'valibot'
import { describe, expect, it } from 'vitest'
import type { AppContext } from '../types'
import { validateJson } from './validateJson'

describe('validateJson', () => {
  const schema = v.object({ name: v.pipe(v.string(), v.minLength(1)) })
  const app = new Hono<AppContext>()
  app.post(
    '/x',
    validateJson(schema, () => 'nome inválido'),
    (c) => c.json(c.req.valid('json')),
  )

  async function post(rawBody: string) {
    return app.request('http://test/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
    })
  }

  it('aceita objeto válido e grava em req.valid', async () => {
    const res = await post('{"name":"ok"}')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'ok' })
  })

  it('corpo que não é objeto responde Body JSON inválido', async () => {
    for (const raw of ['null', '[]', '1', '{']) {
      const res = await post(raw)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Body JSON inválido' })
    }
  })

  it('schema inválido usa a mensagem do mapper', async () => {
    const res = await post('{"name":""}')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'nome inválido' })
  })
})

import { Hono } from 'hono'
import * as v from 'valibot'
import { describe, expect, expectTypeOf, it } from 'vitest'
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

  async function post(rawBody: string, contentType?: string | null) {
    const headers: Record<string, string> = {}
    if (contentType !== null) {
      headers['Content-Type'] = contentType ?? 'application/json'
    }
    return app.request('http://test/x', {
      method: 'POST',
      headers,
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

  it('corpo fora do schema usa a mensagem do mapper', async () => {
    const res = await post('{"name":""}')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'nome inválido' })
  })

  it('JSON válido sem Content-Type ou com text/plain segue para o schema', async () => {
    for (const contentType of [null, 'text/plain'] as const) {
      const ok = await post('{"name":"ok"}', contentType)
      expect(ok.status).toBe(200)
      expect(await ok.json()).toEqual({ name: 'ok' })

      const bad = await post('{"name":""}', contentType)
      expect(bad.status).toBe(400)
      expect(await bad.json()).toEqual({ error: 'nome inválido' })
    }
  })

  it('application/json;charset=UTF-8 aceita o corpo', async () => {
    const res = await post('{"name":"ok"}', 'application/json;charset=UTF-8')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'ok' })
  })

  it('JSON malformado responde Body JSON inválido independentemente do Content-Type', async () => {
    for (const contentType of ['application/json', 'text/plain', null] as const) {
      const res = await post('{', contentType)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'Body JSON inválido' })
    }
  })

  it('invalidBodyError substitui a mensagem de corpo inválido', async () => {
    const custom = new Hono<AppContext>()
    custom.post(
      '/x',
      validateJson(schema, () => 'nome inválido', { invalidBodyError: 'campo obrigatório' }),
      (c) => c.json(c.req.valid('json')),
    )
    const res = await custom.request('http://test/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[1]',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'campo obrigatório' })
  })

  it('modo value envia lista ao schema em vez de corpo inválido', async () => {
    const listSchema = v.pipe(
      v.unknown(),
      v.check((value) => Array.isArray(value), 'precisa ser lista'),
    )
    const valueApp = new Hono<AppContext>()
    valueApp.post(
      '/x',
      validateJson(listSchema, () => 'precisa ser lista', { body: 'value' }),
      (c) => c.json({ ok: true, body: c.req.valid('json') }),
    )
    const ok = await valueApp.request('http://test/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[1,2]',
    })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ ok: true, body: [1, 2] })

    const bad = await valueApp.request('http://test/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'Body JSON inválido' })
  })

  it('tipa c.req.valid(json) com AppContext e Env customizado sem cast', async () => {
    const typedSchema = v.object({
      name: v.pipe(v.string(), v.minLength(1)),
      count: v.pipe(
        v.string(),
        v.transform((value) => Number(value)),
      ),
    })

    const typedApp = new Hono<AppContext>()
    typedApp.post(
      '/typed',
      validateJson(typedSchema, () => 'payload inválido'),
      (c) => {
        const body = c.req.valid('json')
        expectTypeOf(body).toEqualTypeOf<{ name: string; count: number }>()
        expectTypeOf(c.env).toEqualTypeOf<AppContext['Bindings']>()
        return c.json(body)
      },
    )

    const res = await typedApp.request('http://test/typed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'ok', count: '42' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'ok', count: 42 })

    type CustomEnv = { Bindings: { CUSTOM_KEY: string }; Variables: { customVar: number } }
    const customApp = new Hono<CustomEnv>()
    customApp.post(
      '/custom',
      validateJson(typedSchema, () => 'payload inválido'),
      (c) => {
        const body = c.req.valid('json')
        expectTypeOf(body).toEqualTypeOf<{ name: string; count: number }>()
        expectTypeOf(c.env).toEqualTypeOf<CustomEnv['Bindings']>()
        return c.json({ body, key: c.env.CUSTOM_KEY })
      },
    )

    const customRes = await customApp.request(
      'http://test/custom',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'ok', count: '7' }),
      },
      { CUSTOM_KEY: 'secret' },
    )
    expect(customRes.status).toBe(200)
    expect(await customRes.json()).toEqual({ body: { name: 'ok', count: 7 }, key: 'secret' })
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { MAX_SCORE } from './router'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

async function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(
    `INSERT INTO users (id,email,provider,provider_id) VALUES ('u','u@example.com','google','u')`,
  )
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FRONTEND_WORKER_ZONE: 'palpitae-web.pages.dev',
  } as Env
  const token = await signJwt(
    { sub: 'u', email: 'u@example.com', jti: crypto.randomUUID() },
    env.JWT_SECRET,
    3600,
  )
  const ctx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext
  return async (
    method: string,
    path: string,
    body: unknown,
    contentType: string | null = 'application/json',
  ) => {
    const rawBody = typeof body === 'string' ? body : JSON.stringify(body)
    const headers: Record<string, string> = {
      Cookie: `session=${token}`,
      'CF-Connecting-IP': '192.0.2.1',
    }
    if (contentType !== null) headers['Content-Type'] = contentType
    const response = await worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method,
        headers,
        body: rawBody,
      }),
      env,
      ctx,
    )
    return {
      status: response.status,
      body: (await response.json()) as { error?: string },
    }
  }
}

const INVALID_BODY = { error: 'Body JSON inválido' }
const PUT_REQUIRED = {
  error: 'group_id, match_id, predicted_home_score e predicted_away_score são obrigatórios',
}
const SCORE_RANGE = { error: `Placar deve ser um inteiro entre 0 e ${MAX_SCORE}` }
const BULK_GROUP = { error: 'group_id é obrigatório' }
const BULK_EMPTY = { error: 'predictions deve ser uma lista não-vazia' }
const BULK_MAX = { error: 'Máximo de 100 palpites por requisição' }
const BULK_ITEM = {
  error: `Cada palpite precisa de match_id e placares inteiros entre 0 e ${MAX_SCORE}`,
}
const IMPORT_REQUIRED = { error: 'source_group_id e target_group_id são obrigatórios' }
const IMPORT_DIFF = { error: 'source_group_id e target_group_id devem ser diferentes' }
const REPLICATE_REQUIRED = {
  error: 'source_group_id, target_group_ids (até 10) e match_ids (1 a 100) são obrigatórios',
}
const REPLICATE_DIFF = {
  error: 'target_group_ids deve ter ao menos um grupo diferente da origem',
}

const PUT_VALID = {
  group_id: 'g1',
  match_id: 'm1',
  predicted_home_score: 1,
  predicted_away_score: 0,
}
const BULK_VALID = {
  group_id: 'g1',
  predictions: [{ match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0 }],
}
const IMPORT_VALID = { source_group_id: 'src', target_group_id: 'tgt' }
const REPLICATE_VALID = {
  source_group_id: 'src',
  target_group_ids: ['g2'],
  match_ids: ['m1'],
}

describe('validação de escrita PUT /predictions', () => {
  it('campo ausente responde 400 com a mensagem de obrigatórios', async () => {
    const request = await setup()
    const cases = [
      {},
      { match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0 },
      { group_id: 'g1', predicted_home_score: 1, predicted_away_score: 0 },
      { group_id: 'g1', match_id: 'm1', predicted_away_score: 0 },
      { group_id: 'g1', match_id: 'm1', predicted_home_score: 1 },
      { group_id: '', match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0 },
    ]
    for (const body of cases) {
      const res = await request('PUT', '/predictions', body)
      expect(res).toEqual({ status: 400, body: PUT_REQUIRED })
    }
  })

  it('placar com tipo errado ou fora da faixa responde 400', async () => {
    const request = await setup()
    const base = { group_id: 'g1', match_id: 'm1' }
    const cases = [
      { ...base, predicted_home_score: -1, predicted_away_score: 0 },
      { ...base, predicted_home_score: MAX_SCORE + 1, predicted_away_score: 0 },
      { ...base, predicted_home_score: 1.5, predicted_away_score: 0 },
      { ...base, predicted_home_score: '1', predicted_away_score: 0 },
      { ...base, predicted_home_score: null, predicted_away_score: 0 },
      { ...base, predicted_home_score: 1, predicted_away_score: -1 },
      { ...base, predicted_home_score: 1, predicted_away_score: MAX_SCORE + 1 },
      { ...base, predicted_home_score: 1, predicted_away_score: 0.5 },
      { ...base, predicted_home_score: 1, predicted_away_score: '0' },
      { ...base, predicted_home_score: 1, predicted_away_score: null },
    ]
    for (const body of cases) {
      const res = await request('PUT', '/predictions', body)
      expect(res).toEqual({ status: 400, body: SCORE_RANGE })
    }
  })

  it('ID que não é string responde 400 com a mensagem de obrigatórios', async () => {
    const request = await setup()
    for (const body of [
      { ...PUT_VALID, group_id: 123 },
      { ...PUT_VALID, match_id: 7 },
      { ...PUT_VALID, group_id: {} },
    ]) {
      const res = await request('PUT', '/predictions', body)
      expect(res).toEqual({ status: 400, body: PUT_REQUIRED })
    }
  })

  it('corpo que não é objeto responde 400', async () => {
    const request = await setup()
    for (const raw of ['null', '[]', '42', '{']) {
      const res = await request('PUT', '/predictions', raw)
      expect(res).toEqual({ status: 400, body: INVALID_BODY })
    }
  })

  it('JSON válido sem Content-Type JSON passa da validação de formato', async () => {
    const request = await setup()
    for (const contentType of [null, 'text/plain', 'application/json;charset=UTF-8'] as const) {
      const res = await request('PUT', '/predictions', PUT_VALID, contentType)
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/Acesso negado/)
    }
  })
})

describe('validação de escrita PUT /predictions/bulk', () => {
  it('group_id ausente responde 400', async () => {
    const request = await setup()
    const res = await request('PUT', '/predictions/bulk', {
      predictions: [{ match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0 }],
    })
    expect(res).toEqual({ status: 400, body: BULK_GROUP })
  })

  it('predictions ausente, vazia ou com tipo errado responde 400', async () => {
    const request = await setup()
    const cases = [
      { group_id: 'g1' },
      { group_id: 'g1', predictions: [] },
      { group_id: 'g1', predictions: 'm1' },
      { group_id: 'g1', predictions: { match_id: 'm1' } },
    ]
    for (const body of cases) {
      const res = await request('PUT', '/predictions/bulk', body)
      expect(res).toEqual({ status: 400, body: BULK_EMPTY })
    }
  })

  it('acima de 100 palpites responde 400', async () => {
    const request = await setup()
    const predictions = Array.from({ length: 101 }, (_, i) => ({
      match_id: `m${i}`,
      predicted_home_score: 1,
      predicted_away_score: 0,
    }))
    const res = await request('PUT', '/predictions/bulk', { group_id: 'g1', predictions })
    expect(res).toEqual({ status: 400, body: BULK_MAX })
  })

  it('item com match_id ou placar inválido responde 400', async () => {
    const request = await setup()
    const cases = [
      { match_id: 1, predicted_home_score: 1, predicted_away_score: 0 },
      { predicted_home_score: 1, predicted_away_score: 0 },
      { match_id: 'm1', predicted_home_score: -1, predicted_away_score: 0 },
      { match_id: 'm1', predicted_home_score: MAX_SCORE + 1, predicted_away_score: 0 },
      { match_id: 'm1', predicted_home_score: 1.5, predicted_away_score: 0 },
      { match_id: 'm1', predicted_home_score: '1', predicted_away_score: 0 },
      { match_id: 'm1', predicted_home_score: null, predicted_away_score: 0 },
      { match_id: 'm1', predicted_home_score: 1, predicted_away_score: -1 },
      { match_id: 'm1', predicted_home_score: 1, predicted_away_score: '0' },
      null,
    ]
    for (const item of cases) {
      const res = await request('PUT', '/predictions/bulk', {
        group_id: 'g1',
        predictions: [item],
      })
      expect(res).toEqual({ status: 400, body: BULK_ITEM })
    }
  })

  it('group_id que não é string responde 400', async () => {
    const request = await setup()
    const res = await request('PUT', '/predictions/bulk', {
      group_id: 1,
      predictions: [{ match_id: 'm1', predicted_home_score: 1, predicted_away_score: 0 }],
    })
    expect(res).toEqual({ status: 400, body: BULK_GROUP })
  })

  it('corpo que não é objeto responde 400', async () => {
    const request = await setup()
    for (const raw of ['null', '[]', '42', '{']) {
      const res = await request('PUT', '/predictions/bulk', raw)
      expect(res).toEqual({ status: 400, body: INVALID_BODY })
    }
  })

  it('JSON válido sem Content-Type JSON passa da validação de formato', async () => {
    const request = await setup()
    for (const contentType of [null, 'text/plain', 'application/json;charset=UTF-8'] as const) {
      const res = await request('PUT', '/predictions/bulk', BULK_VALID, contentType)
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/Acesso negado/)
    }
  })
})

describe('validação de escrita POST /predictions/import', () => {
  it('campo ausente responde 400', async () => {
    const request = await setup()
    const cases = [
      {},
      { source_group_id: 'src' },
      { target_group_id: 'tgt' },
      { source_group_id: '', target_group_id: 'tgt' },
      { source_group_id: 'src', target_group_id: '' },
      { source_group_id: null, target_group_id: 'tgt' },
    ]
    for (const body of cases) {
      const res = await request('POST', '/predictions/import', body)
      expect(res).toEqual({ status: 400, body: IMPORT_REQUIRED })
    }
  })

  it('grupos iguais respondem 400', async () => {
    const request = await setup()
    const res = await request('POST', '/predictions/import', {
      source_group_id: 'mesmo',
      target_group_id: 'mesmo',
    })
    expect(res).toEqual({ status: 400, body: IMPORT_DIFF })
  })

  it('ID que não é string responde 400 com a mensagem de obrigatórios', async () => {
    const request = await setup()
    const res = await request('POST', '/predictions/import', {
      source_group_id: 5,
      target_group_id: 6,
    })
    expect(res).toEqual({ status: 400, body: IMPORT_REQUIRED })
  })

  it('corpo que não é objeto responde 400', async () => {
    const request = await setup()
    for (const raw of ['null', '[]', '42', '{']) {
      const res = await request('POST', '/predictions/import', raw)
      expect(res).toEqual({ status: 400, body: INVALID_BODY })
    }
  })

  it('JSON válido sem Content-Type JSON passa da validação de formato', async () => {
    const request = await setup()
    for (const contentType of [null, 'text/plain', 'application/json;charset=UTF-8'] as const) {
      const res = await request('POST', '/predictions/import', IMPORT_VALID, contentType)
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/Acesso negado/)
    }
  })
})

describe('validação de escrita POST /predictions/replicate', () => {
  it('campo ausente, lista vazia ou tipo errado responde 400', async () => {
    const request = await setup()
    const cases = [
      {},
      { target_group_ids: ['g2'], match_ids: ['m1'] },
      { source_group_id: 'src', match_ids: ['m1'] },
      { source_group_id: 'src', target_group_ids: ['g2'] },
      { source_group_id: 'src', target_group_ids: ['g2'], match_ids: [] },
      { source_group_id: 'src', target_group_ids: 'g2', match_ids: ['m1'] },
      { source_group_id: 'src', target_group_ids: ['g2'], match_ids: 'm1' },
      { source_group_id: 'src', target_group_ids: [1], match_ids: ['m1'] },
      { source_group_id: 'src', target_group_ids: ['g2'], match_ids: [1] },
      { source_group_id: 'src', target_group_ids: [''], match_ids: ['m1'] },
      { source_group_id: '', target_group_ids: ['g2'], match_ids: ['m1'] },
      {
        source_group_id: 'src',
        target_group_ids: Array.from({ length: 11 }, (_, i) => `g${i}`),
        match_ids: ['m1'],
      },
      {
        source_group_id: 'src',
        target_group_ids: ['g2'],
        match_ids: Array.from({ length: 101 }, (_, i) => `m${i}`),
      },
    ]
    for (const body of cases) {
      const res = await request('POST', '/predictions/replicate', body)
      expect(res).toEqual({ status: 400, body: REPLICATE_REQUIRED })
    }
  })

  it('lista de destinos sem outro grupo responde 400', async () => {
    const request = await setup()
    for (const target_group_ids of [[], ['src']] as const) {
      const res = await request('POST', '/predictions/replicate', {
        source_group_id: 'src',
        target_group_ids,
        match_ids: ['m1'],
      })
      expect(res).toEqual({ status: 400, body: REPLICATE_DIFF })
    }
  })

  it('dedupe de destinos roda antes do teto de 10', async () => {
    const request = await setup()
    const twelveToTen = {
      source_group_id: 'src',
      target_group_ids: ['a', 'a', 'b', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'],
      match_ids: ['m1'],
    }
    const ok = await request('POST', '/predictions/replicate', twelveToTen)
    expect(ok.status).toBe(403)
    expect(ok.body.error).toMatch(/Acesso negado/)

    const elevenUniqueIncludingSource = {
      source_group_id: 'src',
      target_group_ids: [
        'src',
        'g1',
        'g2',
        'g3',
        'g4',
        'g5',
        'g6',
        'g7',
        'g8',
        'g9',
        'g10',
      ],
      match_ids: ['m1'],
    }
    const fail = await request('POST', '/predictions/replicate', elevenUniqueIncludingSource)
    expect(fail).toEqual({ status: 400, body: REPLICATE_REQUIRED })
  })

  it('source_group_id que não é string responde 400', async () => {
    const request = await setup()
    const res = await request('POST', '/predictions/replicate', {
      source_group_id: 9,
      target_group_ids: ['g2'],
      match_ids: ['m1'],
    })
    expect(res).toEqual({ status: 400, body: REPLICATE_REQUIRED })
  })

  it('corpo que não é objeto responde 400', async () => {
    const request = await setup()
    for (const raw of ['null', '[]', '42', '{']) {
      const res = await request('POST', '/predictions/replicate', raw)
      expect(res).toEqual({ status: 400, body: INVALID_BODY })
    }
  })

  it('JSON válido sem Content-Type JSON passa da validação de formato', async () => {
    const request = await setup()
    for (const contentType of [null, 'text/plain', 'application/json;charset=UTF-8'] as const) {
      const res = await request('POST', '/predictions/replicate', REPLICATE_VALID, contentType)
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/Acesso negado/)
    }
  })
})

import { afterEach, describe, expect, it } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const handles: ReturnType<typeof createSqliteD1>['sqlite'][] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

async function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES ('u1','u@example.com','google','u1');
    INSERT INTO competitions (id,name,slug,status) VALUES ('comp-1','Copa','copa-write-val','ongoing');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,public_id)
      VALUES ('g1','Grupo','comp-1','u1','ABCD-EFGH','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    INSERT INTO group_members (id,group_id,user_id,role) VALUES ('m1','g1','u1','owner');
  `)
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FRONTEND_WORKER_ZONE: 'palpitae-web.pages.dev',
  } as Env
  const token = await signJwt(
    { sub: 'u1', email: 'u@example.com', jti: crypto.randomUUID() },
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
    body: unknown | undefined,
    contentType: string | null = 'application/json',
  ) => {
    const headers: Record<string, string> = {
      Cookie: `session=${token}`,
      'CF-Connecting-IP': '192.0.2.1',
    }
    const init: RequestInit = { method, headers }
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body)
      if (contentType !== null) headers['Content-Type'] = contentType
    }
    const response = await worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, init),
      env,
      ctx,
    )
    return {
      status: response.status,
      body: (await response.json()) as { error?: string; invite_code?: string; success?: boolean },
    }
  }
}

const INVALID_BODY = { error: 'Body JSON inválido' }
const CREATE_REQUIRED = { error: 'Nome e competição são obrigatórios' }
const CREATE_POINTS = { error: 'Pontuação deve ser inteiro entre 0 e 10' }
const CREATE_VISIBILITY = { error: 'Visibilidade inválida' }
const JOIN_REQUIRED = { error: 'Código de convite é obrigatório' }
const PATCH_EMPTY = { error: 'Informe nome, pontos de classificado ou pedidos pelo link' }
const PATCH_POINTS = { error: 'Pontos de classificado devem ser um inteiro entre 0 e 10' }
const PATCH_JOIN_FLAG = { error: 'join_requests_enabled deve ser boolean' }
const PATCH_NAME_TYPE = { error: 'Nome deve ter entre 2 e 30 caracteres' }
const JOIN_REQUEST_LINK = { error: 'Link do grupo inválido' }

const CREATE_VALID = { name: 'Grupo Novo', competition_id: 'comp-missing' }
const JOIN_VALID = { invite_code: 'ZZZZ-ZZZZ' }
const PATCH_VALID = { name: 'Novo Nome' }

describe('validação de escrita POST /groups', () => {
  it('corpo que não é objeto responde 400', async () => {
    const request = await setup()
    for (const raw of ['null', '[]', '42', '{']) {
      const res = await request('POST', '/groups', raw)
      expect(res).toEqual({ status: 400, body: INVALID_BODY })
    }
  })

  it('nome ou competição ausente, vazia ou com tipo errado responde 400', async () => {
    const request = await setup()
    const cases = [
      {},
      { name: 'Grupo' },
      { competition_id: 'comp-1' },
      { name: '', competition_id: 'comp-1' },
      { name: '  ', competition_id: 'comp-1' },
      { name: 'Grupo', competition_id: '' },
      { name: 'Grupo', competition_id: '  ' },
      { name: 123, competition_id: 'comp-1' },
      { name: 'Grupo', competition_id: 123 },
      { name: null, competition_id: 'comp-1' },
      { name: 'Grupo', competition_id: null },
    ]
    for (const body of cases) {
      const res = await request('POST', '/groups', body)
      expect(res).toEqual({ status: 400, body: CREATE_REQUIRED })
    }
  })

  it('pontuação com tipo errado ou fora da faixa responde 400', async () => {
    const request = await setup()
    const base = { name: 'Grupo', competition_id: 'comp-1' }
    const cases = [
      { ...base, points_exact: 11 },
      { ...base, points_exact: -1 },
      { ...base, points_exact: 1.5 },
      { ...base, points_exact: '3' },
      { ...base, points_winner: 11 },
      { ...base, points_winner: '1' },
      { ...base, points_penalty: 11 },
      { ...base, points_penalty: 2.5 },
      { ...base, points_classified: 11 },
      { ...base, points_classified: '0' },
    ]
    for (const body of cases) {
      const res = await request('POST', '/groups', body)
      expect(res).toEqual({ status: 400, body: CREATE_POINTS })
    }
  })

  it('visibilidade inválida responde 400', async () => {
    const request = await setup()
    for (const predictions_visibility of ['everyone', '', 1, true]) {
      const res = await request('POST', '/groups', {
        name: 'Grupo',
        competition_id: 'comp-1',
        predictions_visibility,
      })
      expect(res).toEqual({ status: 400, body: CREATE_VISIBILITY })
    }
  })

  it('campo obrigatório tem prioridade sobre pontuação e visibilidade', async () => {
    const request = await setup()
    const res = await request('POST', '/groups', {
      competition_id: 'comp-1',
      points_exact: 11,
      predictions_visibility: 'x',
    })
    expect(res).toEqual({ status: 400, body: CREATE_REQUIRED })
  })

  it('pontuação inválida tem prioridade sobre visibilidade inválida', async () => {
    const request = await setup()
    const res = await request('POST', '/groups', {
      name: 'Grupo',
      competition_id: 'comp-1',
      points_exact: 11,
      predictions_visibility: 'x',
    })
    expect(res).toEqual({ status: 400, body: CREATE_POINTS })
  })

  it('regra do nome tem prioridade sobre pontuação fora da faixa', async () => {
    const request = await setup()
    const res = await request('POST', '/groups', {
      name: 'A',
      competition_id: 'comp-1',
      points_exact: 11,
    })
    expect(res).toEqual({
      status: 400,
      body: { error: 'Nome deve ter entre 2 e 30 caracteres' },
    })
  })

  it('caractere invisível no nome tem prioridade sobre pontuação com tipo errado', async () => {
    const request = await setup()
    const res = await request('POST', '/groups', {
      name: 'A\u200B',
      competition_id: 'comp-1',
      points_exact: 'x',
    })
    expect(res).toEqual({
      status: 400,
      body: { error: 'Nome não pode ter caracteres invisíveis' },
    })
  })

  it('regra do nome tem prioridade sobre visibilidade inválida', async () => {
    const request = await setup()
    const res = await request('POST', '/groups', {
      name: 'A',
      competition_id: 'comp-1',
      predictions_visibility: 'x',
    })
    expect(res).toEqual({
      status: 400,
      body: { error: 'Nome deve ter entre 2 e 30 caracteres' },
    })
  })

  it('exato menor que vencedor tem prioridade sobre visibilidade inválida', async () => {
    const request = await setup()
    const res = await request('POST', '/groups', {
      name: 'Grupo',
      competition_id: 'comp-1',
      points_exact: 1,
      points_winner: 2,
      predictions_visibility: 'x',
    })
    expect(res).toEqual({
      status: 400,
      body: {
        error: 'Pontos por placar exato deve ser maior ou igual a pontos por vencedor',
      },
    })
  })

  it('soma zero de pontuação tem prioridade sobre visibilidade inválida', async () => {
    const request = await setup()
    const res = await request('POST', '/groups', {
      name: 'Grupo',
      competition_id: 'comp-1',
      points_exact: 0,
      points_winner: 0,
      predictions_visibility: 'x',
    })
    expect(res).toEqual({
      status: 400,
      body: { error: 'Pelo menos um tipo de pontuação deve ser maior que zero' },
    })
  })

  it('JSON válido passa da validação de formato com qualquer Content-Type', async () => {
    const request = await setup()
    for (const contentType of [null, 'text/plain', 'application/json;charset=UTF-8'] as const) {
      const res = await request('POST', '/groups', CREATE_VALID, contentType)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Competição não encontrada' })
    }
  })
})

describe('validação de escrita POST /groups/join', () => {
  it('corpo que não é objeto responde 400', async () => {
    const request = await setup()
    for (const raw of ['null', '[]', '42', '{']) {
      const res = await request('POST', '/groups/join', raw)
      expect(res).toEqual({ status: 400, body: INVALID_BODY })
    }
  })

  it('código ausente, vazio ou com tipo errado responde 400', async () => {
    const request = await setup()
    const cases = [{}, { invite_code: '' }, { invite_code: '  ' }, { invite_code: 123 }, { invite_code: null }]
    for (const body of cases) {
      const res = await request('POST', '/groups/join', body)
      expect(res).toEqual({ status: 400, body: JOIN_REQUIRED })
    }
  })

  it('JSON válido passa da validação de formato com qualquer Content-Type', async () => {
    const request = await setup()
    for (const contentType of [null, 'text/plain', 'application/json;charset=UTF-8'] as const) {
      const res = await request('POST', '/groups/join', JOIN_VALID, contentType)
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Código de convite inválido' })
    }
  })
})

describe('validação de escrita PATCH /groups/:id', () => {
  it('corpo que não é objeto responde 400', async () => {
    const request = await setup()
    for (const raw of ['null', '[]', '42', '{']) {
      const res = await request('PATCH', '/groups/g1', raw)
      expect(res).toEqual({ status: 400, body: INVALID_BODY })
    }
  })

  it('sem campo editável responde 400', async () => {
    const request = await setup()
    const res = await request('PATCH', '/groups/g1', {})
    expect(res).toEqual({ status: 400, body: PATCH_EMPTY })
  })

  it('points_classified com tipo errado ou fora da faixa responde 400', async () => {
    const request = await setup()
    for (const points_classified of [11, -1, 1.5, '1', null]) {
      const res = await request('PATCH', '/groups/g1', { points_classified })
      expect(res).toEqual({ status: 400, body: PATCH_POINTS })
    }
  })

  it('join_requests_enabled que não é boolean responde 400', async () => {
    const request = await setup()
    for (const join_requests_enabled of ['true', 1, null, {}]) {
      const res = await request('PATCH', '/groups/g1', { join_requests_enabled })
      expect(res).toEqual({ status: 400, body: PATCH_JOIN_FLAG })
    }
  })

  it('nome com tipo errado responde 400 pela regra de nome', async () => {
    const request = await setup()
    const res = await request('PATCH', '/groups/g1', { name: 123 })
    expect(res).toEqual({ status: 400, body: PATCH_NAME_TYPE })
  })

  it('pontuação inválida tem prioridade sobre join_requests_enabled e nome', async () => {
    const request = await setup()
    const withJoin = await request('PATCH', '/groups/g1', {
      points_classified: 11,
      join_requests_enabled: 'x',
    })
    expect(withJoin).toEqual({ status: 400, body: PATCH_POINTS })
    const withName = await request('PATCH', '/groups/g1', {
      name: 123,
      points_classified: 11,
    })
    expect(withName).toEqual({ status: 400, body: PATCH_POINTS })
  })

  it('JSON válido passa da validação de formato com qualquer Content-Type', async () => {
    const request = await setup()
    for (const contentType of [null, 'text/plain', 'application/json;charset=UTF-8'] as const) {
      const res = await request('PATCH', '/groups/g1', PATCH_VALID, contentType)
      expect(res.status).toBe(200)
      expect(res.body).toMatchObject({ group: { id: 'g1', name: 'Novo Nome' } })
    }
  })
})

describe('validação de escrita POST /groups/join-requests', () => {
  it('corpo que não é objeto responde 400', async () => {
    const request = await setup()
    for (const raw of ['null', '[]', '42', '{']) {
      const res = await request('POST', '/groups/join-requests', raw)
      expect(res).toEqual({ status: 400, body: INVALID_BODY })
    }
  })

  it('public_id ausente ou com tipo errado responde 404 de link inválido', async () => {
    const request = await setup()
    for (const body of [{}, { public_id: 123 }, { public_id: null }, { public_id: '' }]) {
      const res = await request('POST', '/groups/join-requests', body)
      expect(res).toEqual({ status: 404, body: JOIN_REQUEST_LINK })
    }
  })

  it('JSON válido passa da validação de formato com qualquer Content-Type', async () => {
    const request = await setup()
    const public_id = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    for (const contentType of [null, 'text/plain', 'application/json;charset=UTF-8'] as const) {
      const res = await request('POST', '/groups/join-requests', { public_id }, contentType)
      // Link com formato válido para grupo inexistente recebe a recusa genérica, que não revela se o grupo existe.
      expect(res.status).toBe(404)
      expect(res.body.error).toBeTruthy()
    }
  })
})

describe('rotas de escrita sem corpo (rotate, delete grupo, remover membro)', () => {
  it('ignoram corpo malformado e seguem para a regra de negócio', async () => {
    const request = await setup()
    const rotate = await request('POST', '/groups/g1/invite/rotate', 'null')
    expect(rotate.status).toBe(200)
    expect(rotate.body.invite_code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/)

    const remove = await request('DELETE', '/groups/g1/members/u-missing', 'null')
    expect(remove).toEqual({ status: 404, body: { error: 'Membro não encontrado no grupo' } })

    const del = await request('DELETE', '/groups/g1', 'null')
    expect(del).toEqual({ status: 200, body: { success: true } })
  })
})

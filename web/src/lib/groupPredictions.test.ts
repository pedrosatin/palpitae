import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { invalidateApiCache } from './api-cache'
import { fetchGroupPredictions } from './groupPredictions'

function respond(body: unknown) {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  } as Response)
}

describe('fetchGroupPredictions', () => {
  beforeEach(() => invalidateApiCache())
  afterEach(() => vi.restoreAllMocks())

  it('devolve a resposta no formato da API', async () => {
    const body = { self_user_id: 'u1', members: [], predictions: [], open_pickers: {} }
    respond(body)
    await expect(fetchGroupPredictions('g1')).resolves.toEqual(body)
  })

  it.each([
    ['sem a lista de palpites', { members: [] }],
    ['sem a lista de membros', { predictions: [] }],
    ['corpo nulo', null],
  ])('recusa resposta %s', async (_case, body) => {
    respond(body)
    await expect(fetchGroupPredictions('g1')).rejects.toThrow(
      'Resposta inesperada do servidor. Tente novamente.',
    )
  })
})

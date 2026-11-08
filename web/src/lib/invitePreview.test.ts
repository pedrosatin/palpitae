import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  describeScoring,
  lookupInvite,
  parseInvitePreview,
  readEmbeddedInvite,
} from './invitePreview'

const API_INVITE = {
  group_name: 'Realidade do BR',
  competition_name: 'Brasileirão Série A',
  member_count: 6,
  admin_name: 'Pedro',
  points_exact: 3,
  points_winner: 1,
}

const PREVIEW = {
  groupName: 'Realidade do BR',
  competitionName: 'Brasileirão Série A',
  memberCount: 6,
  adminName: 'Pedro',
  pointsExact: 3,
  pointsWinner: 1,
}

function setEmbed(value: string) {
  const root = document.createElement('div')
  root.id = 'root'
  root.dataset.convite = value
  document.body.appendChild(root)
}

function embedFor(code: string, invite: unknown = API_INVITE) {
  return encodeURIComponent(JSON.stringify({ code, invite }))
}

afterEach(() => {
  document.getElementById('root')?.remove()
  vi.restoreAllMocks()
})

describe('parseInvitePreview', () => {
  it('converte o corpo da API', () => {
    expect(parseInvitePreview({ invite: API_INVITE })).toEqual(PREVIEW)
  })

  it('aceita campos opcionais ausentes', () => {
    expect(parseInvitePreview({ invite: { group_name: 'Antigo', member_count: 2 } })).toEqual({
      groupName: 'Antigo',
      competitionName: null,
      memberCount: 2,
      adminName: null,
      pointsExact: null,
      pointsWinner: null,
    })
  })

  it.each([
    null,
    {},
    { invite: null },
    { invite: { group_name: 42 } },
    { invite: { group_name: ' ' } },
  ])('recusa %j', (body) => {
    expect(parseInvitePreview(body)).toBeNull()
  })
})

describe('readEmbeddedInvite', () => {
  it('lê os dados embutidos para o mesmo código', () => {
    setEmbed(embedFor('ABCD-EF23'))
    expect(readEmbeddedInvite('ABCD-EF23')).toEqual(PREVIEW)
  })

  it('preserva aspas e entidades do nome do grupo', () => {
    setEmbed(embedFor('ABCD-EF23', { ...API_INVITE, group_name: 'A&quot;B "<x>"' }))
    expect(readEmbeddedInvite('ABCD-EF23')?.groupName).toBe('A&quot;B "<x>"')
  })

  it('ignora dados de outro código', () => {
    setEmbed(embedFor('WXYZ-2345'))
    expect(readEmbeddedInvite('ABCD-EF23')).toBeNull()
  })

  it.each(['%E0%A4%A', 'nao-e-json', encodeURIComponent('{"code":"ABCD-EF23"}')])(
    'devolve null para o valor %s',
    (value) => {
      setEmbed(value)
      expect(readEmbeddedInvite('ABCD-EF23')).toBeNull()
    },
  )

  it('devolve null sem o atributo', () => {
    expect(readEmbeddedInvite('ABCD-EF23')).toBeNull()
  })
})

describe('lookupInvite', () => {
  function mockFetch(status: number, body: unknown = {}) {
    return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as Response)
  }

  it('busca o endpoint público e devolve os dados', async () => {
    const fetchSpy = mockFetch(200, { invite: API_INVITE })

    await expect(lookupInvite('ABCD-EF23')).resolves.toEqual({ status: 'ready', preview: PREVIEW })
    expect(String(fetchSpy.mock.calls[0]?.[0])).toContain('/public/invites/ABCD-EF23')
  })

  it('trata 404 como convite inválido', async () => {
    mockFetch(404, { error: 'Convite não encontrado' })
    await expect(lookupInvite('ABCD-EF23')).resolves.toEqual({ status: 'invalid' })
  })

  it.each([429, 500, 503])(
    'trata %i como indisponível, sem invalidar o convite',
    async (status) => {
      mockFetch(status)
      await expect(lookupInvite('ABCD-EF23')).resolves.toEqual({ status: 'unavailable' })
    },
  )

  it('trata corpo fora do formato como indisponível', async () => {
    mockFetch(200, { invite: { group_name: 42 } })
    await expect(lookupInvite('ABCD-EF23')).resolves.toEqual({ status: 'unavailable' })
  })

  it('trata falha de rede como indisponível', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    await expect(lookupInvite('ABCD-EF23')).resolves.toEqual({ status: 'unavailable' })
  })
})

describe('describeScoring', () => {
  it.each([
    [3, 1, '3 pontos no placar exato, 1 no resultado'],
    [1, 1, '1 ponto no placar exato, 1 no resultado'],
    [3, 0, '3 pontos só no placar exato'],
    [0, 1, '1 ponto por acertar o vencedor'],
    [0, 2, '2 pontos por acertar o vencedor'],
    [0, 0, null],
    [null, 1, null],
    [3, null, null],
  ])('exato %s e vencedor %s', (exact, winner, expected) => {
    expect(describeScoring(exact, winner)).toBe(expected)
  })
})

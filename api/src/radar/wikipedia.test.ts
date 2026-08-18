import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchPageviews } from './wikipedia'

function mockFetch(response: Response) {
  const spy = vi.fn(async (_url: string, _init?: RequestInit) => response)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchPageviews', () => {
  it('converte o timestamp horário da API em dia ISO', async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          items: [
            { timestamp: '2026081600', views: 900 },
            { timestamp: '2026081700', views: 1100 },
          ],
        }),
      ),
    )

    const byDay = await fetchPageviews('Copa Libertadores da América', '2026-08-16', '2026-08-17')

    expect([...byDay]).toEqual([
      ['2026-08-16', 900],
      ['2026-08-17', 1100],
    ])
  })

  it('monta a URL com espaços em underscore e datas compactas', async () => {
    const spy = mockFetch(new Response(JSON.stringify({ items: [] })))

    await fetchPageviews('Copa do Brasil de Futebol', '2026-08-10', '2026-08-18')

    const url = spy.mock.calls[0][0]
    expect(url).toContain('/pt.wikipedia/all-access/user/Copa_do_Brasil_de_Futebol/daily/')
    expect(url).toMatch(/daily\/20260810\/20260818$/)
  })

  it('devolve mapa vazio para artigo inexistente (404)', async () => {
    mockFetch(new Response('not found', { status: 404 }))

    await expect(
      fetchPageviews('Artigo Que Não Existe', '2026-08-10', '2026-08-18'),
    ).resolves.toEqual(new Map())
  })

  it('propaga erro de servidor', async () => {
    mockFetch(new Response('boom', { status: 500 }))

    await expect(fetchPageviews('Premier League', '2026-08-10', '2026-08-18')).rejects.toThrow(
      /500/,
    )
  })
})

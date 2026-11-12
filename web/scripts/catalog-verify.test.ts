// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import catalogSource from '../src/pages/LandingPage/competitionCatalog.ts?raw'
import { COMPETITION_CATALOG } from '../src/pages/LandingPage/competitionCatalog'
import { catalogSlugs, compareCatalog, reportLines, verifyCatalog } from './catalog-verify.mjs'

const SOURCE = `
export const COMPETITION_CATALOG = [
  { slug: 'liga-a-2026', name: 'Liga A', region: 'brasil' },
  { slug: 'copa-b-2026', name: 'Copa B', region: 'europa' },
]
`

function apiReturning(body: unknown, status = 200) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

describe('catalog-verify', () => {
  it('lê do código-fonte os mesmos slugs que o catálogo exporta', () => {
    expect(catalogSlugs(catalogSource)).toEqual(COMPETITION_CATALOG.map((c) => c.slug))
  })

  it('separa o que a landing anuncia sem oferta do que é público sem anúncio', () => {
    expect(
      compareCatalog(
        ['liga-a-2026', 'copa-b-2026'],
        [
          { slug: 'liga-a-2026', name: 'Liga A' },
          { slug: 'liga-c-2026', name: 'Liga C' },
        ],
      ),
    ).toEqual({
      notOffered: ['copa-b-2026'],
      notAnnounced: [{ slug: 'liga-c-2026', name: 'Liga C' }],
    })
  })

  it('reprova o PR que muda o catálogo e anuncia competição fora da lista pública', async () => {
    // A Copa B virou piloto ou terminou: a API deixa de listá-la.
    const fetchImpl = apiReturning({ competitions: [{ slug: 'liga-a-2026', name: 'Liga A' }] })

    const result = await verifyCatalog({
      source: SOURCE,
      apiUrl: 'https://api.test',
      fetchImpl,
      strict: true,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.test/public/competitions',
      expect.anything(),
    )
    expect(result.code).toBe(1)
    expect(result.checked).toBe(true)
    expect(result.errors).toEqual([expect.stringContaining('copa-b-2026')])
  })

  it('fora do PR que muda o catálogo, a mesma divergência só avisa', async () => {
    const result = await verifyCatalog({
      source: SOURCE,
      fetchImpl: apiReturning({ competitions: [{ slug: 'liga-a-2026', name: 'Liga A' }] }),
    })

    expect(result).toMatchObject({ code: 0, checked: true, errors: [] })
    expect(result.warnings).toEqual([
      expect.stringMatching(/copa-b-2026.*só aviso: esta execução não altera o catálogo/),
    ])
  })

  it('só avisa quando há competição pública fora da landing', async () => {
    const result = await verifyCatalog({
      source: SOURCE,
      fetchImpl: apiReturning({
        competitions: [
          { slug: 'copa-b-2026', name: 'Copa B' },
          { slug: 'liga-a-2026', name: 'Liga A' },
          { slug: 'liga-a-2027', name: 'Liga A' },
        ],
      }),
      strict: true,
    })

    expect(result).toMatchObject({ code: 0, checked: true, errors: [] })
    expect(result.warnings).toEqual([expect.stringContaining('liga-a-2027 (Liga A)')])
  })

  it.each([
    ['API fora do ar', vi.fn(async () => Promise.reject(new Error('fetch failed')))],
    ['rota ainda não publicada', apiReturning({ error: 'Not Found' }, 404)],
    ['resposta fora do formato', apiReturning({ outra: [] })],
  ])('não reprova nem o PR do catálogo com %s, mas avisa', async (_label, fetchImpl) => {
    const result = await verifyCatalog({ source: SOURCE, fetchImpl, strict: true })

    expect(result).toMatchObject({ code: 0, checked: false, errors: [] })
    expect(result.warnings).toEqual([expect.stringContaining('catálogo não conferido')])
  })

  it.each([403, 429])(
    'HTTP %i reprova o PR do catálogo e vira aviso explícito nos demais',
    async (status) => {
      const strict = await verifyCatalog({
        source: SOURCE,
        fetchImpl: apiReturning({ error: 'x' }, status),
        strict: true,
      })
      const loose = await verifyCatalog({
        source: SOURCE,
        fetchImpl: apiReturning({ error: 'x' }, status),
      })

      expect(strict).toMatchObject({ code: 1, checked: false, warnings: [] })
      expect(strict.errors).toEqual([expect.stringContaining(`recusou a consulta`)])
      expect(loose).toMatchObject({ code: 0, checked: false, errors: [] })
      expect(loose.warnings).toEqual([
        expect.stringMatching(new RegExp(`recusou a consulta.*HTTP ${status}.*só aviso`)),
      ])
    },
  )

  it('reprova o PR do catálogo quando não consegue ler nenhum slug', async () => {
    const fetchImpl = apiReturning({ competitions: [] })

    const result = await verifyCatalog({
      source: 'export const COMPETITION_CATALOG = []',
      fetchImpl,
      strict: true,
    })

    expect(result.code).toBe(1)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('imprime erro e aviso como anotação no GitHub Actions e confirma só o que conferiu', () => {
    const failed = {
      code: 1,
      checked: true,
      errors: ['a landing anuncia x'],
      warnings: ['y é pública'],
    }

    expect(reportLines(failed, 'https://api.test', true)).toEqual([
      { stream: 'warn', text: '::warning::catalog:verify: y é pública' },
      { stream: 'error', text: '::error::catalog:verify: a landing anuncia x' },
    ])
    expect(
      reportLines({ code: 0, checked: true, errors: [], warnings: [] }, 'https://api.test'),
    ).toEqual([
      {
        stream: 'log',
        text: 'catalog:verify: catálogo da landing conferido contra https://api.test, sem divergência.',
      },
    ])
    expect(
      reportLines(
        { code: 0, checked: false, errors: [], warnings: ['fora do ar'] },
        'https://api.test',
      ),
    ).toEqual([{ stream: 'warn', text: 'catalog:verify: fora do ar' }])
    // Comparou, mas com aviso: a confirmação não aparece para não esconder o aviso.
    expect(
      reportLines(
        { code: 0, checked: true, errors: [], warnings: ['z é pública'] },
        'https://api.test',
      ),
    ).toEqual([{ stream: 'warn', text: 'catalog:verify: z é pública' }])
  })
})

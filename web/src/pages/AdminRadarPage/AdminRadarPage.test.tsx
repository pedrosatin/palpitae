import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AdminRadarPage from './AdminRadarPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))

function series(values: number[]) {
  return values.map((views, i) => ({ day: `2026-08-${String(i + 1).padStart(2, '0')}`, views }))
}

function item(over: Record<string, unknown> = {}) {
  return {
    id: 'api-football:13:2026',
    name: 'CONMEBOL Libertadores',
    country: 'World',
    type: 'Cup',
    logoUrl: null,
    season: '2026',
    startsOn: '2026-02-04',
    endsOn: '2026-11-28',
    status: 'ongoing',
    wikiArticle: 'Copa Libertadores da América',
    matchesInPeriod: 31,
    matchesToday: 4,
    pageviewsAvg: 4000,
    pageviewsTrend: 25,
    pageviewsSeries: series([900, 1100, 1000]),
    supported: false,
    internalGroups: 0,
    ...over,
  }
}

const brasileirao = item({
  id: 'api-football:71:2026',
  name: 'Serie A',
  country: 'Brazil',
  type: 'League',
  wikiArticle: 'Campeonato Brasileiro de Futebol',
  matchesInPeriod: 190,
  matchesToday: 0,
  pageviewsAvg: 900,
  pageviewsTrend: -8,
  supported: true,
  internalGroups: 7,
})

function mockFetch(body: unknown, status = 200) {
  return vi.fn(async () => ({ ok: status === 200, status, json: async () => body }))
}

// Competições pequenas de enchimento: o veredito compara com a MEDIANA do
// interesse, então uma amostra de duas linhas não exercitaria a régua de verdade.
const filler = [200, 250, 300].map((views, i) =>
  item({
    id: `filler-${i}`,
    name: `Liga Pequena ${i}`,
    country: 'Chile',
    pageviewsAvg: views,
    pageviewsTrend: 0,
    supported: false,
  }),
)

const defaultBody = {
  days: 30,
  lastSync: new Date().toISOString().slice(0, 19).replace('T', ' '),
  items: [item(), brasileirao, ...filler],
}

describe('AdminRadarPage', () => {
  it('lista competições com interesse, jogos e demanda interna', async () => {
    vi.stubGlobal('fetch', mockFetch(defaultBody))
    render(<AdminRadarPage />)

    const liberta = (await screen.findByText('CONMEBOL Libertadores')).closest('tr') as HTMLElement
    expect(within(liberta).getByText('Em andamento')).toBeInTheDocument()
    expect(within(liberta).getByText('4 hoje')).toBeInTheDocument()
    expect(within(liberta).getByText('+25%')).toBeInTheDocument()
    // Interesse bem acima da mediana e sem suporte → chamada pra ação.
    expect(within(liberta).getByText('Candidata forte')).toBeInTheDocument()

    const serieA = screen.getByText('Serie A').closest('tr') as HTMLElement
    expect(within(serieA).getByText('✓ no Palpitae')).toBeInTheDocument()
    expect(within(serieA).getByText('7')).toBeInTheDocument()
  })

  it('mostra acesso restrito no 403', async () => {
    vi.stubGlobal('fetch', mockFetch({}, 403))
    render(<AdminRadarPage />)

    expect(await screen.findByText('Acesso restrito ao administrador.')).toBeInTheDocument()
  })

  it('filtra por competição não suportada', async () => {
    vi.stubGlobal('fetch', mockFetch(defaultBody))
    render(<AdminRadarPage />)
    await screen.findByText('CONMEBOL Libertadores')

    await userEvent.click(screen.getByLabelText('Só não suportadas'))

    expect(screen.getByText('CONMEBOL Libertadores')).toBeInTheDocument()
    expect(screen.queryByText('Serie A')).not.toBeInTheDocument()
  })

  it('busca por nome ou país', async () => {
    vi.stubGlobal('fetch', mockFetch(defaultBody))
    render(<AdminRadarPage />)
    await screen.findByText('CONMEBOL Libertadores')

    await userEvent.type(screen.getByLabelText('Buscar competição'), 'brazil')

    expect(screen.getByText('Serie A')).toBeInTheDocument()
    expect(screen.queryByText('CONMEBOL Libertadores')).not.toBeInTheDocument()
  })

  it('esconde competição encerrada por padrão e mostra ao ver todas', async () => {
    const encerrada = item({ id: 'x', name: 'Copa Antiga', status: 'finished' })
    vi.stubGlobal('fetch', mockFetch({ ...defaultBody, items: [item(), encerrada] }))
    render(<AdminRadarPage />)
    await screen.findByText('CONMEBOL Libertadores')

    expect(screen.queryByText('Copa Antiga')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Todas' }))

    expect(screen.getByText('Copa Antiga')).toBeInTheDocument()
  })

  it('lista as competições a começar com a contagem para a estreia', async () => {
    const emTresDias = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
    const emSeisMeses = new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10)
    const futuras = [
      item({ id: 'p', name: 'Premier League', status: 'upcoming', startsOn: emTresDias }),
      item({ id: 'n', name: 'Nations League', status: 'upcoming', startsOn: emSeisMeses }),
    ]
    vi.stubGlobal('fetch', mockFetch({ ...defaultBody, items: [item(), ...futuras] }))
    render(<AdminRadarPage />)
    await screen.findByText('CONMEBOL Libertadores')

    // Em andamento por padrão: as futuras estão escondidas.
    expect(screen.queryByText('Premier League')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'A começar' }))

    expect(screen.getByText('estreia em 3 dias')).toBeInTheDocument()
    expect(screen.getByText('estreia em 6 meses')).toBeInTheDocument()
    // Em andamento sai de cena, e a estreia mais próxima manda na ordem.
    expect(screen.queryByText('CONMEBOL Libertadores')).not.toBeInTheDocument()
    const rows = screen.getAllByRole('row').slice(1) // pula o cabeçalho
    expect(rows[0]).toHaveTextContent('Premier League')
  })

  it('lista as competições sem artigo mapeado como fila de curadoria', async () => {
    const semArtigo = item({
      id: 'y',
      name: 'Copa Do Brasil Sub 20',
      country: 'Brazil',
      wikiArticle: null,
      pageviewsAvg: null,
      pageviewsTrend: null,
      pageviewsSeries: [],
    })
    vi.stubGlobal('fetch', mockFetch({ ...defaultBody, items: [item(), semArtigo] }))
    render(<AdminRadarPage />)

    expect(await screen.findByText('Sem sinal de interesse')).toBeInTheDocument()
    expect(screen.getByText('sem artigo')).toBeInTheDocument()
  })

  it('avisa quando o snapshot está velho (cron parado)', async () => {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')
    vi.stubGlobal('fetch', mockFetch({ ...defaultBody, lastSync: old }))
    render(<AdminRadarPage />)

    expect(await screen.findByText(/o cron do radar pode estar parado/)).toBeInTheDocument()
  })
})

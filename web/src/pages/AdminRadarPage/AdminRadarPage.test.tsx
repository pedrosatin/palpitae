import { render, screen, waitFor, within } from '@testing-library/react'
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

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise((r) => setTimeout(r, 0))
const daysOf = (url: string) => new URL(url, 'http://x').searchParams.get('days')

function radarBody(name: string, days: number) {
  return { ...defaultBody, days, items: [item({ id: `id-${name}`, name })] }
}

// Fetch por período: cada `days` tem a sua resposta, controlada pelo teste.
function fetchByDays(byDays: Record<string, () => Promise<unknown>>) {
  return vi.fn((url: string) => byDays[daysOf(url) ?? '']())
}

const okResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body })
const failedResponse = () => ({ ok: false, status: 500, json: async () => ({}) })

describe('AdminRadarPage: respostas fora de ordem', () => {
  it('descarta o corpo do período anterior que chega depois do atual', async () => {
    const corpo30 = deferred<unknown>()
    vi.stubGlobal(
      'fetch',
      fetchByDays({
        // O cabeçalho do período de 30 dias chega, o corpo demora.
        '30': async () => ({ ok: true, status: 200, json: () => corpo30.promise }),
        '7': async () => okResponse(radarBody('Liga dos 7 dias', 7)),
      }),
    )
    const user = userEvent.setup()
    render(<AdminRadarPage />)

    await user.click(screen.getByRole('button', { name: '7d' }))
    expect(await screen.findByText('Liga dos 7 dias')).toBeInTheDocument()

    corpo30.resolve(radarBody('Liga dos 30 dias', 30))
    await flush()

    expect(screen.getByText('Liga dos 7 dias')).toBeInTheDocument()
    expect(screen.queryByText('Liga dos 30 dias')).not.toBeInTheDocument()
  })

  it('ignora o erro tardio do período anterior', async () => {
    const pedido30 = deferred<unknown>()
    vi.stubGlobal(
      'fetch',
      fetchByDays({
        '30': () => pedido30.promise,
        '7': async () => okResponse(radarBody('Liga dos 7 dias', 7)),
      }),
    )
    const user = userEvent.setup()
    render(<AdminRadarPage />)

    await user.click(screen.getByRole('button', { name: '7d' }))
    expect(await screen.findByText('Liga dos 7 dias')).toBeInTheDocument()

    pedido30.reject(new TypeError('Failed to fetch'))
    await flush()

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Liga dos 7 dias')).toBeInTheDocument()
  })

  it('não mostra dados do período anterior quando o atual falha', async () => {
    vi.stubGlobal(
      'fetch',
      fetchByDays({
        '30': async () => okResponse(radarBody('Liga dos 30 dias', 30)),
        '7': async () => failedResponse(),
      }),
    )
    const user = userEvent.setup()
    render(<AdminRadarPage />)
    expect(await screen.findByText('Liga dos 30 dias')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '7d' }))

    expect(await screen.findByText(/Falha ao carregar o radar/)).toBeInTheDocument()
    expect(screen.queryByText('Liga dos 30 dias')).not.toBeInTheDocument()
    expect(screen.queryByText('Carregando…')).not.toBeInTheDocument()
  })

  it('tentar novamente refaz o pedido do período selecionado', async () => {
    let falhas = 1
    const fetchFake = fetchByDays({
      '30': async () => okResponse(radarBody('Liga dos 30 dias', 30)),
      '7': async () =>
        falhas-- > 0 ? failedResponse() : okResponse(radarBody('Liga dos 7 dias', 7)),
    })
    vi.stubGlobal('fetch', fetchFake)
    const user = userEvent.setup()
    render(<AdminRadarPage />)
    await screen.findByText('Liga dos 30 dias')
    await user.click(screen.getByRole('button', { name: '7d' }))
    await screen.findByText(/Falha ao carregar o radar/)

    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }))

    expect(await screen.findByText('Liga dos 7 dias')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText('Carregando…')).not.toBeInTheDocument()
    expect(fetchFake.mock.calls.filter(([url]) => daysOf(url) === '7')).toHaveLength(2)
  })

  it('desmontar com pedido pendente não atualiza nada depois', async () => {
    const corpo30 = deferred<unknown>()
    vi.stubGlobal(
      'fetch',
      fetchByDays({
        '30': async () => ({ ok: true, status: 200, json: () => corpo30.promise }),
      }),
    )
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { unmount } = render(<AdminRadarPage />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())

    unmount()
    corpo30.resolve(radarBody('Liga dos 30 dias', 30))
    await flush()

    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})

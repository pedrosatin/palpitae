import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { trackEvent } from '../../analytics/ga'
import AdminMetricsPage from './AdminMetricsPage'

vi.mock('../../analytics/ga', () => ({ trackEvent: vi.fn() }))

const overview = {
  days: 30,
  totals: [
    { event_type: 'login_success', count: '12' },
    { event_type: 'group_created', count: '2' },
    { event_type: 'group_joined', count: '5' },
  ],
  daily: [{ day: '2026-06-29 00:00:00', event_type: 'login_success', count: '12' }],
  poller: [
    {
      status: 'ok',
      runs: '48',
      avg_duration_ms: '850',
      max_duration_ms: '2100',
    },
  ],
  predictions: { active_users: '7', total: '37' },
  cache: [
    { result: 'hit', count: '90' },
    { result: 'miss', count: '10' },
  ],
  loginFailures: [{ reason: 'session_expired', count: '3' }],
  apiCallsDaily: [{ day: '2026-06-29 00:00:00', api_calls: '42' }],
  recentErrors: [
    {
      timestamp: '2026-06-29 14:30:00',
      event_type: 'oauth_error',
      blob2: 'access_denied',
      blob3: '',
      blob4: '',
    },
  ],
  sampling: { avg_sample_interval: '1' },
  whales: [{ user_hash: 'aa11bb22', predictions: '20' }],
  // Última execução há ~5 min — formato UTC da SQL API ("YYYY-MM-DD hh:mm:ss").
  lastRuns: [
    {
      event_type: 'poller_run',
      last_run: new Date(Date.now() - 5 * 60_000).toISOString().slice(0, 19).replace('T', ' '),
    },
  ],
  emailHealth: { rounds: '3', sent: '25', failed: '0' },
  latency: [
    { route: 'GET /matches', requests: '100', avg_ms: '45', max_ms: '320', avg_db_ms: '12' },
  ],
  predictionsDaily: [{ day: '2026-06-29 00:00:00', users: '7' }],
}

// A tabela do arquivo R2 é montada a partir da data corrente (ontem pra trás),
// então a chave do mock precisa ser relativa a "ontem" de verdade.
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const archive = {
  files: [
    {
      key: `events/${yesterday.replaceAll('-', '/')}.ndjson`,
      size: 2048,
      uploaded: '',
      events: 42,
    },
  ],
}

const business = {
  days: 30,
  usersTotal: 20,
  usersInGroup: 12,
  usersWhoPredicted: 9,
  usersCreatedInPeriod: 3,
  groupsCreatedInPeriod: 2,
  avgGroupsPerUser: 1.5,
  medianGroupsPerUser: 1,
  topCompetitions: [{ competition: 'Brasileirão', groups: 5 }],
}

const archiveQuery = {
  from: `${yesterday.slice(0, 7)}-01`,
  to: yesterday,
  filesRead: 1,
  totalEvents: 42,
  byType: [{ event_type: 'login_success', count: 42 }],
  byDay: [{ day: yesterday, count: 42 }],
}

function mockFetch(
  overviewStatus = 200,
  overviewBody: unknown = overview,
  businessBody: unknown = business,
) {
  return vi.fn(async (url: string) => {
    if (url.includes('/metrics/overview')) {
      return {
        ok: overviewStatus === 200,
        status: overviewStatus,
        json: async () => overviewBody,
      }
    }
    if (url.includes('/metrics/archive/query')) {
      return { ok: true, status: 200, json: async () => archiveQuery }
    }
    if (url.includes('/metrics/business')) {
      return { ok: true, status: 200, json: async () => businessBody }
    }
    return { ok: true, status: 200, json: async () => archive }
  })
}

describe('AdminMetricsPage', () => {
  it('renderiza KPIs, totais, poller, falhas, erros, whales e arquivo R2', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<AdminMetricsPage />)

    // KPIs
    expect(await screen.findByText('usuários palpitando')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('37')).toBeInTheDocument()
    expect(screen.getByText('90%')).toBeInTheDocument() // 90 hits / 100
    expect(screen.getByText('2.5')).toBeInTheDocument() // 5 joined / 2 created

    // Totais + legenda do gráfico usam o rótulo de negócio (cru fica no title)
    expect(screen.getAllByText('Login').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('login_success')).not.toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.getByText('850 ms')).toBeInTheDocument()
    expect(screen.getByText('2.1 s')).toBeInTheDocument() // 2100 ms humanizado

    // Pulso dos crons: nome amigável + tempo relativo, sem alerta (recente)
    expect(screen.getByText('Poller de resultados (a cada 30 min)')).toBeInTheDocument()
    expect(screen.getByText(/há \d+ min/)).toBeInTheDocument()

    // Saúde do e-mail
    expect(screen.getByText('e-mails enviados')).toBeInTheDocument()
    expect(screen.getByText('25')).toBeInTheDocument()

    // DAU + latência por rota ("GET /matches" também é hint do KPI de cache → getAll)
    expect(screen.getByText('Usuários ativos (palpitando) por dia')).toBeInTheDocument()
    expect(screen.getByText('Latência por rota')).toBeInTheDocument()
    expect(screen.getAllByText('GET /matches').length).toBeGreaterThanOrEqual(1)

    // Concentração de palpites: top1 = top5 = round(20/37) = 54% (1 whale só)
    expect(screen.getAllByText('54%')).toHaveLength(2)

    // Falhas de login e erros recentes (evento com rótulo de negócio)
    expect(screen.getByText('session_expired')).toBeInTheDocument()
    expect(screen.getByText('Erro de OAuth')).toBeInTheDocument()
    expect(screen.getByText('access_denied')).toBeInTheDocument()
    expect(screen.getByText('29/06 14:30')).toBeInTheDocument()

    // Eixo X dos gráficos diários: o dia mais recente sempre rotulado (dd/mm)
    const today = new Date().toISOString().slice(0, 10)
    const todayTick = `${today.slice(8, 10)}/${today.slice(5, 7)}`
    expect(screen.getAllByText(todayTick).length).toBeGreaterThanOrEqual(2) // stacked + API calls

    // Arquivo R2: KPIs do acervo + histórico mensal + integridade.
    expect(screen.getByText('dias arquivados')).toBeInTheDocument()
    // eventos: KPI do acervo (sem "≥": metadata completa) + linha de integridade
    expect(screen.getAllByText('42')).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Eventos arquivados por mês' })).toBeInTheDocument()
    // ontem presente (data na tabela + KPI "desde"); dias anteriores ao primeiro
    // export = "—" (não "faltando" — export ainda não existia).
    expect(screen.getAllByText(yesterday)).toHaveLength(2)
    expect(screen.getAllByText('2.0 KB')).toHaveLength(2) // linha de ontem + KPI de tamanho total
    expect(screen.getAllByText('—')).toHaveLength(13)
    expect(screen.getAllByText('faltando')).toHaveLength(1)

    // Sem amostragem (média 1) o aviso não aparece
    expect(screen.queryByText(/amostrando/)).not.toBeInTheDocument()
  })

  it('marca como faltando um dia com buraco ENTRE exports', async () => {
    // Arquivos de ontem e de 3 dias atrás: o dia entre eles (2 atrás) falhou.
    const dayKey = (back: number) =>
      new Date(Date.now() - back * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const gappyArchive = {
      files: [1, 3].map((back) => ({
        key: `events/${dayKey(back).replaceAll('-', '/')}.ndjson`,
        size: 100,
        uploaded: '',
        events: 10,
      })),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          url.includes('/metrics/overview')
            ? overview
            : url.includes('/metrics/business')
              ? business
              : gappyArchive,
      })),
    )
    render(<AdminMetricsPage />)

    await screen.findByText(dayKey(2))
    // 1 célula "faltando" (o buraco) + 1 na legenda; dias antes do 1º export = "—".
    expect(screen.getAllByText('faltando')).toHaveLength(2)
    expect(screen.getAllByText('—')).toHaveLength(11)
  })

  it('avisa quando o Analytics Engine está amostrando', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch(200, { ...overview, sampling: { avg_sample_interval: '2.5' } }),
    )
    render(<AdminMetricsPage />)

    expect(await screen.findByText(/amostrando/)).toBeInTheDocument()
    expect(screen.getByText(/2\.50/)).toBeInTheDocument()
  })

  it('analisa o arquivo frio de um mês ao clicar no botão', async () => {
    const fetchFake = mockFetch()
    vi.stubGlobal('fetch', fetchFake)
    const user = userEvent.setup()
    render(<AdminMetricsPage />)

    // Botão do mês (YYYY-MM de "ontem") na seção de análise do arquivo.
    const month = yesterday.slice(0, 7)
    await screen.findByText('Análise do arquivo (além da janela do AE)')
    await user.click(screen.getByRole('button', { name: month }))

    // Dispara o fetch da query e renderiza o breakdown por tipo.
    await waitFor(() => {
      expect(
        fetchFake.mock.calls.some(([url]: [string]) => url.includes('/metrics/archive/query')),
      ).toBe(true)
    })
    // Linha-resumo única da seção de análise (…N arquivo(s) · M eventos).
    await screen.findByText(/arquivo\(s\)/)
  })

  it('mostra acesso restrito quando a API responde 403', async () => {
    vi.stubGlobal('fetch', mockFetch(403))
    render(<AdminMetricsPage />)

    expect(await screen.findByText('Acesso restrito ao administrador.')).toBeInTheDocument()
  })

  it('refaz o fetch ao trocar o período', async () => {
    const fetchFake = mockFetch()
    vi.stubGlobal('fetch', fetchFake)
    const user = userEvent.setup()
    render(<AdminMetricsPage />)

    await screen.findAllByText('Login')
    await user.click(screen.getByRole('button', { name: '7d' }))

    await waitFor(() => {
      const overviewCalls = fetchFake.mock.calls
        .map(([url]) => url)
        .filter((u: string) => u.includes('/metrics/overview'))
      expect(overviewCalls.some((u: string) => u.includes('days=7'))).toBe(true)
    })
  })
})

// Snapshot por campeonato da API nova. Mesmo nome em duas temporadas; uma
// temporada sem grupo nenhum; um piloto encerrado para cruzar os filtros.
const businessWithCompetitions = {
  ...business,
  activeGroupDays: 14,
  competitions: [
    {
      id: 'comp-br26',
      name: 'Brasileirão Série A',
      slug: 'brasileirao-2026',
      season: '2026',
      provider: 'football-data',
      visibility: 'public',
      status: 'ongoing',
      groups_current: 31,
      members: 140,
      active_groups_14d: 18,
    },
    {
      id: 'comp-br25',
      name: 'Brasileirão Série A',
      slug: 'brasileirao-2025',
      season: '2025',
      provider: 'football-data',
      visibility: 'public',
      status: 'finished',
      groups_current: 11,
      members: 60,
      active_groups_14d: 0,
    },
    {
      id: 'comp-liga-pilot',
      name: 'Liga Piloto',
      slug: 'liga-piloto-2026',
      season: '2026',
      provider: 'espn',
      visibility: 'pilot',
      status: 'ongoing',
      groups_current: 4,
      members: 15,
      active_groups_14d: 3,
    },
    {
      id: 'comp-copa-vazia',
      name: 'Copa Vazia',
      slug: 'copa-vazia-2026',
      season: '2026',
      provider: 'espn',
      visibility: 'pilot',
      status: 'finished',
      groups_current: 0,
      members: 0,
      active_groups_14d: 0,
    },
  ],
  topCompetitions: [{ competition: 'Brasileirão Série A', groups: 31 }],
}

function competitionCells(name: RegExp) {
  return within(screen.getByRole('row', { name }))
    .getAllByRole('cell')
    .map((c) => c.textContent)
}

describe('AdminMetricsPage · grupos por campeonato', () => {
  it('lista todas as temporadas, inclusive as sem grupo, com ativos 14d', async () => {
    vi.stubGlobal('fetch', mockFetch(200, overview, businessWithCompetitions))
    render(<AdminMetricsPage />)

    expect(await screen.findByText('Grupos por campeonato')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'ativos 14d' })).toBeInTheDocument()
    expect(screen.getByText(/4 de 4 temporada\(s\) · 1 sem grupo/)).toBeInTheDocument()
    expect(screen.getByText(/palpite nos últimos 14 dias/)).toBeInTheDocument()
    // O top 10 legado sai quando a API manda a lista completa.
    expect(screen.queryByText('Campeonatos com mais grupos ativos')).not.toBeInTheDocument()

    // Mesmo nome em temporadas diferentes vira duas linhas.
    expect(competitionCells(/Brasileirão Série A 2026/)).toEqual([
      'Brasileirão Série A',
      '2026',
      'football-data',
      'pública',
      'em andamento',
      '31',
      '140',
      '18',
    ])
    expect(competitionCells(/Brasileirão Série A 2025/)).toEqual([
      'Brasileirão Série A',
      '2025',
      'football-data',
      'pública',
      'encerrado',
      '11',
      '60',
      '0',
    ])
    // Temporada sem grupo aparece com contagens zeradas.
    expect(competitionCells(/Copa Vazia/)).toEqual([
      'Copa Vazia',
      '2026',
      'espn',
      'piloto',
      'encerrado',
      '0',
      '0',
      '0',
    ])
  })

  it('filtra por visibilidade e status', async () => {
    vi.stubGlobal('fetch', mockFetch(200, overview, businessWithCompetitions))
    const user = userEvent.setup()
    render(<AdminMetricsPage />)

    await screen.findByText('Grupos por campeonato')
    const visibility = screen.getByRole('group', { name: 'Visibilidade' })
    const status = screen.getByRole('group', { name: 'Status' })

    await user.click(within(visibility).getByRole('button', { name: 'Piloto' }))
    expect(within(visibility).getByRole('button', { name: 'Piloto' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.queryByRole('row', { name: /Brasileirão/ })).not.toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Liga Piloto/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Copa Vazia/ })).toBeInTheDocument()
    expect(screen.getByText(/2 de 4 temporada\(s\) · 1 sem grupo/)).toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith('click_admin_metrics_filtro_campeonato', {
      filter: 'visibility',
      value: 'pilot',
    })

    await user.click(within(status).getByRole('button', { name: 'Em andamento' }))
    expect(screen.getByRole('row', { name: /Liga Piloto/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Copa Vazia/ })).not.toBeInTheDocument()

    await user.click(within(visibility).getByRole('button', { name: 'Todas' }))
    await user.click(within(status).getByRole('button', { name: 'Encerrados' }))
    expect(screen.getByRole('row', { name: /Brasileirão Série A 2025/ })).toBeInTheDocument()
    expect(screen.getByRole('row', { name: /Copa Vazia/ })).toBeInTheDocument()
    expect(screen.queryByRole('row', { name: /Brasileirão Série A 2026/ })).not.toBeInTheDocument()
  })

  it('avisa quando nenhum campeonato atende aos filtros', async () => {
    const onlyPublic = {
      ...businessWithCompetitions,
      competitions: businessWithCompetitions.competitions.filter((c) => c.visibility === 'public'),
    }
    vi.stubGlobal('fetch', mockFetch(200, overview, onlyPublic))
    const user = userEvent.setup()
    render(<AdminMetricsPage />)

    await screen.findByText('Grupos por campeonato')
    await user.click(screen.getByRole('button', { name: 'Piloto' }))
    expect(screen.getByText('Nenhuma temporada com esses filtros.')).toBeInTheDocument()
  })

  it('mantém o top 10 quando a API ainda não manda a lista completa', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<AdminMetricsPage />)

    expect(await screen.findByText('Campeonatos com mais grupos ativos')).toBeInTheDocument()
    expect(screen.getByText('Brasileirão')).toBeInTheDocument()
    expect(screen.queryByText('Grupos por campeonato')).not.toBeInTheDocument()
  })
})

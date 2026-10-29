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
  opsBody: unknown = null,
  activityBody: unknown = null,
) {
  return vi.fn(async (url: string) => {
    // API sem /metrics/competition-activity (deploy da web antes da API): 404.
    if (url.includes('/metrics/competition-activity')) {
      return activityBody === null
        ? { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
        : { ok: true, status: 200, json: async () => activityBody }
    }
    // API sem /metrics/ops (deploy da web antes da API): 404.
    if (url.includes('/metrics/ops')) {
      return opsBody === null
        ? { ok: false, status: 404, json: async () => ({ error: 'not found' }) }
        : { ok: true, status: 200, json: async () => opsBody }
    }
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
      overdue_no_score: 2,
      finished_unscored: 0,
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
      overdue_no_score: 0,
      finished_unscored: 3,
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
      overdue_no_score: 1,
      finished_unscored: 0,
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
      overdue_no_score: 0,
      finished_unscored: 0,
    },
  ],
  topCompetitions: [{ competition: 'Brasileirão Série A', groups: 31 }],
}

function groupsTable() {
  return screen.getByRole('table', { name: 'Grupos por campeonato' })
}

function healthTable() {
  return screen.getByRole('table', { name: 'Saúde dos resultados por campeonato' })
}

function rowCells(table: HTMLElement, name: RegExp) {
  return within(within(table).getByRole('row', { name }))
    .getAllByRole('cell')
    .map((c) => c.textContent)
}

function competitionCells(name: RegExp) {
  return rowCells(groupsTable(), name)
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
    expect(
      within(groupsTable()).queryByRole('row', { name: /Brasileirão/ }),
    ).not.toBeInTheDocument()
    expect(within(groupsTable()).getByRole('row', { name: /Liga Piloto/ })).toBeInTheDocument()
    expect(within(groupsTable()).getByRole('row', { name: /Copa Vazia/ })).toBeInTheDocument()
    expect(screen.getByText(/2 de 4 temporada\(s\) · 1 sem grupo/)).toBeInTheDocument()
    expect(trackEvent).toHaveBeenCalledWith('click_admin_metrics_filtro_campeonato', {
      filter: 'visibility',
      value: 'pilot',
    })

    await user.click(within(status).getByRole('button', { name: 'Em andamento' }))
    expect(within(groupsTable()).getByRole('row', { name: /Liga Piloto/ })).toBeInTheDocument()
    expect(within(groupsTable()).queryByRole('row', { name: /Copa Vazia/ })).not.toBeInTheDocument()

    await user.click(within(visibility).getByRole('button', { name: 'Todas' }))
    await user.click(within(status).getByRole('button', { name: 'Encerrados' }))
    expect(
      within(groupsTable()).getByRole('row', { name: /Brasileirão Série A 2025/ }),
    ).toBeInTheDocument()
    expect(within(groupsTable()).getByRole('row', { name: /Copa Vazia/ })).toBeInTheDocument()
    expect(
      within(groupsTable()).queryByRole('row', { name: /Brasileirão Série A 2026/ }),
    ).not.toBeInTheDocument()
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

describe('AdminMetricsPage · saúde dos resultados por campeonato', () => {
  it('mostra atrasados e encerrados sem pontuação por temporada, pendências primeiro', async () => {
    vi.stubGlobal('fetch', mockFetch(200, overview, businessWithCompetitions))
    render(<AdminMetricsPage />)

    expect(await screen.findByText('Saúde dos resultados por campeonato')).toBeInTheDocument()
    const table = healthTable()
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual([
      'campeonato',
      'temporada',
      'status',
      'atrasados sem placar',
      'encerrados sem pontuação',
    ])
    expect(
      screen.getByText(/2 temporada\(s\) com jogo atrasado · 1 com jogo encerrado sem pontuação/),
    ).toBeInTheDocument()
    expect(screen.getByText(/3h após o início \(adiados ficam de fora\)/)).toBeInTheDocument()

    // Mesmo nome em duas temporadas: cada uma com seus números.
    expect(rowCells(table, /Brasileirão Série A 2026/)).toEqual([
      'Brasileirão Série A',
      '2026',
      'em andamento',
      '2',
      '0',
    ])
    expect(rowCells(table, /Brasileirão Série A 2025/)).toEqual([
      'Brasileirão Série A',
      '2025',
      'encerrado',
      '0',
      '3',
    ])
    // Zero explícito, não ausência.
    expect(rowCells(table, /Copa Vazia/)).toEqual(['Copa Vazia', '2026', 'encerrado', '0', '0'])

    // Maior pendência (3) → 2 → 1 → sem pendência.
    const order = within(table)
      .getAllByRole('row')
      .slice(1)
      .map(
        (r) =>
          within(r).getAllByRole('cell')[0].textContent +
          ' ' +
          within(r).getAllByRole('cell')[1].textContent,
      )
    expect(order).toEqual([
      'Brasileirão Série A 2025',
      'Brasileirão Série A 2026',
      'Liga Piloto 2026',
      'Copa Vazia 2026',
    ])
  })

  it('não é afetada pelos filtros da lista de grupos', async () => {
    vi.stubGlobal('fetch', mockFetch(200, overview, businessWithCompetitions))
    const user = userEvent.setup()
    render(<AdminMetricsPage />)

    await screen.findByText('Saúde dos resultados por campeonato')
    await user.click(screen.getByRole('button', { name: 'Piloto' }))

    expect(
      within(groupsTable()).queryByRole('row', { name: /Brasileirão/ }),
    ).not.toBeInTheDocument()
    expect(within(healthTable()).getAllByRole('row')).toHaveLength(5)
  })

  it('mostra zeros e nenhum alerta quando não há pendência', async () => {
    const clean = {
      ...businessWithCompetitions,
      competitions: businessWithCompetitions.competitions.map((c) => ({
        ...c,
        overdue_no_score: 0,
        finished_unscored: 0,
      })),
    }
    vi.stubGlobal('fetch', mockFetch(200, overview, clean))
    render(<AdminMetricsPage />)

    await screen.findByText('Saúde dos resultados por campeonato')
    expect(
      screen.getByText(/0 temporada\(s\) com jogo atrasado · 0 com jogo encerrado sem pontuação/),
    ).toBeInTheDocument()
    expect(rowCells(healthTable(), /Brasileirão Série A 2026/).slice(3)).toEqual(['0', '0'])
  })

  it('avisa que não há dados quando a API ainda não manda os números', async () => {
    const withoutHealth = {
      ...businessWithCompetitions,
      competitions: businessWithCompetitions.competitions.map(
        ({ overdue_no_score: _o, finished_unscored: _u, ...rest }) => rest,
      ),
    }
    vi.stubGlobal('fetch', mockFetch(200, overview, withoutHealth))
    render(<AdminMetricsPage />)

    expect(await screen.findByText('Saúde dos resultados por campeonato')).toBeInTheDocument()
    expect(
      screen.getByText('Indisponível: a API ainda não envia esses números.'),
    ).toBeInTheDocument()
    // Sem tabela: ausência não vira zero. A lista de grupos segue normal.
    expect(
      screen.queryByRole('table', { name: 'Saúde dos resultados por campeonato' }),
    ).not.toBeInTheDocument()
    expect(groupsTable()).toBeInTheDocument()
  })

  it('usa "—" na linha que veio sem os números', async () => {
    const [first, ...rest] = businessWithCompetitions.competitions
    const { overdue_no_score: _o, finished_unscored: _u, ...legacyRow } = first
    vi.stubGlobal(
      'fetch',
      mockFetch(200, overview, { ...businessWithCompetitions, competitions: [legacyRow, ...rest] }),
    )
    render(<AdminMetricsPage />)

    await screen.findByText('Saúde dos resultados por campeonato')
    expect(rowCells(healthTable(), /Brasileirão Série A 2026/).slice(3)).toEqual(['—', '—'])
    expect(rowCells(healthTable(), /Brasileirão Série A 2025/).slice(3)).toEqual(['0', '3'])
  })

  it('não mostra a seção na API antiga (só top 10) nem sem temporadas cadastradas', async () => {
    vi.stubGlobal('fetch', mockFetch())
    const { unmount } = render(<AdminMetricsPage />)
    await screen.findByText('Campeonatos com mais grupos ativos')
    expect(screen.queryByText('Saúde dos resultados por campeonato')).not.toBeInTheDocument()
    unmount()

    vi.stubGlobal(
      'fetch',
      mockFetch(200, overview, { ...businessWithCompetitions, competitions: [] }),
    )
    render(<AdminMetricsPage />)
    await screen.findByText('Grupos por campeonato')
    expect(screen.queryByText('Saúde dos resultados por campeonato')).not.toBeInTheDocument()
  })
})

// Provedores: tentativas HTTP, erros de sync e fallback (GET /metrics/ops).
const opsBody = {
  days: 30,
  httpFirstSeenAt: '2020-01-01 00:00:00',
  httpByProvider: [
    {
      provider: 'espn',
      context: 'poller',
      status: '403',
      attempts: 7,
      events: 7,
      avg_ms: 220,
      max_ms: 900,
    },
    {
      provider: 'espn',
      context: 'poller',
      status: '200',
      attempts: 200,
      events: 20,
      avg_ms: 90,
      max_ms: 400,
    },
  ],
  httpByCompetition: [
    {
      competition_id: 'comp-liga-pilot',
      provider: 'espn',
      status: '403',
      attempts: 7,
      events: 7,
      avg_ms: 220,
      max_ms: 900,
    },
  ],
  apiErrors: [{ context: 'fixture_discovery', competition_id: 'comp-liga-pilot', count: 2 }],
  fallback: [{ competition_id: 'comp-br26', runs: 6, updated: 1, skipped: 5, failures: 0 }],
}

describe('AdminMetricsPage · provedores de partidas', () => {
  it('busca /metrics/ops com o período e mostra falhas por provedor, processo e campeonato', async () => {
    const fetchFake = mockFetch(200, overview, businessWithCompetitions, opsBody)
    vi.stubGlobal('fetch', fetchFake)
    render(<AdminMetricsPage />)

    expect(await screen.findByText('Provedores de partidas · falhas e carga')).toBeInTheDocument()
    const opsCall = fetchFake.mock.calls.map(([url]) => url).find((u) => u.includes('/metrics/ops'))
    expect(opsCall).toContain('days=30')

    const byProcess = screen.getByRole('table', { name: 'Tentativas HTTP por provedor e processo' })
    expect(within(byProcess).getByText('ESPN')).toBeInTheDocument()
    expect(within(byProcess).getByText('Poller de resultados')).toBeInTheDocument()
    expect(within(byProcess).getByText('403 ×7')).toBeInTheDocument()

    // Nomes vêm do snapshot de campeonatos (mesma tela, /metrics/business).
    const byCompetition = screen.getByRole('table', { name: 'Tentativas HTTP por campeonato' })
    expect(within(byCompetition).getByText('Liga Piloto 2026')).toBeInTheDocument()
    const syncTable = screen.getByRole('table', {
      name: 'Erros de sync e fallback por campeonato',
    })
    expect(within(syncTable).getByText('Liga Piloto 2026')).toBeInTheDocument()
    expect(within(syncTable).getByText('Brasileirão Série A 2026')).toBeInTheDocument()
    expect(within(syncTable).getByText('Descoberta de jogos ×2')).toBeInTheDocument()
  })

  it('falhas HTTP acendem um alerta no topo', async () => {
    vi.stubGlobal('fetch', mockFetch(200, overview, businessWithCompetitions, opsBody))
    render(<AdminMetricsPage />)

    expect(await screen.findByText(/7 falha\(s\) HTTP de provedor/)).toBeInTheDocument()
  })

  it('sem falhas HTTP não cria o alerta', async () => {
    const calm = {
      ...opsBody,
      httpByProvider: opsBody.httpByProvider.filter((r) => r.status === '200'),
    }
    vi.stubGlobal('fetch', mockFetch(200, overview, businessWithCompetitions, calm))
    render(<AdminMetricsPage />)

    await screen.findByText('Provedores de partidas · falhas e carga')
    expect(screen.queryByText(/falha\(s\) HTTP de provedor/)).not.toBeInTheDocument()
  })

  it('API sem /metrics/ops: o restante da página carrega e a seção diz "indisponível"', async () => {
    vi.stubGlobal('fetch', mockFetch(200, overview, businessWithCompetitions))
    render(<AdminMetricsPage />)

    expect(await screen.findByText('Provedores de partidas · falhas e carga')).toBeInTheDocument()
    expect(screen.getByText(/Indisponível: a API não enviou a telemetria/)).toBeInTheDocument()
    expect(screen.getByText('Saúde dos crons')).toBeInTheDocument()
    expect(screen.queryByText(/falha\(s\) HTTP de provedor/)).not.toBeInTheDocument()
  })

  it('falha de rede em /metrics/ops não derruba a página', async () => {
    const base = mockFetch(200, overview, businessWithCompetitions, opsBody)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/metrics/ops')) throw new Error('network')
        return base(url)
      }),
    )
    render(<AdminMetricsPage />)

    expect(
      await screen.findByText(/Indisponível: a API não enviou a telemetria/),
    ).toBeInTheDocument()
    expect(screen.getByText('Saúde dos crons')).toBeInTheDocument()
  })

  it('sem nenhum evento HTTP gravado avisa falta de dado em vez de zero falhas', async () => {
    const empty = { ...opsBody, httpFirstSeenAt: null, httpByProvider: [], httpByCompetition: [] }
    vi.stubGlobal('fetch', mockFetch(200, overview, businessWithCompetitions, empty))
    render(<AdminMetricsPage />)

    expect(
      await screen.findByText(/Nenhuma tentativa HTTP foi registrada ainda/),
    ).toBeInTheDocument()
  })

  it('rotula o erro de sync nos erros recentes sem chamá-lo de API Football', async () => {
    const withErrors = {
      ...overview,
      recentErrors: [
        {
          timestamp: '2026-06-29 14:30:00',
          event_type: 'football_api_error',
          blob2: 'fixture_discovery',
          blob3: 'comp-1',
          blob4: 'ESPN respondeu 403',
        },
      ],
    }
    vi.stubGlobal('fetch', mockFetch(200, withErrors, businessWithCompetitions, opsBody))
    render(<AdminMetricsPage />)

    expect(await screen.findByText('Erro de sync de provedor')).toBeInTheDocument()
    expect(screen.queryByText('Erro da API Football')).not.toBeInTheDocument()
  })
})

// Atividade por campeonato (GET /metrics/competition-activity).
const activityBody = {
  days: 30,
  predictionsDimensionSince: '2020-01-01 00:00:00',
  competitions: [
    {
      competition_id: 'comp-br26',
      name: 'Brasileirão Série A',
      season: '2026',
      groups_created: 3,
      prediction_saves: 40,
      predictions: 410,
    },
    {
      competition_id: '',
      name: null,
      season: null,
      groups_created: 0,
      prediction_saves: 12,
      predictions: 90,
    },
  ],
}

describe('AdminMetricsPage · atividade por campeonato', () => {
  it('busca /metrics/competition-activity com o período e mostra a tabela, com "sem liga"', async () => {
    const fetchFake = mockFetch(200, overview, business, null, activityBody)
    vi.stubGlobal('fetch', fetchFake)
    render(<AdminMetricsPage />)

    const table = await screen.findByRole('table', {
      name: 'Atividade por campeonato',
    })
    const call = fetchFake.mock.calls
      .map(([url]) => url)
      .find((u) => u.includes('/metrics/competition-activity'))
    expect(call).toContain('days=30')
    expect(within(table).getByText('Brasileirão Série A 2026')).toBeInTheDocument()
    expect(within(table).getByText('410')).toBeInTheDocument()
    expect(within(table).getByText('sem liga')).toBeInTheDocument()
  })

  it('API sem a rota: a página carrega e a seção diz "indisponível"', async () => {
    vi.stubGlobal('fetch', mockFetch())
    render(<AdminMetricsPage />)

    expect(await screen.findByText('Atividade por campeonato')).toBeInTheDocument()
    expect(screen.getByText(/Indisponível: a API não enviou a atividade/)).toBeInTheDocument()
    expect(screen.getByText('Saúde dos crons')).toBeInTheDocument()
  })

  it('falha de rede na rota nova não derruba a página', async () => {
    const base = mockFetch(200, overview, business, null, activityBody)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/metrics/competition-activity')) throw new Error('network')
        return base(url)
      }),
    )
    render(<AdminMetricsPage />)

    expect(
      await screen.findByText(/Indisponível: a API não enviou a atividade/),
    ).toBeInTheDocument()
    expect(screen.getByText('Saúde dos crons')).toBeInTheDocument()
  })
})

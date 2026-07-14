import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
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
    { status: 'ok', runs: '48', avg_duration_ms: '850', max_duration_ms: '2100' },
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
}

// A tabela do arquivo R2 é montada a partir da data corrente (ontem pra trás),
// então a chave do mock precisa ser relativa a "ontem" de verdade.
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const archive = {
  files: [
    { key: `events/${yesterday.replaceAll('-', '/')}.ndjson`, size: 2048, uploaded: '', events: 42 },
  ],
}

function mockFetch(overviewStatus = 200, overviewBody: unknown = overview) {
  return vi.fn(async (url: string) => {
    if (url.includes('/metrics/overview')) {
      return {
        ok: overviewStatus === 200,
        status: overviewStatus,
        json: async () => overviewBody,
      }
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
        json: async () => (url.includes('/metrics/overview') ? overview : gappyArchive),
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

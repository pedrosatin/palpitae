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
    { key: `events/${yesterday.replaceAll('-', '/')}.ndjson`, size: 2048, uploaded: '' },
  ],
}

const history = {
  days: [
    { day: '2026-06-21', events: { login_success: 4, prediction_saved: 2 }, predictions: 5 },
    { day: '2026-06-22', events: { login_success: 6, prediction_saved: 3 }, predictions: 8 },
  ],
  pending: 0,
}

function mockFetch(
  overviewStatus = 200,
  overviewBody: unknown = overview,
  historyBody: unknown = history,
) {
  return vi.fn(async (url: string) => {
    if (url.includes('/metrics/overview')) {
      return {
        ok: overviewStatus === 200,
        status: overviewStatus,
        json: async () => overviewBody,
      }
    }
    if (url.includes('/metrics/history')) {
      return { ok: true, status: 200, json: async () => historyBody }
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

    // Totais + legenda do gráfico usam o mesmo tipo
    expect(screen.getAllByText('login_success').length).toBeGreaterThanOrEqual(1)
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

    // Falhas de login e erros recentes
    expect(screen.getByText('session_expired')).toBeInTheDocument()
    expect(screen.getByText('oauth_error')).toBeInTheDocument()
    expect(screen.getByText('access_denied')).toBeInTheDocument()
    expect(screen.getByText('29/06 14:30')).toBeInTheDocument()

    // Export R2 íntegro: linha compacta com contagem e tamanho total (só o
    // dia de ontem conta — dias anteriores ao primeiro export ficam de fora).
    expect(screen.getByText(/1\/1 dias exportados/)).toBeInTheDocument()
    expect(screen.getByText(/2\.0 KB no total/)).toBeInTheDocument()

    // Histórico completo (arquivo frio): KPIs agregados + desde o 1º dia
    expect(screen.getByText(/Histórico completo · desde 2026-06-21/)).toBeInTheDocument()
    expect(screen.getByText('palpites desde o início')).toBeInTheDocument()
    expect(screen.getByText('13')).toBeInTheDocument() // 5 + 8 palpites
    expect(screen.getByText('dias arquivados')).toBeInTheDocument()

    // Sem amostragem (média 1) o aviso não aparece
    expect(screen.queryByText(/amostrando/)).not.toBeInTheDocument()
  })

  it('acusa dia faltando entre exports e avisa processamento pendente do histórico', async () => {
    // Arquivos de ontem e de 3 dias atrás: o dia entre eles (2 atrás) falhou.
    const dayKey = (back: number) =>
      new Date(Date.now() - back * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const gappyArchive = {
      files: [1, 3].map((back) => ({
        key: `events/${dayKey(back).replaceAll('-', '/')}.ndjson`,
        size: 100,
        uploaded: '',
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
            : url.includes('/metrics/history')
              ? { ...history, pending: 2 }
              : gappyArchive,
      })),
    )
    render(<AdminMetricsPage />)

    // Só o buraco conta como faltando (dias antes do 1º export ficam de fora)
    const warning = await screen.findByText(/faltando 1 dia\(s\)/)
    expect(warning.textContent).toContain(dayKey(2))
    // Backlog do histórico ainda sendo digerido pela API
    expect(screen.getByText(/Ainda processando 2 dia\(s\)/)).toBeInTheDocument()
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

    await screen.findAllByText('login_success')
    await user.click(screen.getByRole('button', { name: '7d' }))

    await waitFor(() => {
      const overviewCalls = fetchFake.mock.calls
        .map(([url]) => url)
        .filter((u: string) => u.includes('/metrics/overview'))
      expect(overviewCalls.some((u: string) => u.includes('days=7'))).toBe(true)
    })
  })
})

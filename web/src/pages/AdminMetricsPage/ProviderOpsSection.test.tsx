import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ProviderOpsSection, {
  isFailureStatus,
  summarizeHttp,
  totalHttpFailures,
  type CompetitionNames,
  type OpsResponse,
} from './ProviderOpsSection'

const COMP_A = '11111111-2222-4333-8444-555555555555'
const COMP_B = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const COMP_UNKNOWN = '99999999-0000-4000-8000-000000000000'

const names: CompetitionNames = new Map([
  [COMP_A, { name: 'Brasileirão Série A', season: '2026' }],
  [COMP_B, { name: 'Libertadores', season: null }],
])

function http(
  overrides: Partial<OpsResponse['httpByProvider'][number]>,
): OpsResponse['httpByProvider'][number] {
  return {
    provider: 'espn',
    context: 'poller',
    status: '200',
    attempts: 0,
    events: 0,
    avg_ms: 100,
    max_ms: 200,
    ...overrides,
  }
}

function makeOps(overrides: Partial<OpsResponse> = {}): OpsResponse {
  return {
    days: 30,
    // Muito no passado: a coleta cobre o período inteiro, sem aviso.
    httpFirstSeenAt: '2020-01-01 00:00:00',
    httpByProvider: [],
    httpByCompetition: [],
    apiErrors: [],
    fallback: [],
    ...overrides,
  }
}

describe('ProviderOpsSection', () => {
  it('sem a resposta da API avisa que está indisponível, sem apresentar zero', () => {
    render(<ProviderOpsSection ops={null} names={names} />)

    expect(screen.getByText(/Indisponível: a API não enviou a telemetria/)).toBeInTheDocument()
    expect(screen.getByText(/não significa zero falhas/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('resposta malformada (API antiga/mock errado) também cai em indisponível', () => {
    render(<ProviderOpsSection ops={{ files: [] } as unknown as OpsResponse} names={names} />)

    expect(screen.getByText(/Indisponível/)).toBeInTheDocument()
  })

  it('coleta nunca gravou evento: avisa falta de dado, não zero falhas', () => {
    render(<ProviderOpsSection ops={makeOps({ httpFirstSeenAt: null })} names={names} />)

    expect(screen.getByText(/Nenhuma tentativa HTTP foi registrada ainda/)).toBeInTheDocument()
    expect(screen.getByText(/falta de dado, não zero falhas/)).toBeInTheDocument()
    expect(screen.getByText('Nenhuma tentativa HTTP registrada no período.')).toBeInTheDocument()
  })

  it('coleta mais nova que o período: informa desde quando existe dado', () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')
    render(<ProviderOpsSection ops={makeOps({ httpFirstSeenAt: recent })} names={names} />)

    expect(screen.getByText(/A coleta de tentativas HTTP começou em/)).toBeInTheDocument()
    expect(screen.getByText(/não significa zero falhas/)).toBeInTheDocument()
  })

  it('coleta anterior ao período não mostra aviso de início', () => {
    render(<ProviderOpsSection ops={makeOps()} names={names} />)

    expect(screen.queryByText(/A coleta de tentativas HTTP começou/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Nenhuma tentativa HTTP foi registrada ainda/),
    ).not.toBeInTheDocument()
  })

  it('agrega por provedor e processo com rótulos legíveis, falhas por status e sucesso como estimativa', () => {
    render(
      <ProviderOpsSection
        ops={makeOps({
          httpByProvider: [
            http({ status: '200', attempts: 300, events: 30, avg_ms: 80 }),
            http({ status: '403', attempts: 12, events: 12, avg_ms: 200 }),
            http({ status: '0', attempts: 3, events: 3, avg_ms: 10000 }),
            http({ provider: 'football-data', context: 'discovery', status: '429', attempts: 2 }),
          ],
        })}
        names={names}
      />,
    )

    const table = screen.getByRole('table', { name: 'Tentativas HTTP por provedor e processo' })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)

    // Ordenado por falhas: ESPN/poller (15 falhas) antes de football-data (2).
    const espn = within(rows[0])
    expect(espn.getByText('ESPN')).toBeInTheDocument()
    expect(espn.getByText('Poller de resultados')).toBeInTheDocument()
    // 300 + 12 + 3 = 315 tentativas estimadas; sucesso amostrado → "≈".
    expect(espn.getByText('≈315')).toBeInTheDocument()
    expect(espn.getByText('15')).toBeInTheDocument()
    expect(espn.getByText('4,8%')).toBeInTheDocument() // 15 / 315
    expect(espn.getByText('403 ×12 · sem resposta ×3')).toBeInTheDocument()

    const fd = within(rows[1])
    expect(fd.getByText('football-data.org')).toBeInTheDocument()
    expect(fd.getByText('Descoberta de jogos')).toBeInTheDocument()
    // Só falhas (contagem exata): sem "≈".
    expect(fd.queryByText(/≈/)).not.toBeInTheDocument()
    expect(fd.getByText('100%')).toBeInTheDocument()
  })

  it('mostra por campeonato com nome e temporada, "sem liga" e id curto quando o nome é desconhecido', () => {
    render(
      <ProviderOpsSection
        ops={makeOps({
          httpByCompetition: [
            { ...http({ status: '403', attempts: 5 }), competition_id: COMP_A },
            { ...http({ status: '200', attempts: 100 }), competition_id: COMP_A },
            { ...http({ status: '500', attempts: 1 }), competition_id: '' },
            { ...http({ status: '429', attempts: 2 }), competition_id: COMP_UNKNOWN },
            { ...http({ status: '200', attempts: 50 }), competition_id: COMP_B },
          ],
        })}
        names={names}
      />,
    )

    const table = screen.getByRole('table', { name: 'Tentativas HTTP por campeonato' })
    expect(within(table).getByText('Brasileirão Série A 2026')).toBeInTheDocument()
    expect(within(table).getByText('sem liga')).toBeInTheDocument()
    expect(within(table).getByText('Campeonato 99999999')).toBeInTheDocument()
    expect(within(table).getByText('Libertadores')).toBeInTheDocument()
    expect(screen.getByText(/Linha ausente é falta de dado, não prova de zero/)).toBeInTheDocument()

    // Mesma competição e provedor somam: 5 falhas em 105 tentativas.
    const brasileirao = within(table).getByText('Brasileirão Série A 2026').closest('tr')!
    expect(within(brasileirao).getByText('≈105')).toBeInTheDocument()
    expect(within(brasileirao).getByText('4,8%')).toBeInTheDocument()
  })

  it('combina erros de sync (qualquer provedor) e fallback por campeonato', () => {
    render(
      <ProviderOpsSection
        ops={makeOps({
          apiErrors: [
            { context: 'poller', competition_id: COMP_A, count: 3 },
            { context: 'fixture_discovery', competition_id: COMP_A, count: 1 },
            { context: 'sync_endpoint', competition_id: '', count: 2 },
          ],
          fallback: [
            { competition_id: COMP_A, runs: 10, updated: 7, skipped: 3, failures: 1 },
            { competition_id: COMP_B, runs: 5, updated: 0, skipped: 0, failures: 0 },
          ],
        })}
        names={names}
      />,
    )

    const table = screen.getByRole('table', { name: 'Erros de sync e fallback por campeonato' })
    const rows = within(table).getAllByRole('row').slice(1)
    const brasileirao = within(rows[0])
    expect(brasileirao.getByText('Brasileirão Série A 2026')).toBeInTheDocument()
    expect(brasileirao.getByText('4')).toBeInTheDocument() // erros: 3 + 1
    expect(
      brasileirao.getByText('Poller de resultados ×3 · Descoberta de jogos ×1'),
    ).toBeInTheDocument()
    expect(brasileirao.getByText('10')).toBeInTheDocument() // execuções do fallback
    expect(brasileirao.getByText('7')).toBeInTheDocument() // jogos atualizados pelo fallback

    expect(within(table).getByText('sem liga')).toBeInTheDocument()
    expect(within(table).getByText('Sincronização manual ×2')).toBeInTheDocument()
    expect(screen.getByText(/Erros de sync valem para qualquer provedor/)).toBeInTheDocument()
    // Nunca apresenta o erro de sync como exclusivo da football-data.
    expect(screen.queryByText(/API Football/)).not.toBeInTheDocument()
  })

  it('sem erros nem fallback diz que não houve registro, sem tabela', () => {
    render(<ProviderOpsSection ops={makeOps()} names={names} />)

    expect(
      screen.getByText('Nenhum erro de sync nem execução do fallback de resultados no período.'),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('table', { name: 'Erros de sync e fallback por campeonato' }),
    ).not.toBeInTheDocument()
  })

  it('deixa claro que as falhas são todas registradas e os sucessos amostrados (~10%)', () => {
    render(<ProviderOpsSection ops={makeOps()} names={names} />)

    expect(screen.getByText(/sucessos entram numa amostra de ~10%/)).toBeInTheDocument()
  })
})

describe('helpers de HTTP', () => {
  it.each([
    ['0', true],
    ['200', false],
    ['304', false],
    ['400', true],
    ['429', true],
    ['500', true],
  ])('status %s → falha=%s', (status, failure) => {
    expect(isFailureStatus(status)).toBe(failure)
  })

  it('summarizeHttp soma por chave e separa falhas por status', () => {
    const totals = summarizeHttp(
      [
        http({ status: '200', attempts: 90, avg_ms: 100 }),
        http({ status: '429', attempts: 10, avg_ms: 300 }),
      ],
      (r) => r.provider,
    )

    const espn = totals.get('espn')!
    expect(espn.attempts).toBe(100)
    expect(espn.failures).toBe(10)
    expect(espn.sampled).toBe(true)
    expect(espn.weightedMs / espn.attempts).toBe(120)
    expect([...espn.failuresByStatus]).toEqual([['429', 10]])
  })

  it('totalHttpFailures ignora sucessos e tolera resposta ausente ou malformada', () => {
    expect(totalHttpFailures(null)).toBe(0)
    expect(totalHttpFailures({ files: [] } as unknown as OpsResponse)).toBe(0)
    expect(
      totalHttpFailures(
        makeOps({
          httpByProvider: [
            http({ status: '200', attempts: 500 }),
            http({ status: '403', attempts: 4 }),
            http({ status: '0', attempts: 1 }),
          ],
        }),
      ),
    ).toBe(5)
  })
})

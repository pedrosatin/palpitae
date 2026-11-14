import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import QuotaUsageSection, { type QuotaUsageResponse } from './QuotaUsageSection'

const measured: QuotaUsageResponse = {
  latest: {
    day: '2026-11-13',
    measuredAt: '2026-11-14 00:05:03',
    metrics: [
      { metric: 'd1_rows_read', used: 4_250_000, limit: 5_000_000, percent: 85, threshold: 80 },
      { metric: 'd1_rows_written', used: 60_000, limit: 100_000, percent: 60, threshold: 50 },
      { metric: 'worker_requests', used: 12_345, limit: 100_000, percent: 12.3, threshold: null },
    ],
  },
}

function row(label: string): (string | null)[] {
  return within(screen.getByText(label).closest('tr') as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
}

describe('QuotaUsageSection', () => {
  it('mostra o dia medido e o uso, a cota e o percentual de cada métrica', () => {
    render(<QuotaUsageSection data={measured} />)

    expect(screen.getByText('Cotas do plano Free · 13/11/2026 (UTC)')).toBeInTheDocument()
    expect(row('linhas lidas do D1')).toEqual([
      'linhas lidas do D1',
      '4.250.000',
      '5.000.000',
      '85% · acima de 80%',
    ])
    expect(row('linhas escritas do D1')).toEqual([
      'linhas escritas do D1',
      '60.000',
      '100.000',
      '60% · acima de 50%',
    ])
    expect(row('requisições dos Workers')).toEqual([
      'requisições dos Workers',
      '12.345',
      '100.000',
      '12,3%',
    ])
    expect(screen.getByText(/Medido em 14\/11 00:05 UTC/)).toBeInTheDocument()
  })

  it('destaca a faixa de alerta de cada métrica', () => {
    render(<QuotaUsageSection data={measured} />)

    expect(screen.getByText('85% · acima de 80%').className).toContain('statusError')
    expect(screen.getByText('60% · acima de 50%').className).toContain('statusWarn')
    expect(screen.getByText('12,3%').className).not.toMatch(/status/)
  })

  it('sem medição explica o que falta, sem tratar como zero', () => {
    render(<QuotaUsageSection data={{ latest: null }} />)

    expect(screen.getByText(/Nenhuma medição ainda/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('mostra indisponível numa API sem a rota ou com corpo inesperado', () => {
    const { rerender } = render(<QuotaUsageSection data={null} />)
    expect(
      screen.getByText('Indisponível: a API ainda não envia o uso das cotas.'),
    ).toBeInTheDocument()

    rerender(<QuotaUsageSection data={{ files: [] } as unknown as QuotaUsageResponse} />)
    expect(
      screen.getByText('Indisponível: a API ainda não envia o uso das cotas.'),
    ).toBeInTheDocument()
  })
})

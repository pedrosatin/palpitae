import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import InviteFunnelSection, { type InviteFunnelResponse } from './InviteFunnelSection'

const OLD = '2026-01-01 10:00:00'

function funnel(overrides: Partial<InviteFunnelResponse> = {}): InviteFunnelResponse {
  return {
    days: 30,
    opens: 20,
    joins: 8,
    joinsByMethod: { convite_link: 5, codigo: 3, unknown: 0 },
    newMembers: 2,
    existingMembers: 6,
    unclassifiedJoins: 0,
    d1: { joins: 7, newMembers: 2, existingMembers: 5 },
    opensSince: OLD,
    joinDimensionSince: OLD,
    avgSampleInterval: 1,
    ...overrides,
  }
}

function row(label: string): HTMLElement[] {
  return within(screen.getByText(label).closest('tr') as HTMLElement).getAllByRole('cell')
}

describe('InviteFunnelSection', () => {
  it('mostra as quatro etapas com o evento e o D1 lado a lado', () => {
    render(<InviteFunnelSection data={funnel()} />)

    expect(screen.getByText('Funil de convite · últimos 30 dias')).toBeInTheDocument()
    expect(row('aberturas do convite').map((c) => c.textContent)).toEqual([
      'aberturas do convite',
      '20',
      '—',
    ])
    expect(row('entradas em grupo').map((c) => c.textContent)).toEqual([
      'entradas em grupo',
      '8',
      '7',
    ])
    expect(row('convidados novos').map((c) => c.textContent)).toEqual([
      'convidados novos',
      '2',
      '2',
    ])
    expect(row('convidados que já tinham conta').map((c) => c.textContent)).toEqual([
      'convidados que já tinham conta',
      '6',
      '5',
    ])
  })

  it('calcula a taxa só com as entradas por link e detalha o método', () => {
    render(<InviteFunnelSection data={funnel()} />)

    const hint = screen.getByText(/Taxa aberturas/)
    expect(within(hint).getByText('25%')).toBeInTheDocument()
    expect(hint.textContent).toContain('por link: 5')
    expect(hint.textContent).toContain('por código: 3')
    expect(hint.textContent).not.toContain('sem método')
  })

  it('não calcula taxa sem aberturas', () => {
    render(<InviteFunnelSection data={funnel({ opens: 0 })} />)

    expect(within(screen.getByText(/Taxa aberturas/)).getByText('—')).toBeInTheDocument()
  })

  it('mostra entradas sem classificação e sem método só quando existem', () => {
    const { rerender } = render(<InviteFunnelSection data={funnel()} />)
    expect(screen.queryByText('entradas sem classificação')).not.toBeInTheDocument()

    rerender(
      <InviteFunnelSection
        data={funnel({
          unclassifiedJoins: 4,
          joinsByMethod: { convite_link: 5, codigo: 3, unknown: 4 },
        })}
      />,
    )

    expect(row('entradas sem classificação')[1]).toHaveTextContent('4')
    expect(screen.getByText(/Taxa aberturas/).textContent).toContain('sem método: 4')
  })

  it('avisa que falta dado em vez de mostrar zero quando a coleta não começou', () => {
    render(
      <InviteFunnelSection
        data={funnel({ opens: 0, opensSince: null, joinDimensionSince: null })}
      />,
    )

    expect(screen.getByText(/^Aberturas: nenhum registro ainda/)).toBeInTheDocument()
    expect(
      screen.getByText(/^Método e cadastro recente das entradas: nenhum registro ainda/),
    ).toBeInTheDocument()
  })

  it('avisa quando a coleta é mais nova que o período', () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')

    render(<InviteFunnelSection data={funnel({ opensSince: recent })} />)

    expect(screen.getByText(/^Aberturas: a coleta começou em/)).toBeInTheDocument()
    expect(screen.queryByText(/^Método e cadastro recente/)).not.toBeInTheDocument()
  })

  it('não avisa quando a coleta cobre o período', () => {
    render(<InviteFunnelSection data={funnel()} />)

    expect(screen.queryByText(/nenhum registro ainda/)).not.toBeInTheDocument()
    expect(screen.queryByText(/a coleta começou/)).not.toBeInTheDocument()
  })

  it('marca estimativa sob sampling, sem mexer no D1', () => {
    render(<InviteFunnelSection data={funnel({ avgSampleInterval: 2 })} />)

    expect(screen.getByText(/as contagens de eventos deste funil são estimativas/)).toBeInTheDocument()
    expect(row('entradas em grupo')[1]).toHaveTextContent('≈ 8')
    expect(row('entradas em grupo')[2]).toHaveTextContent(/^7$/)
  })

  it.each([
    ['nulo', null],
    ['de outra forma', { files: [] } as unknown as InviteFunnelResponse],
  ])('mostra indisponível quando o dado vem %s', (_label, data) => {
    render(<InviteFunnelSection data={data} />)

    expect(
      screen.getByText('Indisponível: a API ainda não envia o funil de convite.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

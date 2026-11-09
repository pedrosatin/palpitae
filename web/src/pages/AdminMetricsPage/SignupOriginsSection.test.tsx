import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SignupOriginsSection, { type SignupOriginsResponse } from './SignupOriginsSection'

function origins(overrides: Partial<SignupOriginsResponse> = {}): SignupOriginsResponse {
  return {
    days: 30,
    origins: { convite: 4, guia: 3, busca: 2, direto: 1, desconhecida: 0 },
    guides: [
      { slug: 'planilha-de-bolao', signups: 2 },
      { slug: '', signups: 1 },
    ],
    totalEvents: 10,
    d1: { signups: 10 },
    originsSince: '2026-01-01 10:00:00',
    avgSampleInterval: 1,
    ...overrides,
  }
}

function row(label: string): (string | null)[] {
  return within(screen.getByText(label).closest('tr') as HTMLElement)
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
}

describe('SignupOriginsSection', () => {
  it('mostra cada origem com a contagem e a parte do total', () => {
    render(<SignupOriginsSection data={origins()} />)

    expect(screen.getByText('Cadastros por origem · últimos 30 dias')).toBeInTheDocument()
    expect(row('convite')).toEqual(['convite', '4', '40%'])
    expect(row('guia')).toEqual(['guia', '3', '30%'])
    expect(row('busca')).toEqual(['busca', '2', '20%'])
    expect(row('direto')).toEqual(['direto', '1', '10%'])
    expect(row('desconhecida')).toEqual(['desconhecida', '0', '0%'])
  })

  it('mostra a soma das origens ao lado do total do D1, sem diferença quando fecham', () => {
    render(<SignupOriginsSection data={origins()} />)

    expect(row('soma das origens')).toEqual(['soma das origens', '10', '—'])
    expect(row('contas criadas no D1')).toEqual(['contas criadas no D1', '10', '—'])
    expect(screen.queryByText('diferença (D1 menos eventos)')).not.toBeInTheDocument()
  })

  it('mostra a diferença quando a soma não fecha com o D1', () => {
    render(<SignupOriginsSection data={origins({ d1: { signups: 13 } })} />)

    expect(row('diferença (D1 menos eventos)')).toEqual(['diferença (D1 menos eventos)', '3', '—'])
  })

  it('lista os guias, com o slug vazio como índice', () => {
    render(<SignupOriginsSection data={origins()} />)

    expect(
      screen.getByText('Por guia: planilha-de-bolao (2) · índice dos guias (1)'),
    ).toBeInTheDocument()
  })

  it('avisa quando a coleta ainda não começou, sem tratar como zero', () => {
    render(
      <SignupOriginsSection
        data={origins({
          originsSince: null,
          totalEvents: 0,
          origins: { convite: 0, guia: 0, busca: 0, direto: 0, desconhecida: 0 },
          guides: [],
        })}
      />,
    )

    expect(screen.getByText(/Origem dos cadastros: nenhum registro ainda/)).toBeInTheDocument()
    expect(row('convite')).toEqual(['convite', '0', '—'])
  })

  it('marca as contagens como estimativa sob sampling', () => {
    render(<SignupOriginsSection data={origins({ avgSampleInterval: 2 })} />)

    expect(screen.getByText(/contagens de eventos desta seção são estimativas/)).toBeInTheDocument()
    expect(row('convite')).toEqual(['convite', '≈ 4', '40%'])
  })

  it('mostra indisponível numa API sem a rota', () => {
    render(<SignupOriginsSection data={null} />)

    expect(
      screen.getByText('Indisponível: a API ainda não envia a origem dos cadastros.'),
    ).toBeInTheDocument()
  })
})

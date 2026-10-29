import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CompetitionActivitySection, {
  type CompetitionActivityResponse,
} from './CompetitionActivitySection'

const COMP_A = '11111111-2222-4333-8444-555555555555'
const COMP_GONE = '99999999-0000-4000-8000-000000000000'

type Row = CompetitionActivityResponse['competitions'][number]

function row(overrides: Partial<Row>): Row {
  return {
    competition_id: COMP_A,
    name: 'Brasileirão Série A',
    season: '2026',
    groups_created: 0,
    prediction_saves: 0,
    predictions: 0,
    ...overrides,
  }
}

function makeData(
  overrides: Partial<CompetitionActivityResponse> = {},
): CompetitionActivityResponse {
  return {
    days: 30,
    // Muito no passado: a dimensão cobre o período inteiro, sem aviso.
    predictionsDimensionSince: '2020-01-01 00:00:00',
    competitions: [],
    ...overrides,
  }
}

describe('CompetitionActivitySection', () => {
  it('sem resposta da API avisa que está indisponível, sem apresentar zero', () => {
    render(<CompetitionActivitySection data={null} />)

    expect(screen.getByText(/Indisponível: a API não enviou a atividade/)).toBeInTheDocument()
    expect(screen.getByText(/não significa zero atividade/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('resposta malformada (API antiga/mock errado) também cai em indisponível', () => {
    render(
      <CompetitionActivitySection data={{ files: [] } as unknown as CompetitionActivityResponse} />,
    )
    expect(screen.getByText(/Indisponível/)).toBeInTheDocument()
  })

  it('lista grupos criados e palpites por campeonato com nome e temporada', () => {
    render(
      <CompetitionActivitySection
        data={makeData({
          competitions: [
            row({
              groups_created: 4,
              predictions: 1200,
              prediction_saves: 310,
            }),
            row({
              competition_id: 'b',
              name: 'Libertadores',
              season: null,
              groups_created: 1,
              predictions: 20,
              prediction_saves: 8,
            }),
          ],
        })}
      />,
    )

    const table = screen.getByRole('table', {
      name: 'Atividade por campeonato',
    })
    const rows = within(table).getAllByRole('row')
    // cabeçalho + 2 linhas
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByText('Brasileirão Série A 2026')).toBeInTheDocument()
    expect(within(rows[1]).getByText('4')).toBeInTheDocument()
    expect(within(rows[1]).getByText('1.200')).toBeInTheDocument()
    expect(within(rows[1]).getByText('310')).toBeInTheDocument()
    // Sem temporada, mostra só o nome.
    expect(within(rows[2]).getByText('Libertadores')).toBeInTheDocument()
  })

  it('evento sem competition_id aparece como "sem liga"', () => {
    render(
      <CompetitionActivitySection
        data={makeData({
          competitions: [
            row({
              competition_id: '',
              name: null,
              season: null,
              predictions: 50,
              prediction_saves: 9,
            }),
          ],
        })}
      />,
    )

    const table = screen.getByRole('table', {
      name: 'Atividade por campeonato',
    })
    expect(within(table).getByText('sem liga')).toBeInTheDocument()
    expect(within(table).getByText('50')).toBeInTheDocument()
  })

  it('competição que sumiu do D1 aparece como "Campeonato" mais o início do id', () => {
    render(
      <CompetitionActivitySection
        data={makeData({
          competitions: [
            row({
              competition_id: COMP_GONE,
              name: null,
              season: null,
              groups_created: 2,
            }),
          ],
        })}
      />,
    )

    const cell = screen.getByText('Campeonato 99999999')
    expect(cell).toHaveAttribute('title', COMP_GONE)
  })

  it('período sem nenhuma atividade diz isso, em vez de tabela vazia', () => {
    render(<CompetitionActivitySection data={makeData()} />)

    expect(screen.getByText('Nenhuma criação de grupo nem palpite no período.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('dimensão nunca coletada: avisa que é falta de dado e não esconde a linha "sem liga"', () => {
    render(
      <CompetitionActivitySection
        data={makeData({
          predictionsDimensionSince: null,
          competitions: [
            row({
              competition_id: '',
              name: null,
              season: null,
              predictions: 80,
              prediction_saves: 20,
            }),
          ],
        })}
      />,
    )

    expect(
      screen.getByText(/Nenhum palpite com campeonato foi registrado ainda/),
    ).toBeInTheDocument()
    expect(screen.getByText(/falta de dado, não ausência de atividade/)).toBeInTheDocument()
    expect(screen.getByText('sem liga')).toBeInTheDocument()
  })

  it('dimensão mais nova que o período: avisa o início da coleta, sem backfill', () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ')
    render(<CompetitionActivitySection data={makeData({ predictionsDimensionSince: recent })} />)

    expect(screen.getByText(/começou a ser gravado em/)).toBeInTheDocument()
    expect(screen.getByText(/sem backfill/)).toBeInTheDocument()
  })

  it('dimensão cobrindo o período inteiro não mostra aviso de cobertura', () => {
    render(
      <CompetitionActivitySection data={makeData({ competitions: [row({ predictions: 1 })] })} />,
    )

    expect(screen.queryByText(/começou a ser gravado/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Nenhum palpite com campeonato/)).not.toBeInTheDocument()
  })
})

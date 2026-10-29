import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CompetitionActivitySection, {
  buildGroupsDailySeries,
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

describe('CompetitionActivitySection · grupos criados por dia', () => {
  const COMP_B = '66666666-7777-4888-8999-aaaaaaaaaaaa'
  type Daily = NonNullable<CompetitionActivityResponse['groupsDaily']>[number]
  const daily = (day: string, competition_id: string, groups_created: number): Daily => ({
    day,
    competition_id,
    groups_created,
  })
  const chartName = 'Grupos criados por dia, por campeonato'

  beforeEach(() => {
    // "Hoje" fixo (UTC) para o eixo do gráfico ser determinístico.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-29T15:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  const withDaily = (groupsDaily: Daily[], extra: Partial<CompetitionActivityResponse> = {}) =>
    makeData({
      days: 7,
      competitions: [
        row({ groups_created: 9 }),
        row({ competition_id: COMP_B, name: 'Libertadores', groups_created: 4 }),
      ],
      groupsDaily,
      ...extra,
    })

  it('o eixo acompanha o período: 7, 30 e 90 dias terminando hoje (UTC)', () => {
    for (const days of [7, 30, 90]) {
      const { days: axis } = buildGroupsDailySeries(withDaily([], { days }))
      expect(axis).toHaveLength(days)
      expect(axis[days - 1].label).toBe('2026-10-29')
    }
    expect(buildGroupsDailySeries(withDaily([], { days: 7 })).days[0].label).toBe('2026-10-23')
    expect(buildGroupsDailySeries(withDaily([], { days: 30 })).days[0].label).toBe('2026-09-30')
    expect(buildGroupsDailySeries(withDaily([], { days: 90 })).days[0].label).toBe('2026-08-01')
  })

  it('datas e campeonatos distintos viram segmentos no dia certo, com dias sem criação zerados', () => {
    render(
      <CompetitionActivitySection
        data={withDaily([
          daily('2026-10-24', COMP_A, 3),
          daily('2026-10-24', COMP_B, 1),
          daily('2026-10-28', COMP_A, 2),
        ])}
      />,
    )

    const chart = screen.getByRole('img', { name: chartName })
    expect(within(chart).getByText('2026-10-24 · Brasileirão Série A 2026: 3')).toBeInTheDocument()
    expect(within(chart).getByText('2026-10-24 · Libertadores 2026: 1')).toBeInTheDocument()
    expect(within(chart).getByText('2026-10-28 · Brasileirão Série A 2026: 2')).toBeInTheDocument()
    // Só 3 segmentos: Libertadores não aparece em 28/10 e nenhum dia vazio vira barra.
    expect(chart.querySelectorAll('rect')).toHaveLength(3)
    expect(screen.getByText(/Grupos criados por dia · últimos 7 dias/)).toBeInTheDocument()
  })

  it('a legenda ordena por volume do período e dá nome/temporada, id no title', () => {
    render(
      <CompetitionActivitySection
        data={withDaily([daily('2026-10-24', COMP_B, 1), daily('2026-10-25', COMP_A, 5)])}
      />,
    )
    // A legenda vem antes da tabela no DOM; o title de cada item é o id do campeonato.
    const legend = [COMP_A, COMP_B].map((id) => screen.getAllByTitle(id)[0])
    expect(legend.map((el) => el.textContent)).toEqual([
      'Brasileirão Série A 2026',
      'Libertadores 2026',
    ])
    // Brasileirão (5) vem antes de Libertadores (1) na ordem do DOM.
    expect(
      legend[0].compareDocumentPosition(legend[1]) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('histórico sem a dimensão aparece como "sem liga" na série', () => {
    render(
      <CompetitionActivitySection
        data={withDaily([daily('2026-10-26', '', 2), daily('2026-10-26', COMP_A, 1)], {
          competitions: [
            row({ groups_created: 1 }),
            row({ competition_id: '', groups_created: 2 }),
          ],
        })}
      />,
    )
    const chart = screen.getByRole('img', { name: chartName })
    expect(within(chart).getByText('2026-10-26 · sem liga: 2')).toBeInTheDocument()
  })

  it('sampling: peso fracionário é arredondado a 2 casas no gráfico', () => {
    render(
      <CompetitionActivitySection
        data={withDaily([
          daily('2026-10-27', COMP_A, 12.5),
          daily('2026-10-28', COMP_A, 0.1 + 0.2),
        ])}
      />,
    )
    const chart = screen.getByRole('img', { name: chartName })
    expect(
      within(chart).getByText('2026-10-27 · Brasileirão Série A 2026: 12.5'),
    ).toBeInTheDocument()
    expect(
      within(chart).getByText('2026-10-28 · Brasileirão Série A 2026: 0.3'),
    ).toBeInTheDocument()
  })

  it('fronteira do eixo: primeiro e último dia entram; dia parcial anterior e futuro ficam fora com aviso', () => {
    const { days, outsideAxis } = buildGroupsDailySeries(
      withDaily([
        daily('2026-10-22', COMP_A, 4), // parcial: um dia antes do eixo de 7 dias
        daily('2026-10-23', COMP_A, 1), // primeiro dia do eixo
        daily('2026-10-29', COMP_A, 2), // hoje
        daily('2026-10-30', COMP_A, 8), // futuro (relógio do navegador atrasado)
      ]),
    )
    expect(days[0].segments).toEqual([expect.objectContaining({ value: 1 })])
    expect(days[6].segments).toEqual([expect.objectContaining({ value: 2 })])
    expect(outsideAxis).toBe(12)

    render(
      <CompetitionActivitySection
        data={withDaily([daily('2026-10-22', COMP_A, 4), daily('2026-10-23', COMP_A, 1)])}
      />,
    )
    expect(
      screen.getByText(/4 grupos criados no dia parcial do início do período/),
    ).toBeInTheDocument()
  })

  it('mais campeonatos que cores: os menores agrupam em "Outros"', () => {
    const many = Array.from({ length: 10 }, (_, i) => {
      const id = `00000000-0000-4000-8000-00000000000${i}`
      return { id, row: daily('2026-10-26', id, 10 - i) }
    })
    render(
      <CompetitionActivitySection
        data={withDaily(
          many.map((m) => m.row),
          {
            competitions: many.map((m) =>
              row({ competition_id: m.id, name: `Liga ${m.id.slice(-1)}` }),
            ),
          },
        )}
      />,
    )
    const chart = screen.getByRole('img', { name: chartName })
    // 8 nomeados + "Outros" (Liga 8 = 2 e Liga 9 = 1).
    expect(chart.querySelectorAll('rect')).toHaveLength(9)
    expect(within(chart).getByText('2026-10-26 · Outros: 3')).toBeInTheDocument()
    expect(screen.getByTitle('Campeonatos de menor volume agrupados')).toBeInTheDocument()
  })

  it('série cortada pelo teto da SQL API avisa que os dias antigos podem estar incompletos', () => {
    render(
      <CompetitionActivitySection
        data={withDaily([daily('2026-10-26', COMP_A, 1)], { groupsDailyTruncated: true })}
      />,
    )
    expect(screen.getByText(/bateu no limite de linhas/)).toBeInTheDocument()
  })

  it('sem criações no período não desenha gráfico vazio', () => {
    render(<CompetitionActivitySection data={withDaily([])} />)
    expect(screen.getByText('Nenhuma criação de grupo no período.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: chartName })).not.toBeInTheDocument()
  })

  it('API anterior à série diária: mantém a tabela e diz que a série está indisponível', () => {
    render(
      <CompetitionActivitySection
        data={makeData({ competitions: [row({ groups_created: 2 })] })}
      />,
    )
    expect(screen.getByText(/Série diária indisponível/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Atividade por campeonato' })).toBeInTheDocument()
  })
})

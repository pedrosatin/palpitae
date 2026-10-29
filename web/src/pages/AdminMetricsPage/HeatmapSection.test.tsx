import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HeatmapSection, { buildHeatmapGrid, toBrt, type HeatmapResponse } from './HeatmapSection'

type Hourly = HeatmapResponse['hourly'][number]

function hour(overrides: Partial<Hourly> & Pick<Hourly, 'hour'>): Hourly {
  return { prediction_saves: 0, predictions: 0, logins: 0, ...overrides }
}

function makeData(overrides: Partial<HeatmapResponse> = {}): HeatmapResponse {
  return {
    days: 30,
    avgSampleInterval: 1,
    // Muito no passado: a coleta cobre o período inteiro, sem aviso.
    firstSeenAt: { prediction_saved: '2020-01-01 00:00:00', login_success: '2020-01-01 00:00:00' },
    hourly: [],
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('toBrt', () => {
  it('converte UTC para BRT (UTC−3) na mesma data', () => {
    // Quinta 29/10 14h UTC = 11h em Brasília.
    expect(toBrt('2026-10-29T14:00:00Z')).toEqual({ weekday: 4, hour: 11 })
  })

  it('vira o dia: 01h UTC é 22h do dia anterior em BRT', () => {
    // Quinta 29/10 01h UTC = quarta 28/10 22h.
    expect(toBrt('2026-10-29T01:00:00Z')).toEqual({ weekday: 3, hour: 22 })
  })

  it('vira a semana: segunda de madrugada UTC cai no domingo, e domingo cai no sábado', () => {
    // Segunda 02/11 02h UTC = domingo 01/11 23h.
    expect(toBrt('2026-11-02T02:00:00Z')).toEqual({ weekday: 0, hour: 23 })
    // Domingo 01/11 02h UTC = sábado 31/10 23h.
    expect(toBrt('2026-11-01T02:00:00Z')).toEqual({ weekday: 6, hour: 23 })
  })

  it('03h UTC é a meia-noite de BRT no mesmo dia', () => {
    expect(toBrt('2026-11-02T03:00:00Z')).toEqual({ weekday: 1, hour: 0 })
    expect(toBrt('2026-11-02T02:59:00Z')).toEqual({ weekday: 0, hour: 23 })
  })

  it('vira mês e ano', () => {
    // 1º/jan/2027 (sexta) 01h UTC = quinta 31/dez/2026 22h.
    expect(toBrt('2027-01-01T01:00:00Z')).toEqual({ weekday: 4, hour: 22 })
  })

  it('aceita o formato da SQL API (sem T nem Z), tratado como UTC', () => {
    expect(toBrt('2026-10-29 01:00:00')).toEqual({ weekday: 3, hour: 22 })
  })

  it('hora inválida devolve null', () => {
    expect(toBrt('lixo')).toBeNull()
    expect(toBrt('')).toBeNull()
  })
})

describe('buildHeatmapGrid', () => {
  it('monta 7×24 zerada e sem pico quando não há dados', () => {
    const grid = buildHeatmapGrid([], 'predictions')
    expect(grid.cells).toHaveLength(7)
    for (const row of grid.cells) {
      expect(row).toHaveLength(24)
      expect(row.every((v) => v === 0)).toBe(true)
    }
    expect(grid).toMatchObject({ total: 0, max: 0, peak: null })
  })

  it('posiciona cada hora UTC na célula de BRT e soma horas que caem na mesma célula', () => {
    const grid = buildHeatmapGrid(
      [
        // Duas quintas diferentes às 11h BRT somam na mesma célula.
        hour({ hour: '2026-10-29T14:00:00Z', predictions: 10 }),
        hour({ hour: '2026-10-22T14:00:00Z', predictions: 5 }),
        // Segunda 02h UTC → domingo 23h BRT.
        hour({ hour: '2026-11-02T02:00:00Z', predictions: 7 }),
      ],
      'predictions',
    )
    expect(grid.cells[4][11]).toBe(15)
    expect(grid.cells[0][23]).toBe(7)
    expect(grid.cells[1][2]).toBe(0)
    expect(grid.total).toBe(22)
    expect(grid.peak).toEqual({ weekday: 4, hour: 11, value: 15 })
  })

  it('cada série lê o seu campo: palpites, envios e logins são independentes', () => {
    const rows = [
      hour({ hour: '2026-10-29T14:00:00Z', predictions: 40, prediction_saves: 3, logins: 9 }),
    ]
    expect(buildHeatmapGrid(rows, 'predictions').cells[4][11]).toBe(40)
    expect(buildHeatmapGrid(rows, 'saves').cells[4][11]).toBe(3)
    expect(buildHeatmapGrid(rows, 'logins').cells[4][11]).toBe(9)
  })

  it('preserva contagem ponderada fracionária e ignora valor inválido ou hora inválida', () => {
    const grid = buildHeatmapGrid(
      [
        hour({ hour: '2026-10-29T14:00:00Z', logins: 2.5 }),
        hour({ hour: '2026-10-29T14:00:00Z', logins: Number.NaN }),
        hour({ hour: 'lixo', logins: 99 }),
      ],
      'logins',
    )
    expect(grid.cells[4][11]).toBe(2.5)
    expect(grid.total).toBe(2.5)
  })

  it('empate de pico fica com a primeira célula na ordem dom→sáb, 0h→23h', () => {
    const grid = buildHeatmapGrid(
      [
        hour({ hour: '2026-10-30T14:00:00Z', logins: 5 }), // sexta 11h
        hour({ hour: '2026-10-29T14:00:00Z', logins: 5 }), // quinta 11h
      ],
      'logins',
    )
    expect(grid.peak).toEqual({ weekday: 4, hour: 11, value: 5 })
  })
})

describe('HeatmapSection', () => {
  it('sem resposta da API avisa que está indisponível, sem apresentar zero', () => {
    render(<HeatmapSection data={null} />)

    expect(screen.getByText(/Indisponível: a API não enviou o mapa de calor/)).toBeInTheDocument()
    expect(screen.getByText(/não há como afirmar se houve atividade/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('resposta malformada (API antiga/mock errado) também cai em indisponível', () => {
    render(<HeatmapSection data={{ files: [] } as unknown as HeatmapResponse} />)
    expect(screen.getByText(/Indisponível/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('mostra a grade 7 dias × 24 horas com cabeçalhos de linha e coluna', () => {
    render(
      <HeatmapSection
        data={makeData({ hourly: [hour({ hour: '2026-10-29T14:00:00Z', predictions: 10 })] })}
      />,
    )

    const table = screen.getByRole('table', {
      name: 'Mapa de calor de palpites salvos por dia da semana e hora (BRT)',
    })
    // cabeçalho + 7 dias
    expect(within(table).getAllByRole('row')).toHaveLength(8)
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((h) => h.textContent),
    ).toEqual(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'])
    // 24 horas + a coluna dos dias.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(25)
    expect(within(table).getAllByRole('cell')).toHaveLength(7 * 24)
  })

  it('a célula de quinta 11h BRT recebe a hora de 14h UTC e traz o valor no texto e no tooltip', () => {
    render(
      <HeatmapSection
        data={makeData({ hourly: [hour({ hour: '2026-10-29T14:00:00Z', predictions: 1234 })] })}
      />,
    )

    const cell = screen.getByTitle('quinta-feira, 11h a 12h BRT: 1.234 palpites salvos')
    expect(cell).toHaveTextContent('1,2k')
    // A informação não depende só da cor: as outras células dizem 0.
    expect(screen.getByTitle('quinta-feira, 12h a 13h BRT: 0 palpites salvos')).toHaveTextContent(
      '0',
    )
  })

  it('mostra o horário de virada: 01h UTC de quinta aparece na quarta às 22h', () => {
    render(
      <HeatmapSection
        data={makeData({ hourly: [hour({ hour: '2026-10-29T01:00:00Z', predictions: 8 })] })}
      />,
    )

    expect(screen.getByTitle('quarta-feira, 22h a 23h BRT: 8 palpites salvos')).toHaveTextContent(
      '8',
    )
    expect(screen.queryByTitle(/quinta-feira, 1h a 2h BRT: 8/)).not.toBeInTheDocument()
  })

  it('declara o fuso e o pico em BRT, com o rótulo de que a soma pesa dias repetidos', () => {
    render(
      <HeatmapSection
        data={makeData({ hourly: [hour({ hour: '2026-11-02T02:00:00Z', predictions: 9 })] })}
      />,
    )

    expect(screen.getByText(/Horários em BRT \(UTC−3\)/)).toBeInTheDocument()
    expect(screen.getByText(/Maior movimento: domingo, 23h a 0h/)).toBeInTheDocument()
    expect(screen.getByText(/ocorre uma vez a mais no período/)).toBeInTheDocument()
  })

  it('séries distinguíveis: alternar para logins troca grade, total, cor e nome da tabela', async () => {
    const user = userEvent.setup()
    render(
      <HeatmapSection
        data={makeData({
          hourly: [
            hour({ hour: '2026-10-29T14:00:00Z', predictions: 40, prediction_saves: 3 }),
            hour({ hour: '2026-10-29T18:00:00Z', logins: 6 }),
          ],
        })}
      />,
    )

    expect(screen.getByRole('button', { name: /Palpites salvos/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /Logins/ })).toHaveAttribute('aria-pressed', 'false')
    const palpiteCell = screen.getByTitle('quinta-feira, 11h a 12h BRT: 40 palpites salvos')
    const palpiteBg = (palpiteCell as HTMLElement).style.backgroundColor

    await user.click(screen.getByRole('button', { name: /Envios de palpites/ }))
    expect(
      screen.getByTitle('quinta-feira, 11h a 12h BRT: 3 envios de palpites'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Logins/ }))
    expect(screen.getByRole('button', { name: /Logins/ })).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('table', { name: 'Mapa de calor de logins por dia da semana e hora (BRT)' }),
    ).toBeInTheDocument()
    const loginCell = screen.getByTitle('quinta-feira, 15h a 16h BRT: 6 logins')
    expect(loginCell).toHaveTextContent('6')
    // Série diferente, cor diferente.
    expect((loginCell as HTMLElement).style.backgroundColor).not.toBe(palpiteBg)
    expect(screen.queryByTitle(/palpites salvos/)).not.toBeInTheDocument()
  })

  it('o grupo de séries é nomeado para leitores de tela', () => {
    render(
      <HeatmapSection
        data={makeData({ hourly: [hour({ hour: '2026-10-29T14:00:00Z', predictions: 1 })] })}
      />,
    )
    expect(screen.getByRole('group', { name: 'Série' })).toBeInTheDocument()
  })

  it('sem sampling: não rotula como estimativa', () => {
    render(
      <HeatmapSection
        data={makeData({ hourly: [hour({ hour: '2026-10-29T14:00:00Z', predictions: 10 })] })}
      />,
    )

    expect(screen.queryByText(/estimativas/)).not.toBeInTheDocument()
    expect(screen.getByTitle(/11h a 12h BRT: 10 palpites salvos/)).toBeInTheDocument()
  })

  it('com sampling do Analytics Engine: avisa e marca os valores como estimativa (≈)', () => {
    render(
      <HeatmapSection
        data={makeData({
          avgSampleInterval: 4.5,
          hourly: [hour({ hour: '2026-10-29T14:00:00Z', predictions: 120 })],
        })}
      />,
    )

    expect(screen.getByText(/amostrou estes eventos/)).toHaveTextContent('4.50')
    expect(screen.getByText(/As contagens são estimativas/)).toBeInTheDocument()
    expect(
      screen.getByTitle('quinta-feira, 11h a 12h BRT: ≈120 palpites salvos'),
    ).toBeInTheDocument()
    expect(screen.getByText(/≈120 no período/)).toBeInTheDocument()
  })

  it('tipo nunca coletado: avisa que é falta de dado e não desenha grade de zeros', () => {
    render(
      <HeatmapSection
        data={makeData({
          firstSeenAt: { prediction_saved: null, login_success: '2020-01-01 00:00:00' },
        })}
      />,
    )

    expect(screen.getByText(/Nenhum evento de palpites salvos foi registrado/)).toBeInTheDocument()
    expect(screen.getByText(/falta dado para afirmar se houve atividade/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('o aviso de ausência acompanha a série selecionada', async () => {
    const user = userEvent.setup()
    render(
      <HeatmapSection
        data={makeData({
          firstSeenAt: { prediction_saved: '2020-01-01 00:00:00', login_success: null },
          hourly: [hour({ hour: '2026-10-29T14:00:00Z', predictions: 5 })],
        })}
      />,
    )
    expect(screen.queryByText(/Nenhum evento de logins foi registrado/)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Logins/ }))
    expect(screen.getByText(/Nenhum evento de logins foi registrado/)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('coleta mais nova que o período: avisa em BRT e ainda mostra o que existe', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-29T15:00:00Z'))
    render(
      <HeatmapSection
        data={makeData({
          days: 30,
          // 02h UTC de 20/10 = 23h BRT de 19/10.
          firstSeenAt: {
            prediction_saved: '2026-10-20 02:00:00',
            login_success: '2020-01-01 00:00:00',
          },
          hourly: [hour({ hour: '2026-10-29T14:00:00Z', predictions: 5 })],
        })}
      />,
    )

    expect(
      screen.getByText(/primeiro evento de palpites salvos .* é de 19\/10 23:00 BRT/),
    ).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('folga de um dia na retenção: primeiro evento no limite da janela de 90d não vira aviso', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-29T15:00:00Z'))
    render(
      <HeatmapSection
        data={makeData({
          days: 90,
          // ~12h depois do início da janela: é a retenção, não coleta recente.
          firstSeenAt: {
            prediction_saved: '2026-07-31 03:00:00',
            login_success: '2020-01-01 00:00:00',
          },
          hourly: [hour({ hour: '2026-10-29T14:00:00Z', predictions: 5 })],
        })}
      />,
    )
    expect(screen.queryByText(/primeiro evento/)).not.toBeInTheDocument()
  })

  it('coleta existe mas o período está vazio: diz que não houve evento, sem grade de zeros', () => {
    render(<HeatmapSection data={makeData()} />)

    expect(screen.getByText('Nenhum evento de palpites salvos no período.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
    expect(screen.queryByText(/falta dado/)).not.toBeInTheDocument()
  })
})

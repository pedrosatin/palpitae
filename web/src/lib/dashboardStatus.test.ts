import { describe, expect, it } from 'vitest'
import {
  allPredictedWord,
  completeWord,
  deadlineBanner,
  formatLongWhen,
  formatShortWhen,
  groupRoundStatus,
  groupRoundStatusLabel,
  groupRoundStatusText,
  pendingCountText,
  sortByUrgency,
  type DeadlineMatch,
  type RoundStatusFields,
} from './dashboardStatus'

// Quinta, 12/11/2026, 12:00 em Brasília.
const NOW = Date.parse('2026-11-12T15:00:00Z')

function deadline(startTime: string, round = '35'): DeadlineMatch {
  return {
    match_id: `m-${startTime}`,
    start_time: startTime,
    round,
    round_label: `Rodada ${round}`,
    home_team: 'Mirassol',
    away_team: 'Atlético-MG',
  }
}

function group(id: string, fields: Partial<RoundStatusFields> = {}): RoundStatusFields {
  return {
    id,
    name: `Grupo ${id}`,
    pending_predictions: 0,
    next_deadline: null,
    next_match_at: null,
    current_round_label: null,
    round_ends_at: null,
    live_matches: 0,
    ...fields,
  }
}

describe('groupRoundStatus e texto do card', () => {
  const text = (fields: Partial<RoundStatusFields>) => {
    const status = groupRoundStatus(group('g', fields))
    return status ? groupRoundStatusText(status, NOW) : null
  }

  it('mostra os jogos sem palpite e quando fecha o primeiro', () => {
    expect(
      text({ pending_predictions: 10, next_deadline: deadline('2026-11-14T21:30:00Z') }),
    ).toBe('10 sem palpite · fecha sáb 18:30')
  })

  it('mostra só a contagem quando o pendente é adiado sem data', () => {
    expect(text({ pending_predictions: 1, next_deadline: null })).toBe('1 sem palpite')
  })

  it('mostra a rodada completa e o próximo jogo', () => {
    expect(
      text({ current_round_label: 'Rodada 35', next_match_at: '2026-11-14T21:30:00Z' }),
    ).toBe('Rodada 35 completa ✓ · próximo jogo sáb 18:30')
  })

  it('mostra os jogos ao vivo quando não há pendência', () => {
    expect(text({ live_matches: 2, next_match_at: '2026-11-14T21:30:00Z' })).toBe(
      '2 jogos ao vivo',
    )
    expect(text({ live_matches: 1 })).toBe('1 jogo ao vivo')
  })

  it('pendência vence o jogo ao vivo', () => {
    expect(
      text({
        pending_predictions: 3,
        live_matches: 2,
        next_deadline: deadline('2026-11-12T22:00:00Z'),
      }),
    ).toBe('3 sem palpite · fecha hoje 19:00')
  })

  it('mostra sem jogos marcados quando não há próximo jogo', () => {
    expect(text({ next_match_at: null })).toBe('Sem jogos marcados')
  })

  it('não inventa status com a resposta antiga, sem next_match_at', () => {
    expect(groupRoundStatus({ id: 'g', name: 'G', pending_predictions: 0 })).toBeNull()
    expect(groupRoundStatus({ id: 'g', name: 'G', pending_predictions: 2 })).toEqual({
      kind: 'pending',
      count: 2,
      deadline: null,
    })
  })

  it('monta o rótulo do leitor de tela sem "✓" e "·"', () => {
    const label = (fields: Partial<RoundStatusFields>) =>
      groupRoundStatusLabel(groupRoundStatus(group('g', fields))!, NOW)

    expect(
      label({ current_round_label: 'Rodada 35', next_match_at: '2026-11-14T21:30:00Z' }),
    ).toBe('Rodada 35 completa, próximo jogo sáb 18:30')
    expect(
      label({ pending_predictions: 10, next_deadline: deadline('2026-11-14T21:30:00Z') }),
    ).toBe('10 sem palpite, fecha sáb 18:30')
    expect(label({ live_matches: 2 })).toBe('2 jogos ao vivo')
  })

  it('conta os jogos sem palpite e os grupos quando são mais de um', () => {
    expect(pendingCountText(10)).toBe('10 sem palpite')
    expect(pendingCountText(10, 1)).toBe('10 sem palpite')
    expect(pendingCountText(30, 3)).toBe('30 sem palpite em 3 grupos')
  })

  it('concorda "completa" com o rótulo da rodada', () => {
    expect(completeWord('Rodada 35')).toBe('completa')
    expect(completeWord('Final')).toBe('completa')
    expect(completeWord('Semifinais')).toBe('completas')
    expect(completeWord('Oitavas de final')).toBe('completas')
    expect(completeWord('Quartas da Taça Guanabara')).toBe('completas')
    expect(completeWord('Playoffs')).toBe('completos')
    expect(completeWord('Terceiro lugar')).toBe('completo')
  })

  it('concorda "toda palpitada" com o rótulo da rodada', () => {
    expect(allPredictedWord('Rodada 35')).toBe('toda palpitada')
    expect(allPredictedWord('Semifinais')).toBe('todas palpitadas')
    expect(allPredictedWord('Playoffs')).toBe('todos palpitados')
    expect(allPredictedWord('Terceiro lugar')).toBe('todo palpitado')
  })
})

describe('sortByUrgency', () => {
  it('põe pendências pelo fechamento, depois ao vivo, próximo jogo e sem jogos', () => {
    const groups = [
      group('sem-jogos'),
      group('completo-cedo', { next_match_at: '2026-11-13T22:00:00Z' }),
      group('pendente-tarde', {
        pending_predictions: 10,
        next_deadline: deadline('2026-11-18T22:00:00Z'),
      }),
      group('ao-vivo', { live_matches: 1, next_match_at: '2026-11-20T22:00:00Z' }),
      group('completo-tarde', { next_match_at: '2026-11-19T22:00:00Z' }),
      group('adiado', { pending_predictions: 1 }),
      group('pendente-cedo', {
        pending_predictions: 1,
        next_deadline: deadline('2026-11-14T21:30:00Z'),
      }),
    ]

    expect(sortByUrgency(groups).map((g) => g.id)).toEqual([
      'pendente-cedo',
      'pendente-tarde',
      'adiado',
      'ao-vivo',
      'completo-cedo',
      'completo-tarde',
      'sem-jogos',
    ])
  })

  it('mantém a ordem da API no empate', () => {
    const groups = [
      group('a', { next_match_at: '2026-11-14T21:30:00Z' }),
      group('b', { next_match_at: '2026-11-14T21:30:00Z' }),
      group('c'),
      group('d'),
    ]
    expect(sortByUrgency(groups).map((g) => g.id)).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('deadlineBanner', () => {
  it('aponta o grupo mais urgente e soma as pendências dos grupos', () => {
    const banner = deadlineBanner([
      group('champions', { next_match_at: '2026-11-12T20:00:00Z' }),
      group('borracharia', {
        pending_predictions: 10,
        next_deadline: deadline('2026-11-18T22:00:00Z'),
      }),
      group('realidade', {
        name: 'Realidade do BR',
        pending_predictions: 10,
        next_deadline: deadline('2026-11-14T21:30:00Z'),
      }),
      group('copa', { pending_predictions: 2, next_deadline: deadline('2026-11-19T22:00:00Z') }),
    ])

    expect(banner).toEqual({
      kind: 'pending',
      groupId: 'realidade',
      groupName: 'Realidade do BR',
      match: deadline('2026-11-14T21:30:00Z'),
      totalPending: 22,
      groupsWithPending: 3,
    })
  })

  it('sem pendência, nomeia a rodada que termina primeiro, sem data', () => {
    expect(
      deadlineBanner([
        group('a', {
          current_round_label: 'Rodada 35',
          next_match_at: '2026-11-14T21:30:00Z',
          round_ends_at: '2026-11-20T00:30:00Z',
        }),
        group('b', {
          current_round_label: 'Semifinais',
          next_match_at: '2026-11-13T22:00:00Z',
          round_ends_at: '2026-11-19T22:00:00Z',
        }),
        group('c'),
      ]),
    ).toEqual({ kind: 'clear', roundLabel: 'Semifinais' })
  })

  it('não mostra faixa sem pendência e sem rodada aberta', () => {
    expect(deadlineBanner([group('a'), group('b', { live_matches: 2 })])).toBeNull()
    expect(deadlineBanner([])).toBeNull()
  })
})

describe('datas no fuso de Brasília', () => {
  it('usa hoje, amanhã, o dia da semana e a data conforme a distância', () => {
    expect(formatShortWhen('2026-11-12T22:00:00Z', NOW)).toBe('hoje 19:00')
    // 01:30 UTC de sexta ainda é quinta em Brasília.
    expect(formatShortWhen('2026-11-13T01:30:00Z', NOW)).toBe('hoje 22:30')
    expect(formatShortWhen('2026-11-13T22:00:00Z', NOW)).toBe('amanhã 19:00')
    expect(formatShortWhen('2026-11-14T21:30:00Z', NOW)).toBe('sáb 18:30')
    expect(formatShortWhen('2026-11-18T22:00:00Z', NOW)).toBe('qua 19:00')
    expect(formatShortWhen('2026-11-19T22:00:00Z', NOW)).toBe('19/11 19:00')
  })

  it('formata o prazo da faixa com dia e hora', () => {
    expect(formatLongWhen('2026-11-12T22:00:00Z', NOW)).toBe('hoje às 19:00')
    expect(formatLongWhen('2026-11-13T22:00:00Z', NOW)).toBe('amanhã às 19:00')
    expect(formatLongWhen('2026-11-14T21:30:00Z', NOW)).toBe('sáb, 14/11 às 18:30')
  })
})

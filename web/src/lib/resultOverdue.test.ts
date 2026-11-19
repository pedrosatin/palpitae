import { describe, expect, it } from 'vitest'
import { DEFAULT_OVERDUE_RESULT_HOURS, isResultOverdue } from './resultOverdue'

describe('isResultOverdue', () => {
  const now = Date.parse('2026-11-19T18:00:00Z')

  it('usa limiar padrão de 3 h', () => {
    expect(DEFAULT_OVERDUE_RESULT_HOURS).toBe(3)
  })

  it('sinaliza scheduled sem placar após o limiar', () => {
    expect(
      isResultOverdue(
        { start_time: '2026-11-19T14:00:00Z', status: 'scheduled', postponed: 0 },
        now,
      ),
    ).toBe(true)
  })

  it('não sinaliza adiado, finished nem placar completo', () => {
    expect(
      isResultOverdue(
        { start_time: '2026-11-19T14:00:00Z', status: 'scheduled', postponed: 1 },
        now,
      ),
    ).toBe(false)
    expect(
      isResultOverdue({ start_time: '2026-11-19T14:00:00Z', status: 'finished' }, now),
    ).toBe(false)
    expect(
      isResultOverdue(
        {
          start_time: '2026-11-19T14:00:00Z',
          status: 'live',
          home_score: 0,
          away_score: 0,
        },
        now,
      ),
    ).toBe(false)
  })

  it('não sinaliza dentro da janela de 3 h', () => {
    expect(
      isResultOverdue(
        { start_time: '2026-11-19T16:00:00Z', status: 'scheduled' },
        now,
      ),
    ).toBe(false)
  })
})

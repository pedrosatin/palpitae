import { describe, expect, it } from 'vitest'
import { isMatchLocked, lockedSql } from './locking'

const NOW = '2026-08-01T12:00:00Z'
const PAST = '2026-07-29T22:30:00Z'
const FUTURE = '2026-08-05T22:30:00Z'

describe('isMatchLocked', () => {
  it('trava jogo que já começou', () => {
    expect(isMatchLocked({ start_time: PAST, postponed: 0 }, NOW)).toBe(true)
  })

  it('não trava jogo futuro', () => {
    expect(isMatchLocked({ start_time: FUTURE, postponed: 0 }, NOW)).toBe(false)
  })

  it('NÃO trava jogo adiado, mesmo com start_time no passado', () => {
    // O ponto todo da flag: o start_time preservado é o horário original, que já
    // passou — mas o jogo não aconteceu, então o palpite tem que seguir editável.
    expect(isMatchLocked({ start_time: PAST, postponed: 1 }, NOW)).toBe(false)
  })

  it('trava exatamente no horário de início (>=, não >)', () => {
    expect(isMatchLocked({ start_time: NOW, postponed: 0 }, NOW)).toBe(true)
  })

  it('fail-closed: postponed ausente ou nulo trava normalmente pelo horário', () => {
    expect(isMatchLocked({ start_time: PAST }, NOW)).toBe(true)
    expect(isMatchLocked({ start_time: PAST, postponed: null }, NOW)).toBe(true)
    expect(isMatchLocked({ start_time: FUTURE }, NOW)).toBe(false)
  })

  it('lida com horários em formatos diferentes (com e sem milissegundos)', () => {
    const startSemMilis = '2026-08-01T12:00:00Z'
    const nowComMilis = '2026-08-01T12:00:00.123Z' // 123ms depois, deveria estar travado
    expect(isMatchLocked({ start_time: startSemMilis, postponed: 0 }, nowComMilis)).toBe(true)
  })
})

describe('lockedSql', () => {
  it('consome exatamente um parâmetro posicional', () => {
    expect(lockedSql().match(/\?/g)).toHaveLength(1)
  })

  it('usa o alias pedido', () => {
    expect(lockedSql('pr')).toContain('pr.start_time')
    expect(lockedSql('pr')).toContain('pr.postponed')
  })

  it('default é o alias `m`', () => {
    expect(lockedSql()).toBe('(m.start_time <= ? AND m.postponed = 0)')
  })
})

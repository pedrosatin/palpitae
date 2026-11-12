/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { isMatchLocked, lockedSql } from './locking'

const NOW = '2026-08-01T12:00:00Z'
const PAST = '2026-07-29T22:30:00Z'
const FUTURE = '2026-08-05T22:30:00Z'
const START = '2026-11-09T20:00:00Z'

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
  it('trava imediatamente jogo ao vivo (live) mesmo se adiado ou futuro', () => {
    expect(isMatchLocked({ start_time: FUTURE, status: 'live', postponed: 1 }, NOW)).toBe(true)
  })

  it('trava imediatamente jogo finalizado (finished) mesmo se adiado ou futuro', () => {
    expect(isMatchLocked({ start_time: FUTURE, status: 'finished', postponed: 1 }, NOW)).toBe(true)
  })

  it('trava para sempre jogo que o sync viu iniciado, mesmo adiado ou remarcado depois', () => {
    expect(
      isMatchLocked(
        { start_time: FUTURE, status: 'scheduled', postponed: 1, locked_at: PAST },
        NOW,
      ),
    ).toBe(true)
    expect(
      isMatchLocked(
        { start_time: FUTURE, status: 'scheduled', postponed: 0, locked_at: PAST },
        NOW,
      ),
    ).toBe(true)
  })

  it('não trava jogo futuro agendado (scheduled)', () => {
    expect(isMatchLocked({ start_time: FUTURE, status: 'scheduled', postponed: 0 }, NOW)).toBe(
      false,
    )
  })
})

describe('lockedSql', () => {
  it('consome exatamente um parâmetro posicional', () => {
    expect(lockedSql().match(/\?/g)).toHaveLength(1)
  })

  it('usa o alias pedido', () => {
    expect(lockedSql('pr')).toContain('pr.locked_at IS NOT NULL')
    expect(lockedSql('pr')).toContain('pr.start_time <= ')
    expect(lockedSql('pr')).not.toMatch(/\bm\./)
  })

  it('default é o alias `m`', () => {
    expect(lockedSql()).toBe(lockedSql('m'))
  })

  // O travamento em SQL e o em TS precisam concordar no segundo do início: a
  // escrita confere um e a leitura, o outro. O `now` chega com milissegundos.
  it.each([
    ['2026-11-09T19:59:59.999Z', false],
    ['2026-11-09T20:00:00.000Z', true],
    ['2026-11-09T20:00:00.500Z', true],
    ['2026-11-09T20:00:00.999Z', true],
    ['2026-11-09T20:00:01Z', true],
  ])('com now = %s, travado = %s, igual a isMatchLocked', (now, locked) => {
    const sqlite = new DatabaseSync(':memory:')
    const row = sqlite
      .prepare(
        `SELECT ${lockedSql('m')} AS locked FROM (
           SELECT '${START}' AS start_time, NULL AS locked_at, 'scheduled' AS status, 0 AS postponed
         ) AS m`,
      )
      .get(now) as { locked: number }
    sqlite.close()
    expect(row.locked === 1).toBe(locked)
    expect(isMatchLocked({ start_time: START, postponed: 0 }, now)).toBe(locked)
  })
})

import { describe, expect, it } from 'vitest'
import { inlineParams, SqlCollector, sqlLiteral } from './sqlCollector'

describe('sqlLiteral', () => {
  it('escapa apóstrofo duplicando — nomes reais do provider têm', () => {
    // "King's Cup", "FA Women's Cup" vêm assim da API-Football.
    expect(sqlLiteral("King's Cup")).toBe("'King''s Cup'")
    expect(sqlLiteral("O''Brien")).toBe("'O''''Brien'")
  })

  it('trata null e undefined como NULL', () => {
    expect(sqlLiteral(null)).toBe('NULL')
    expect(sqlLiteral(undefined)).toBe('NULL')
  })

  it('emite números sem aspas', () => {
    expect(sqlLiteral(42)).toBe('42')
    expect(sqlLiteral(0)).toBe('0')
  })

  it('recusa número não finito em vez de gravar lixo', () => {
    expect(() => sqlLiteral(Number.NaN)).toThrow(/inválido/)
    expect(() => sqlLiteral(Number.POSITIVE_INFINITY)).toThrow(/inválido/)
  })

  it('recusa tipo não suportado em vez de virar [object Object]', () => {
    expect(() => sqlLiteral({ a: 1 })).toThrow(/não suportado/)
    expect(() => sqlLiteral(['x'])).toThrow(/não suportado/)
  })
})

describe('inlineParams', () => {
  it('substitui os placeholders na ordem', () => {
    expect(inlineParams('INSERT INTO t VALUES (?, ?, ?)', ['a', 2, null])).toBe(
      "INSERT INTO t VALUES ('a', 2, NULL)",
    )
  })

  it('falha quando a contagem não bate — nunca gera SQL torto', () => {
    expect(() => inlineParams('VALUES (?, ?)', ['só-um'])).toThrow(/Menos parâmetros/)
    expect(() => inlineParams('VALUES (?)', ['a', 'b'])).toThrow(/sem placeholder/)
  })
})

describe('SqlCollector', () => {
  it('serializa os statements dentro de uma transação', async () => {
    const collector = new SqlCollector()
    collector.prepare('UPDATE competition_radar SET is_current = 0 WHERE provider = ?').bind('x')
    collector.prepare('INSERT INTO t (a) VALUES (?)').bind(1)
    await collector.batch()

    expect(collector.size).toBe(2)
    expect(collector.toSql()).toBe(
      [
        'BEGIN TRANSACTION;',
        "UPDATE competition_radar SET is_current = 0 WHERE provider = 'x';",
        'INSERT INTO t (a) VALUES (1);',
        'COMMIT;',
        '',
      ].join('\n'),
    )
  })

  it('aceita statement sem bind', () => {
    const collector = new SqlCollector()
    collector.prepare('DELETE FROM t')
    expect(collector.toSql()).toContain('DELETE FROM t;')
  })
})

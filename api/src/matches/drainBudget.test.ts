/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { limitD1Calls } from '../testing/d1CallLimit'
import { createSqliteD1 } from '../testing/sqliteD1'
import { CallBudgetExhaustedError, INVOCATION_CALL_LIMIT } from './callBudget'
import {
  CYCLE_FIXED_CALLS,
  DRAIN_CALL_BUDGET,
  DRAIN_RESERVED_CALLS,
  DrainBudget,
  SETTLE_CALLS,
} from './drainBudget'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

function setup(limit: number) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  // Conta o que de fato chega ao banco, por baixo do orçamento: sem limite, só conta.
  const below = limitD1Calls(db, null)
  return { budget: new DrainBudget(below.db, limit), reached: below.calls }
}

describe('orçamento de subrequests do dreno', () => {
  it('45 das 50 chamadas: 1 da limpeza de segurança e 4 de folga ficam de fora', () => {
    expect(DRAIN_RESERVED_CALLS).toBe(5)
    expect(DRAIN_CALL_BUDGET).toBe(INVOCATION_CALL_LIMIT - 5)
    expect(DRAIN_CALL_BUDGET).toBe(45)
    expect(CYCLE_FIXED_CALLS).toBe(2)
  })

  it('o D1 do ciclo conta cada consulta e cada batch como uma chamada', async () => {
    const { budget } = setup(45)

    await budget.db.prepare('SELECT 1').first()
    await budget.db.prepare('SELECT 2').all()
    await budget.db.batch([budget.db.prepare('SELECT 3'), budget.db.prepare('SELECT 4')])

    expect(budget.used).toBe(3)
    expect(budget.left()).toBe(42)
  })

  it('dimensiona a reclamação pelo saldo, sem contar claim e gravação do estado', () => {
    const { budget } = setup(45)

    expect(budget.claimLimit(8, 16)).toBe(5)
    expect(budget.claimLimit(2, 16)).toBe(16)
    expect(budget.claimLimit(8, 3)).toBe(3)
    expect(setup(9).budget.claimLimit(8, 16)).toBe(0)
  })

  it('admite o item e reserva a estimativa dele até terminar, abatida do que ele já gastou', async () => {
    const { budget } = setup(30)
    const first = budget.open(10)!
    const second = budget.open(10)!

    // 30 − 1 (estado) − 20 reservados = 9 livres: não cabem 10.
    expect(budget.open(10)).toBeNull()
    expect(budget.open(9)).not.toBeNull()

    // O primeiro gasta 3 e a reserva dele cai para 7, mas o que gastou sai do saldo.
    await first.db.prepare('SELECT 1').first()
    await first.db.prepare('SELECT 2').first()
    await first.db.prepare('SELECT 3').first()
    expect(first.used()).toBe(3)
    expect(first.pending()).toBe(7)
    expect(budget.used).toBe(3)

    first.close()
    second.close()
    expect(budget.hasInFlight()).toBe(true)
  })

  it('devolve a sobra da reserva quando o item termina e acorda quem esperava', async () => {
    const { budget } = setup(14)
    const first = budget.open(10)!
    expect(budget.open(10)).toBeNull()
    expect(budget.hasInFlight()).toBe(true)

    const woke = vi.fn()
    void budget.nextRelease().then(woke)
    await Promise.resolve()
    expect(woke).not.toHaveBeenCalled()

    await first.db.prepare('SELECT 1').first()
    first.close()
    await Promise.resolve()

    expect(woke).toHaveBeenCalledTimes(1)
    expect(budget.hasInFlight()).toBe(false)
    // Gastou 1 de 10: a reserva volta e o próximo item cabe.
    expect(budget.open(10)).not.toBeNull()
  })

  it('o D1 do item recusa, sem chamar, o que invadiria a gravação do estado', async () => {
    const { budget, reached } = setup(6)
    const item = budget.open(1)!

    // 6 − 1 (estado) = 5 chamadas de trabalho.
    for (let i = 0; i < 5; i++) await item.db.prepare('SELECT 1').first()
    expect(budget.used).toBe(5)

    await expect(item.db.prepare('SELECT 1').first()).rejects.toBeInstanceOf(
      CallBudgetExhaustedError,
    )
    await expect(item.db.batch([item.db.prepare('SELECT 1')])).rejects.toBeInstanceOf(
      CallBudgetExhaustedError,
    )
    expect(() => item.chargeFetch()).toThrow(CallBudgetExhaustedError)
    expect(reached()).toBe(5)
    expect(budget.used).toBe(5)

    // A gravação do estado, pelo D1 do ciclo, ainda cabe.
    await budget.db.batch([budget.db.prepare('SELECT 1')])
    expect(budget.used).toBe(6)
    expect(SETTLE_CALLS).toBe(1)
  })

  it('cada fetch cobrado soma no mesmo saldo das consultas ao D1', async () => {
    const { budget } = setup(10)
    const item = budget.open(3)!

    await item.db.prepare('SELECT 1').first()
    item.chargeFetch()
    item.chargeFetch()

    expect(item.used()).toBe(3)
    expect(budget.used).toBe(3)
  })

  it('callsLeft do item desconta as reservas dos outros itens, não a dele', () => {
    const { budget } = setup(40)
    const first = budget.open(10)!
    budget.open(12)

    // 40 − 1 (estado) − 12 (reserva do outro) = 27, com a reserva dele incluída.
    expect(first.callsLeft()).toBe(27)
  })
})

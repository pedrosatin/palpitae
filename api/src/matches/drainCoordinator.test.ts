/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { limitD1Calls } from '../testing/d1CallLimit'
import { flakyD1 } from '../testing/flakyD1'
import { createSqliteD1 } from '../testing/sqliteD1'
import { CallBudgetExhaustedError } from './callBudget'
import { DRAIN_CALL_BUDGET, type DrainBudget } from './drainBudget'
import {
  DRAIN_MAX_PASSES,
  runProviderDrains,
  shareBudget,
  splitBudget,
  type ProviderDrain,
} from './drainCoordinator'
import { enqueueProviderWork, type DrainRun } from './providerWork'

/**
 * Coordenador dos drenos: um orçamento de 45 subrequests para todas as filas
 * que drenam no mesmo tick. Os drenos aqui são simulados: cada um gasta o que
 * `demand` pede, pelo D1 e pelo `fetch` da fatia, e diz se parou por saldo.
 */

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.restoreAllMocks()
})

/** D1 que recusa a chamada acima do limite da invocação inteira, como a plataforma. */
function setup(platformLimit = 50) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const limited = limitD1Calls(db, platformLimit)
  return { limited }
}

const emptyRun = (overrides: Partial<DrainRun> = {}): DrainRun => ({
  claimed: 0,
  done: 0,
  requeued: 0,
  failed: 0,
  released: 0,
  leaseLost: 0,
  outcomes: [],
  ...overrides,
})

type Simulated = ProviderDrain & { shares: number[] }

/**
 * Dreno que quer gastar `demand` chamadas de trabalho e gasta o que a fatia
 * deixa, pelo D1 dela, e depois grava o estado (1 chamada; as 2 de recuperação
 * da reserva ficam sem uso). Para por saldo quando a demanda não coube.
 */
function simulated(
  provider: string,
  demand: number,
  options: { stop?: 'budget' | 'provider' } = {},
): Simulated {
  const shares: number[] = []
  return {
    provider,
    shares,
    run: async (budget: DrainBudget) => {
      shares.push(budget.limit)
      const item = budget.open(1)!
      let spent = 0
      try {
        while (spent < demand) {
          await item.db.prepare('SELECT 1').first()
          spent += 1
        }
      } catch (err) {
        if (!(err instanceof CallBudgetExhaustedError)) throw err
      } finally {
        item.close()
      }
      await budget.db.prepare('SELECT 1').first()
      const unfinished = spent < demand
      return emptyRun({ stoppedBy: unfinished ? 'budget' : options.stop })
    },
  }
}

describe('repartição do saldo entre as fatias', () => {
  it.each([
    [45, 1, [45]],
    [45, 2, [23, 22]],
    [45, 3, [15, 15, 15]],
    [10, 3, [4, 3, 3]],
  ])('%i chamadas para %i drenos: %j', (total, count, expected) => {
    const shares = splitBudget(total, count)

    expect(shares).toEqual(expected)
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(total)
  })
})

describe('coordenador dos drenos', () => {
  it('um dreno recebe o saldo inteiro: 45 de 50, com 5 de fora', async () => {
    const { limited } = setup()
    const fd = simulated('football-data', 100)

    const used = await runProviderDrains(limited.db, [fd])

    expect(DRAIN_CALL_BUDGET).toBe(45)
    expect(fd.shares[0]).toBe(45)
    // 45 − 3 de reserva do estado = 42 de trabalho, mais a gravação do estado.
    expect(used).toBe(43)
    expect(limited.calls()).toBe(43)
  })

  it('dois drenos famintos dividem o saldo e juntos nunca passam de 45', async () => {
    const { limited } = setup()
    const fd = simulated('football-data', 100)
    const espn = simulated('espn', 100)

    const used = await runProviderDrains(limited.db, [fd, espn])

    expect(fd.shares[0] + espn.shares[0]).toBe(45)
    expect(fd.shares[0]).toBe(23)
    expect(espn.shares[0]).toBe(22)
    expect(used).toBe(41)
    // A plataforma recusa a chamada 51, e o total do dreno nem chega perto de 46.
    expect(limited.calls()).toBeLessThanOrEqual(45)
  })

  it('a sobra de quem terminou cedo vai para quem parou por saldo, numa segunda rodada', async () => {
    const { limited } = setup()
    const fd = simulated('football-data', 100)
    const espn = simulated('espn', 5)

    const used = await runProviderDrains(limited.db, [fd, espn])

    // 1ª rodada: fd gasta 21 das 23 (20 de trabalho e o estado) e para por saldo; espn
    // gasta 5 e grava o estado (6). 2ª rodada: só o fd, com o que sobrou (45 − 21 − 6 = 18).
    expect(fd.shares).toEqual([23, 18])
    expect(espn.shares).toEqual([22])
    expect(used).toBe(21 + 6 + 16)
    expect(limited.calls()).toBeLessThanOrEqual(45)
  })

  it('a rodada extra só chama o dreno cuja fatia chega ao mínimo dele', async () => {
    const { limited } = setup()
    const fd = { ...simulated('football-data', 100), minCalls: 30 }
    const espn = simulated('espn', 5)

    const used = await runProviderDrains(limited.db, [fd, espn])

    // Sobram 18 depois da 1ª rodada, menos que as 30 que o fd precisa: ele não roda de novo.
    expect(fd.shares).toEqual([23])
    expect(used).toBe(21 + 6)
  })

  it('dreno que encerrou por falta de vaga do provedor não pede nova rodada', async () => {
    const { limited } = setup()
    const fd = simulated('football-data', 3, { stop: 'provider' })
    const espn = simulated('espn', 100)

    await runProviderDrains(limited.db, [fd, espn])

    expect(fd.shares).toEqual([23])
    expect(espn.shares[0]).toBe(22)
  })

  it('para quando uma rodada não gasta nada, sem repetir sem fim', async () => {
    const { limited } = setup()
    const idle: ProviderDrain = {
      provider: 'football-data',
      run: vi.fn(async () => emptyRun({ stoppedBy: 'budget' })),
    }

    const used = await runProviderDrains(limited.db, [idle])

    expect(idle.run).toHaveBeenCalledTimes(1)
    expect(used).toBe(0)
  })

  it('limita as rodadas', async () => {
    const { limited } = setup()
    const greedy: ProviderDrain = {
      provider: 'football-data',
      run: vi.fn(async (budget: DrainBudget) => {
        await budget.db.prepare('SELECT 1').first()
        return emptyRun({ stoppedBy: 'budget' })
      }),
    }

    await runProviderDrains(limited.db, [greedy])

    expect(greedy.run).toHaveBeenCalledTimes(DRAIN_MAX_PASSES)
  })

  it('falha de um dreno fica no log e não tira a vez do outro', async () => {
    const { limited } = setup()
    const writeDataPoint = vi.fn()
    const broken: ProviderDrain = {
      provider: 'espn',
      run: async () => {
        throw new Error('D1 fora do ar')
      },
    }
    const fd = simulated('football-data', 10)

    const used = await runProviderDrains(limited.db, [broken, fd], {
      ae: { writeDataPoint } as unknown as AnalyticsEngineDataset,
    })

    expect(fd.shares).toEqual([22])
    expect(used).toBe(11)
    expect(writeDataPoint).toHaveBeenCalledWith(
      expect.objectContaining({
        blobs: ['provider_work_run', 'error', 'espn', 'D1 fora do ar'],
      }),
    )
  })

  it('telemetria que falha não derruba o coordenador: o outro dreno é consolidado e a sobra reaproveitada', async () => {
    const { limited } = setup()
    // O Analytics Engine lança em toda escrita, inclusive na do erro do dreno que falhou.
    const ae = {
      writeDataPoint: vi.fn(() => {
        throw new Error('AE indisponível')
      }),
    } as unknown as AnalyticsEngineDataset
    const broken: ProviderDrain = {
      provider: 'espn',
      run: async () => {
        throw new Error('D1 fora do ar')
      },
    }
    const fd = simulated('football-data', 100)

    const used = await runProviderDrains(limited.db, [broken, fd], { ae })

    // O gasto do fd entra na conta e, parando por saldo, ele ainda ganha a rodada extra.
    expect(fd.shares).toHaveLength(2)
    expect(fd.shares[1]).toBeGreaterThan(0)
    expect(used).toBeGreaterThan(fd.shares[0])
    expect(limited.calls()).toBeLessThanOrEqual(45)
    expect(ae.writeDataPoint).toHaveBeenCalled()
  })

  it('o orçamento é parâmetro: um limite menor reparte o que há', async () => {
    const { limited } = setup()
    const fd = simulated('football-data', 100)

    const used = await runProviderDrains(limited.db, [fd], { limit: 12 })

    expect(fd.shares[0]).toBe(12)
    expect(used).toBe(10)
  })
})

describe('repartição pela demanda', () => {
  it('sem demanda conhecida é a divisão por igual de sempre', () => {
    expect(shareBudget(45, [Infinity, Infinity])).toEqual(splitBudget(45, 2))
    expect(shareBudget(45, [Infinity, Infinity, Infinity])).toEqual([15, 15, 15])
  })

  it('quem pede menos que a fatia justa recebe o que pede, e o resto vai a quem ainda quer mais', () => {
    expect(shareBudget(44, [22, Infinity])).toEqual([22, 22])
    expect(shareBudget(44, [13, Infinity])).toEqual([13, 31])
    expect(shareBudget(44, [Infinity, 13])).toEqual([31, 13])
    // O que um libera aumenta a fatia justa dos outros, e quem passa a caber nela também é atendido.
    expect(shareBudget(44, [10, 12, Infinity])).toEqual([10, 12, 22])
  })

  it('se todos pedem pouco, a sobra é repartida por cima da demanda, para a estimativa não faltar', () => {
    const shares = shareBudget(44, [10, 12])

    expect(shares).toEqual([21, 23])
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(44)
  })

  it('a soma das fatias nunca passa do total', () => {
    for (const demands of [
      [1, 2, 3],
      [100, 5],
      [Infinity, Infinity, 7],
      [0, 0],
    ]) {
      const shares = shareBudget(44, demands)
      expect(shares.reduce((sum, share) => sum + share, 0)).toBeLessThanOrEqual(44)
    }
  })
})

describe('coordenador dos drenos com a fila no D1', () => {
  const NOW = Date.parse('2026-11-17T14:05:00Z')

  function setupQueue() {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    return { sqlite, db }
  }

  async function seed(db: D1Database, provider: string, count: number) {
    await enqueueProviderWork(
      db,
      Array.from({ length: count }, (_, i) => ({
        provider,
        kind: 'result' as const,
        competitionCode: 'PPL',
        season: '2026',
        round: String(i + 1),
        competitionId: 'c1',
      })),
      NOW,
    )
  }

  /** Os dois drenos como o `scheduled` os monta: com a fila do provedor e a fatia mínima de cada um. */
  function queued() {
    const fd = {
      ...simulated('football-data', 100),
      minCalls: 12,
      queue: {},
    }
    const espn = {
      ...simulated('espn', 100),
      minCalls: 13,
      queue: { respectProviderAccess: true },
    }
    return { fd, espn }
  }

  it('dreno sem trabalho não é chamado e o saldo dele fica com quem tem fila: 44 (1 da sondagem)', async () => {
    const { sqlite, db } = setupQueue()
    await seed(db, 'football-data', 16)
    const limited = limitD1Calls(db)
    const { fd, espn } = queued()

    const used = await runProviderDrains(limited.db, [fd, espn], { now: NOW })

    expect(espn.shares).toEqual([])
    expect(fd.shares).toEqual([44])
    // A sondagem (1), o trabalho da fatia (44 − 3 de reserva = 41) e a gravação do estado (1).
    expect(used).toBeLessThanOrEqual(45)
    expect(limited.calls()).toBe(used)
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM provider_work').get()).toEqual({ n: 16 })
  })

  it('a ESPN com uma data só pede o que usa, e a football-data fica com o resto', async () => {
    const { db } = setupQueue()
    await seed(db, 'football-data', 16)
    await seed(db, 'espn', 1)
    const { fd, espn } = queued()

    await runProviderDrains(limitD1Calls(db).db, [fd, espn], { now: NOW })

    // 4 de custo fixo e 1 item de 9: 13. O resto da fatia justa vai para a football-data.
    expect(espn.shares[0]).toBe(13)
    expect(fd.shares[0]).toBe(31)
  })

  it('os dois com fila de sobra repartem por igual, como antes', async () => {
    const { db } = setupQueue()
    await seed(db, 'football-data', 16)
    await seed(db, 'espn', 16)
    const { fd, espn } = queued()

    await runProviderDrains(limitD1Calls(db).db, [fd, espn], { now: NOW })

    expect([fd.shares[0], espn.shares[0]]).toEqual([22, 22])
  })

  it('ESPN bloqueada com fila: o dreno roda só com a fatia que comporta a reclamação, para avisar o motivo', async () => {
    const { sqlite, db } = setupQueue()
    await seed(db, 'football-data', 16)
    await seed(db, 'espn', 3)
    sqlite.exec(
      `UPDATE provider_rate_state SET blocked_until = ${NOW + 60_000} WHERE provider = 'espn'`,
    )
    const { fd, espn } = queued()

    await runProviderDrains(limitD1Calls(db).db, [fd, espn], { now: NOW })

    expect(espn.shares[0]).toBe(13)
    expect(fd.shares[0]).toBe(31)
  })

  it('ESPN bloqueada sem fila e sem nada pendente: nem roda', async () => {
    const { sqlite, db } = setupQueue()
    await seed(db, 'football-data', 16)
    sqlite.exec(`UPDATE provider_rate_state SET suspended_at = ${NOW} WHERE provider = 'espn'`)
    const { fd, espn } = queued()

    await runProviderDrains(limitD1Calls(db).db, [fd, espn], { now: NOW })

    expect(espn.shares).toEqual([])
    expect(fd.shares).toEqual([44])
  })

  it('um dreno só não precisa de sondagem: recebe os 45', async () => {
    const { db } = setupQueue()
    await seed(db, 'football-data', 16)
    const limited = limitD1Calls(db)
    const { fd } = queued()

    await runProviderDrains(limited.db, [fd], { now: NOW })

    expect(fd.shares).toEqual([45])
  })

  it('sondagem que falha não derruba o coordenador: divide por igual, e a chamada conta', async () => {
    const { db } = setupQueue()
    await seed(db, 'football-data', 16)
    const broken = flakyD1(db, { failStatement: (sql) => sql.includes('GROUP BY w.provider') })
    const limited = limitD1Calls(broken)
    const { fd, espn } = queued()

    const used = await runProviderDrains(limited.db, [fd, espn], { now: NOW })

    expect(console.error).toHaveBeenCalled()
    // 44 de saldo depois da sondagem que falhou, por igual: 22 e 22.
    expect([fd.shares[0], espn.shares[0]]).toEqual([22, 22])
    expect(used).toBeLessThanOrEqual(45)
  })

  it('a sondagem soma no total e o teto de 45 vale com ela', async () => {
    const { db } = setupQueue()
    await seed(db, 'football-data', 16)
    await seed(db, 'espn', 16)
    const limited = limitD1Calls(db)
    const { fd, espn } = queued()

    const used = await runProviderDrains(limited.db, [fd, espn], { now: NOW })

    expect(used).toBeLessThanOrEqual(DRAIN_CALL_BUDGET)
    expect(limited.calls()).toBe(used)
  })
})

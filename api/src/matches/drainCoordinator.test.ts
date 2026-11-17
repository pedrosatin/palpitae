/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { limitD1Calls } from '../testing/d1CallLimit'
import { createSqliteD1 } from '../testing/sqliteD1'
import { CallBudgetExhaustedError } from './callBudget'
import { DRAIN_CALL_BUDGET, type DrainBudget } from './drainBudget'
import {
  DRAIN_MAX_PASSES,
  runProviderDrains,
  splitBudget,
  type ProviderDrain,
} from './drainCoordinator'
import type { DrainRun } from './providerWork'

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
  outcomes: [],
  ...overrides,
})

type Simulated = ProviderDrain & { shares: number[] }

/**
 * Dreno que quer gastar `demand` chamadas de trabalho e gasta o que a fatia
 * deixa, pelo D1 dela, e depois grava o estado (1 chamada, a reservada). Para
 * por saldo quando a demanda não coube.
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
    expect(used).toBe(45)
    expect(limited.calls()).toBe(45)
  })

  it('dois drenos famintos dividem o saldo e juntos nunca passam de 45', async () => {
    const { limited } = setup()
    const fd = simulated('football-data', 100)
    const espn = simulated('espn', 100)

    const used = await runProviderDrains(limited.db, [fd, espn])

    expect(fd.shares[0] + espn.shares[0]).toBe(45)
    expect(fd.shares[0]).toBe(23)
    expect(espn.shares[0]).toBe(22)
    expect(used).toBe(45)
    // A plataforma recusa a chamada 51, e o total do dreno nem chega perto de 46.
    expect(limited.calls()).toBeLessThanOrEqual(45)
  })

  it('a sobra de quem terminou cedo vai para quem parou por saldo, numa segunda rodada', async () => {
    const { limited } = setup()
    const fd = simulated('football-data', 100)
    const espn = simulated('espn', 5)

    const used = await runProviderDrains(limited.db, [fd, espn])

    // 1ª rodada: fd gasta as 23 e para por saldo; espn gasta 5 e grava o estado (6).
    // 2ª rodada: só o fd roda de novo, com o que sobrou (45 − 23 − 6 = 16).
    expect(fd.shares).toEqual([23, 16])
    expect(espn.shares).toEqual([22])
    expect(used).toBe(45)
    expect(limited.calls()).toBeLessThanOrEqual(45)
  })

  it('a rodada extra só chama o dreno cuja fatia chega ao mínimo dele', async () => {
    const { limited } = setup()
    const fd = { ...simulated('football-data', 100), minCalls: 30 }
    const espn = simulated('espn', 5)

    const used = await runProviderDrains(limited.db, [fd, espn])

    // Sobram 16 depois da 1ª rodada, menos que as 30 que o fd precisa: ele não roda de novo.
    expect(fd.shares).toEqual([23])
    expect(used).toBe(29)
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
      expect.objectContaining({ blobs: ['provider_work_run', 'error', 'D1 fora do ar'] }),
    )
  })

  it('o orçamento é parâmetro: um limite menor reparte o que há', async () => {
    const { limited } = setup()
    const fd = simulated('football-data', 100)

    const used = await runProviderDrains(limited.db, [fd], { limit: 12 })

    expect(fd.shares[0]).toBe(12)
    expect(used).toBe(12)
  })
})

/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import template from '../providers/__fixtures__/espn-conmebol-sudamericana-scoreboard.json'
import type { EspnScoreboardEvent } from '../providers/espn'
import { resetEspnClientForTests, setEspnMinIntervalForTests } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import { CallBudgetExhaustedError } from './callBudget'
import { CLAIM_CALLS, DrainBudget, SETTLE_CALLS } from './drainBudget'
import { ESPN_REQUEST_CALLS } from './espnAccess'
import {
  espnDeferralItems,
  espnDrain,
  espnItemCost,
  espnMinItemCalls,
  espnSyncCost,
  espnSyncedHandler,
  espnWorkItems,
  runEspnWorkItem,
} from './espnWork'
import { enqueueProviderWork, type ProviderWorkItem } from './providerWork'
import { scoreUnprocessedMatches } from './scoring'

vi.mock('./scoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./scoring')>()
  return { ...actual, scoreUnprocessedMatches: vi.fn(actual.scoreUnprocessedMatches) }
})

const handles: DatabaseSync[] = []
const NOW = Date.parse('2026-11-16T12:00:00Z')
/** Saldo do ramo drenador do `scheduled` (`DRAIN_CALL_BUDGET`). */
const SLICE = 45

beforeEach(() => {
  resetEspnClientForTests()
  setEspnMinIntervalForTests(0)
})

afterEach(() => {
  handles.splice(0).forEach((sqlite) => sqlite.close())
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.restoreAllMocks()
  vi.useRealTimers()
  resetEspnClientForTests()
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const writeDataPoint = vi.fn()
  const events = (type: string) =>
    writeDataPoint.mock.calls
      .map(([point]) => point as { blobs: string[]; doubles: number[] })
      .filter((point) => point.blobs[0] === type)
  return { sqlite, db, ae: { writeDataPoint } as unknown as AnalyticsEngineDataset, events }
}

const base = {
  kind: 'manual' as const,
  competitionCode: 'conmebol.sudamericana',
  season: '2026',
  competitionId: 'c1',
}

const item = (overrides: Partial<ProviderWorkItem> = {}): ProviderWorkItem => ({
  ...base,
  round: '20261014',
  attempts: 0,
  leaseOwner: 'dono',
  ...overrides,
})

/** Scoreboard com `count` jogos entre `teams` times, todos no mesmo estado. */
function board(count: number, teams: number, finished: boolean) {
  const events = Array.from({ length: count }, (_, i) => {
    const ev = structuredClone(template.events[0]) as EspnScoreboardEvent
    ev.id = `ev-${i}`
    ev.date = '2026-10-14T22:00Z'
    ev.season = { year: 2026, slug: 'semifinals' }
    const comp = ev.competitions![0]
    comp.status = {
      type: {
        state: finished ? 'post' : 'pre',
        name: finished ? 'STATUS_FINAL' : 'STATUS_SCHEDULED',
        completed: finished,
      },
    }
    const [home, away] = comp.competitors!
    for (const [side, n] of [
      [home, 2 * i],
      [away, 2 * i + 1],
    ] as const) {
      const id = String(7000 + (n % teams))
      side.id = id
      side.team = { ...side.team, id, displayName: `Time ${id}`, abbreviation: `T${n % teams}` }
      side.score = finished ? '1' : undefined
      side.winner = undefined
    }
    return ev
  })
  return { events }
}

describe('espnWorkItems', () => {
  it('um item por data, sem repetir, e um único item de rodada corrente sem datas', () => {
    expect(espnWorkItems(base, ['20261014', '20261015', '20261014', ''])).toEqual([
      { provider: 'espn', ...base, round: '20261014' },
      { provider: 'espn', ...base, round: '20261015' },
    ])
    expect(espnWorkItems(base, undefined)).toEqual([{ provider: 'espn', ...base, round: '' }])
    expect(espnWorkItems(base, [])).toEqual([{ provider: 'espn', ...base, round: '' }])
  })
})

describe('espnDeferralItems', () => {
  const at = NOW

  it('falta de saldo do tick não é falha nem bloqueio: a data volta já no próximo dreno, sem tentativa', () => {
    const items = espnDeferralItems(
      base,
      ['20261014', '20261015'],
      new CallBudgetExhaustedError(),
      at,
    )

    expect(items).toEqual(
      ['20261014', '20261015'].map((round) => ({
        provider: 'espn',
        ...base,
        round,
        notBefore: at,
        lastError: 'saldo de chamadas do tick esgotado; a data volta no próximo dreno',
      })),
    )
  })

  it('bloqueio ou suspensão voltam no prazo que o erro informa', () => {
    const blocked = Object.assign(new Error('ESPN indisponível (blocked)'), {
      retryAt: at + 7_200_000,
    })

    const [item] = espnDeferralItems(base, ['20261014'], blocked, at)

    expect(item).toMatchObject({
      notBefore: at + 7_200_000,
      lastError: 'ESPN indisponível (blocked)',
    })
  })

  it('outra falha espera a pausa conservadora de uma janela', () => {
    const [item] = espnDeferralItems(base, ['20261014'], new Error('timeout'), at)

    expect(item).toMatchObject({ notBefore: at + 60_000, lastError: 'timeout' })
  })
})

describe('espnSyncCost', () => {
  it('uma data custa o que o dreno estima; cada data a mais soma a requisição e, passando de 100 jogos ou times, mais um batch', () => {
    expect(espnSyncCost(1)).toBe(9)
    expect(espnSyncCost(2)).toBe(12)
    expect(espnSyncCost(3)).toBe(16)
    expect(espnSyncCost(0)).toBe(9)
    expect(espnSyncCost(1)).toBe(espnMinItemCalls())
  })
})

describe('runEspnWorkItem', () => {
  const open = (db: D1Database, calls = SLICE) => new DrainBudget(db, calls).open(0)!

  it('403 devolve o item à fila no prazo do bloqueio e encerra o dreno, sem gastar tentativa', async () => {
    const { db } = setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })

    const outcome = await runEspnWorkItem({})(item(), open(db))

    expect(outcome).toMatchObject({
      status: 'requeued',
      notBefore: NOW + 15 * 60_000,
      providerBlocked: true,
    })
  })

  it('429 com Retry-After de 2 h devolve o item para 2 h depois, não para 1 h', async () => {
    const { db } = setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429, headers: { 'retry-after': '7200' } })),
    )
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] })

    const outcome = await runEspnWorkItem({})(item(), open(db))

    expect(outcome).toMatchObject({
      status: 'requeued',
      notBefore: NOW + 2 * 60 * 60_000,
      providerBlocked: true,
    })
  })

  it('5xx e timeout contam tentativa; resposta sem lista de eventos também', async () => {
    const { db } = setup()
    const run = runEspnWorkItem({})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    )
    expect(await run(item(), open(db))).toMatchObject({ status: 'retry' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }),
    )
    expect(await run(item(), open(db))).toMatchObject({ status: 'retry' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({})),
    )
    expect(await run(item(), open(db))).toMatchObject({
      status: 'retry',
      error: expect.stringContaining('resposta incompleta'),
    })
  })

  it('sem saldo para a vaga, o fetch e o registro da resposta, a ESPN nem é chamada', async () => {
    const { sqlite, db } = setup()
    const fetchMock = vi.fn(async () => Response.json({ events: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const windowBefore = sqlite.prepare(`SELECT window_calls FROM provider_rate_state`).all()
    // Fatia de 5: 3 ficam reservadas para o estado, sobram 2 (a tentativa pede 3).
    const span = new DrainBudget(db, 5).open(0)!

    await expect(runEspnWorkItem({})(item(), span)).rejects.toBeInstanceOf(CallBudgetExhaustedError)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(sqlite.prepare(`SELECT window_calls FROM provider_rate_state`).all()).toEqual(
      windowBefore,
    )
    expect(span.used()).toBe(0)
  })

  it('cada tentativa, retry de 5xx incluído, paga a vaga, o fetch e o registro do saldo do item', async () => {
    const { db } = setup()
    let served = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ++served === 1 ? new Response('{}', { status: 503 }) : Response.json({ events: [] }),
      ),
    )
    const span = open(db)

    const outcome = await runEspnWorkItem({})(item(), span)

    expect(outcome).toMatchObject({ status: 'done' })
    expect(served).toBe(2)
    // 5xx: vaga e fetch (2, a resposta 5xx não grava nada). Nova tentativa: vaga, fetch e o
    // registro do sucesso (3).
    expect(span.used()).toBe(2 + ESPN_REQUEST_CALLS)
  })

  it('o retry de 5xx sem saldo para a segunda tentativa devolve o item sem tentativa', async () => {
    const { db } = setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 503 })),
    )
    // Fatia de 7: sobram 4 depois do estado (3). A 1ª tentativa gasta 2 e a 2ª pediria 3.
    const span = new DrainBudget(db, 7).open(0)!

    await expect(runEspnWorkItem({})(item(), span)).rejects.toBeInstanceOf(CallBudgetExhaustedError)
    expect(span.used()).toBe(2)
  })
})

describe('custo de um item da ESPN', () => {
  /** Roda o item sobre o sync real e devolve as chamadas que ele gastou. */
  async function measuredCost(
    work: ProviderWorkItem,
    payload: unknown,
  ): Promise<{ cost: number; sqlite: DatabaseSync }> {
    const { sqlite, db } = setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(payload)),
    )
    const span = new DrainBudget(db, Infinity).open(0)!
    const outcome = await runEspnWorkItem({})(work, span)
    expect(outcome).toMatchObject({ status: 'done' })
    if (outcome.status === 'done') await espnSyncedHandler()(work, outcome.result, span)
    return { cost: span.used(), sqlite }
  }

  it('data sem eventos: a requisição e nada mais (3 chamadas)', async () => {
    const { cost } = await measuredCost(item({ kind: 'result' }), { events: [] })

    // vaga, fetch e o registro do sucesso, que zera a sequência de 403 sem depender da reserva.
    expect(cost).toBe(ESPN_REQUEST_CALLS)
    expect(cost).toBeLessThanOrEqual(espnItemCost(item({ kind: 'result' })))
  })

  it('data de liga (20 jogos, 40 times): 9 chamadas medidas, dentro da estimativa de 9', async () => {
    const work = item({ kind: 'result' })

    const { cost, sqlite } = await measuredCost(work, board(20, 40, false))

    // vaga, fetch, registro, competição (2), times (batch e ids), jogos (trocas e batch).
    expect(cost).toBe(9)
    expect(cost).toBeLessThanOrEqual(espnItemCost(work))
    expect(espnItemCost(work)).toBe(espnMinItemCalls())
    expect(espnMinItemCalls()).toBe(9)
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM matches`).get()).toEqual({ n: 20 })
  })

  it('data de 100 jogos entre 100 times continua em 1 batch de cada: ainda 9 chamadas', async () => {
    const work = item({ kind: 'late' })

    const { cost } = await measuredCost(work, board(100, 100, false))

    expect(cost).toBe(9)
    expect(cost).toBeLessThanOrEqual(espnItemCost(work))
  })

  it('sync manual com jogos a pontuar: sync mais a pontuação, dentro da estimativa de 13', async () => {
    const work = item({ kind: 'manual' })

    const { cost, sqlite } = await measuredCost(work, board(10, 20, true))

    expect(cost).toBeLessThanOrEqual(espnItemCost(work))
    expect(espnItemCost(work)).toBe(13)
    expect(
      sqlite.prepare(`SELECT COUNT(*) AS n FROM matches WHERE scored_at IS NULL`).get(),
    ).toEqual({ n: 0 })
  })

  it('descoberta de uma data com jogos a pontuar: dentro da estimativa de 13', async () => {
    const work = item({ kind: 'discovery' })

    const { cost } = await measuredCost(work, board(10, 20, true))

    expect(cost).toBeLessThanOrEqual(espnItemCost(work))
    expect(espnItemCost(work)).toBe(13)
  })
})

describe('espnDrain', () => {
  const run = (db: D1Database, ae: AnalyticsEngineDataset | undefined, limit = SLICE) =>
    espnDrain({ ae, now: NOW }).run(new DrainBudget(db, limit))

  it('entra no coordenador com o custo fixo do ciclo mais o item mais barato como fatia mínima', () => {
    expect(espnDrain({}).provider).toBe('espn')
    expect(espnDrain({}).minCalls).toBe(4 + espnMinItemCalls())
  })

  it('falha de pós-sync marca a execução como erro e vai para o log, sem repetir o sync', async () => {
    const { sqlite, db, ae, events } = setup()
    await enqueueProviderWork(db, espnWorkItems(base, ['20261014']), NOW)
    const fetchMock = vi.fn(async () => Response.json(board(2, 4, true)))
    vi.stubGlobal('fetch', fetchMock)
    vi.mocked(scoreUnprocessedMatches).mockRejectedValueOnce(new Error('pontuação indisponível'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await run(db, ae)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(
      sqlite.prepare("SELECT status FROM provider_work WHERE provider = 'espn'").get(),
    ).toEqual({
      status: 'done',
    })
    expect(events('provider_work_run')[0].blobs.slice(1, 3)).toEqual(['error', 'espn'])
    expect(events('provider_work_run')[0].doubles.slice(0, 4)).toEqual([1, 1, 0, 0])
    expect(events('football_api_error')[0].blobs.slice(1)).toEqual([
      'drain_post_sync',
      'pontuação indisponível',
    ])
    expect(error).toHaveBeenCalled()
  })

  it('registra os itens devolvidos e as chamadas gastas, e o saldo comporta os itens da fatia', async () => {
    const { sqlite, db, ae, events } = setup()
    await enqueueProviderWork(
      db,
      espnWorkItems({ ...base, kind: 'result' }, [
        '20261014',
        '20261015',
        '20261016',
        '20261017',
        '20261018',
      ]),
      NOW,
    )
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(board(10, 20, false))),
    )
    const budget = new DrainBudget(db, 23)

    const result = await espnDrain({ ae, now: NOW }).run(budget)

    // Fatia de 23 (a metade de 45 com dois drenos): a reclamação comporta (23 - 4) / 9 = 2 itens.
    expect(result).toMatchObject({ claimed: 2, done: 2, released: 0, leaseLost: 0 })
    expect(budget.used).toBeLessThanOrEqual(23)
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM provider_work WHERE status = 'done'").get(),
    ).toEqual({
      n: 2,
    })
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM provider_work WHERE status = 'pending'").get(),
    ).toEqual({ n: 3 })
    const [claimed, done, requeued, failed, , released, callsUsed] =
      events('provider_work_run')[0].doubles
    expect([claimed, done, requeued, failed, released]).toEqual([2, 2, 0, 0, 0])
    expect(callsUsed).toBe(budget.used)
  })

  it('sem itens prontos não registra execução e não chama a ESPN', async () => {
    const { db, ae, events } = setup()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await run(db, ae)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(events('provider_work_run')).toEqual([])
  })

  it('suspensa ou bloqueada, não reclama nada, não escreve no D1 e registra o motivo', async () => {
    const { sqlite, db, ae, events } = setup()
    await enqueueProviderWork(db, espnWorkItems(base, ['20261014']), NOW)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'info').mockImplementation(() => {})

    sqlite
      .prepare("UPDATE provider_rate_state SET blocked_until = ? WHERE provider = 'espn'")
      .run(NOW + 60_000)
    const blocked = new DrainBudget(db, SLICE)
    await espnDrain({ ae, now: NOW }).run(blocked)
    sqlite
      .prepare(
        "UPDATE provider_rate_state SET suspended_at = ?, suspended_reason = 'http_403' WHERE provider = 'espn'",
      )
      .run(NOW)
    await espnDrain({ ae, now: NOW + 24 * 60 * 60_000 }).run(new DrainBudget(db, SLICE))

    expect(fetchMock).not.toHaveBeenCalled()
    // A reclamação recusada (1) e a leitura do estado para dizer o motivo (1): nenhuma escrita.
    expect(blocked.used).toBe(2)
    expect(
      sqlite.prepare("SELECT status, updated_at FROM provider_work WHERE provider = 'espn'").get(),
    ).toEqual({ status: 'pending', updated_at: NOW })
    expect(events('provider_work_run').map((point) => point.blobs.slice(1, 3))).toEqual([
      ['blocked', 'espn'],
      ['suspended', 'espn'],
    ])
  })

  it('a ESPN bloqueada no meio do ciclo encerra o dreno sem tentar os demais itens', async () => {
    const { sqlite, db, ae } = setup()
    await enqueueProviderWork(db, espnWorkItems(base, ['20261014', '20261015', '20261016']), NOW)
    const fetchMock = vi.fn(async () => new Response('{}', { status: 429 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const budget = new DrainBudget(db, SLICE)

    const result = await espnDrain({ ae, now: NOW }).run(budget)

    // Um só fetch: o 429 vale para o provedor inteiro, e os outros itens voltam sem tentar.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.stoppedBy).toBe('provider')
    expect(sqlite.prepare('SELECT status, attempts FROM provider_work').all()).toEqual(
      Array.from({ length: 3 }, () => ({ status: 'pending', attempts: 0 })),
    )
    // Reclamação, a tentativa que levou o 429 (3), a vaga recusada do 2º item (2: a reserva e a
    // leitura do estado) e a gravação do estado.
    expect(budget.used).toBe(CLAIM_CALLS + ESPN_REQUEST_CALLS + 2 + SETTLE_CALLS)
  })
})

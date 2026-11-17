/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EspnUnavailableError } from '../providers/espn'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  ESPN_FORBIDDEN_BACKOFF_MS,
  ESPN_FORBIDDEN_SUSPEND_AFTER,
  ESPN_RATE_LIMIT_ABSURD_RETRY_AFTER_MS,
  ESPN_RATE_LIMIT_PAUSE_MS,
  createEspnGate,
  isEspnRefusal,
} from './espnAccess'
import {
  readProviderState,
  resumeProviderAccess,
  setProviderRateLimitForTests,
} from './providerBudget'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
  setProviderRateLimitForTests('espn', 1000)
})

const T0 = Date.parse('2026-11-16T12:00:00Z')
const MIN = 60_000

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const writeDataPoint = vi.fn()
  const ae = { writeDataPoint } as unknown as AnalyticsEngineDataset
  const gate = createEspnGate(db, ae)
  const at = (ms: number) => vi.useFakeTimers({ now: T0 + ms, toFake: ['Date'] })
  const alerts = () =>
    writeDataPoint.mock.calls
      .map(([point]) => point as { blobs: string[]; doubles: number[] })
      .filter((point) => point.blobs[0] === 'provider_access_blocked')
  at(0)
  return { sqlite, db, gate, at, alerts }
}

/** Uma tentativa: reserva a vaga e registra a resposta com o status dado. */
async function attempt(
  gate: ReturnType<typeof createEspnGate>,
  status: number,
  headers: HeadersInit = {},
) {
  const slot = await gate.reserve()
  return gate.note(slot, status, new Headers(headers))
}

describe('controle de acesso da ESPN: 403', () => {
  it('limita e espaça: 15 min, 1 h, 6 h e a coleta suspensa no quarto 403 seguido', async () => {
    const { db, gate, at, alerts } = setup()

    // 1º 403: bloqueia por 15 min.
    expect(await attempt(gate, 403)).toEqual({ reason: 'blocked', retryAt: T0 + 15 * MIN })
    expect(await readProviderState(db, 'espn')).toMatchObject({ forbiddenStreak: 1 })
    await expect(gate.reserve()).rejects.toMatchObject({
      reason: 'blocked',
      retryAt: T0 + 15 * MIN,
    })

    // 2º 403, depois do bloqueio: 1 h.
    at(15 * MIN)
    expect(await attempt(gate, 403)).toEqual({ reason: 'blocked', retryAt: T0 + 75 * MIN })

    // 3º 403: 6 h.
    at(75 * MIN)
    expect(await attempt(gate, 403)).toEqual({ reason: 'blocked', retryAt: T0 + (75 + 360) * MIN })

    // 4º 403: a coleta é suspensa, nenhuma tentativa nova sai.
    at((75 + 360) * MIN)
    const fourth = await attempt(gate, 403)
    expect(fourth?.reason).toBe('suspended')
    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: ESPN_FORBIDDEN_SUSPEND_AFTER,
      suspendedReason: 'http_403',
    })
    at(24 * 60 * MIN)
    await expect(gate.reserve()).rejects.toMatchObject({ reason: 'suspended' })

    // Um alerta por passo, com a sequência e os minutos até a nova tentativa.
    expect(alerts().map((point) => [point.blobs.slice(1, 4), point.doubles])).toEqual([
      [
        ['espn', '403', 'backoff'],
        [1, 15],
      ],
      [
        ['espn', '403', 'backoff'],
        [2, 60],
      ],
      [
        ['espn', '403', 'backoff'],
        [3, 360],
      ],
      [
        ['espn', '403', 'suspended'],
        [4, 0],
      ],
    ])
    expect(ESPN_FORBIDDEN_BACKOFF_MS).toEqual([15 * MIN, 60 * MIN, 360 * MIN])
  })

  it('dois 403 simultâneos contam um passo só e não esticam o bloqueio', async () => {
    const { db, gate } = setup()
    const [slotA, slotB] = await Promise.all([gate.reserve(), gate.reserve()])

    const [a, b] = await Promise.all([
      gate.note(slotA, 403, new Headers()),
      gate.note(slotB, 403, new Headers()),
    ])

    expect(a).toEqual({ reason: 'blocked', retryAt: T0 + 15 * MIN })
    expect(b).toEqual(a)
    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 1,
      blockedUntil: T0 + 15 * MIN,
    })
  })

  it('uma resposta de sucesso zera a sequência e o gate volta ao normal', async () => {
    const { db, gate, at } = setup()
    await attempt(gate, 403)
    at(15 * MIN)

    const slot = await gate.reserve()
    expect(slot.forbiddenStreak).toBe(1)
    expect(await gate.note(slot, 200, new Headers())).toBeNull()

    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 0,
      suspendedAt: null,
    })
    // O 403 seguinte recomeça do primeiro passo.
    expect((await attempt(gate, 403))?.retryAt).toBe(T0 + 30 * MIN)
  })
})

describe('controle de acesso da ESPN: 401 e 451', () => {
  it.each([401, 451])('o %i proíbe o acesso: suspende na hora e alerta', async (status) => {
    const { db, gate, at, alerts } = setup()

    expect((await attempt(gate, status))?.reason).toBe('suspended')

    expect(await readProviderState(db, 'espn')).toMatchObject({
      suspendedReason: `http_${status}`,
      forbiddenStreak: 0,
    })
    at(48 * 60 * MIN)
    await expect(gate.reserve()).rejects.toBeInstanceOf(EspnUnavailableError)
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].blobs.slice(1, 4)).toEqual(['espn', String(status), 'suspended'])
  })
})

describe('controle de acesso da ESPN: 429', () => {
  const HOUR = 60 * MIN

  it.each([
    ['segundos', { 'retry-after': '120' }, 120_000],
    ['data HTTP', { 'retry-after': new Date(T0 + 5 * MIN).toUTCString() }, 5 * MIN],
    // O prazo que o fornecedor impôs vale inteiro: antes, 7200 s virava 1 h.
    ['2 h em segundos', { 'retry-after': '7200' }, 2 * HOUR],
    ['3 h em data HTTP', { 'retry-after': new Date(T0 + 3 * HOUR).toUTCString() }, 3 * HOUR],
    ['24 h exatas, o limite do que é razoável', { 'retry-after': '86400' }, 24 * HOUR],
    // Menor que o mínimo conservador, o mínimo vale.
    ['5 s, abaixo do mínimo', { 'retry-after': '5' }, ESPN_RATE_LIMIT_PAUSE_MS],
    ['zero', { 'retry-after': '0' }, ESPN_RATE_LIMIT_PAUSE_MS],
    ['data HTTP no passado', { 'retry-after': new Date(T0 - HOUR).toUTCString() }, 60_000],
    ['sem cabeçalho', {}, ESPN_RATE_LIMIT_PAUSE_MS],
    ['cabeçalho inválido', { 'retry-after': 'logo' }, ESPN_RATE_LIMIT_PAUSE_MS],
  ])('pausa pelo Retry-After (%s) sem mexer na sequência de 403', async (_name, headers, ms) => {
    const { db, gate, alerts } = setup()

    expect(await attempt(gate, 429, headers)).toEqual({ reason: 'blocked', retryAt: T0 + ms })

    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 0,
      blockedUntil: T0 + ms,
    })
    // Rate limit já tem `provider_http_attempt`: não gera o alerta de acesso.
    expect(alerts()).toHaveLength(0)
  })

  it.each([
    ['em segundos, 1 s acima de 24 h', { 'retry-after': '86401' }],
    ['em segundos, absurdo', { 'retry-after': '999999999' }],
    ['em data HTTP, uma semana', { 'retry-after': new Date(T0 + 7 * 24 * HOUR).toUTCString() }],
    ['com mais dígitos que um número aguenta', { 'retry-after': '9'.repeat(400) }],
  ])('Retry-After absurdo (%s) suspende a coleta para análise e alerta', async (_name, headers) => {
    const { db, gate, at, alerts } = setup()

    const outcome = await attempt(gate, 429, headers)

    expect(outcome?.reason).toBe('suspended')
    expect(await readProviderState(db, 'espn')).toMatchObject({
      suspendedReason: 'http_429_retry_after',
      forbiddenStreak: 0,
    })
    // Como o 401 e o 451: nenhuma chamada sai até o operador retomar.
    at(48 * HOUR)
    await expect(gate.reserve()).rejects.toMatchObject({ reason: 'suspended' })
    // O 429 comum não alerta (tem `provider_http_attempt`); a suspensão alerta.
    expect(alerts()).toHaveLength(1)
    expect(alerts()[0].blobs.slice(1, 4)).toEqual(['espn', '429', 'suspended'])
  })

  it('o limite do que é razoável é 24 h', () => {
    expect(ESPN_RATE_LIMIT_ABSURD_RETRY_AFTER_MS).toBe(24 * HOUR)
  })

  it('a pausa nunca encurta um bloqueio maior em curso', async () => {
    const { gate, at } = setup()
    await attempt(gate, 403) // bloqueado até T0 + 15 min
    at(MIN)
    const slot = { forbiddenStreak: 1 }

    const outcome = await gate.note(slot, 429, new Headers({ 'retry-after': '30' }))

    expect(outcome?.retryAt).toBe(T0 + 15 * MIN)
  })
})

describe('controle de acesso da ESPN: orçamento e falhas', () => {
  it('o orçamento do minuto é só da ESPN e a janela seguinte volta a ter vagas', async () => {
    setProviderRateLimitForTests('espn', 2)
    const { gate, at } = setup()

    await gate.reserve()
    await gate.reserve()
    await expect(gate.reserve()).rejects.toMatchObject({
      reason: 'window_full',
      retryAt: Math.floor(T0 / MIN) * MIN + MIN,
    })

    at(MIN)
    await expect(gate.reserve()).resolves.toEqual({ forbiddenStreak: 0 })
  })

  it.each([
    [403, { reason: 'blocked', retryAt: T0 + 15 * MIN }],
    [429, { reason: 'blocked', retryAt: T0 + ESPN_RATE_LIMIT_PAUSE_MS }],
    [401, { reason: 'suspended', retryAt: T0 }],
    [451, { reason: 'suspended', retryAt: T0 }],
  ])(
    'falha do D1 ao gravar a resposta %i não lança: usa a estimativa local do bloqueio',
    async (status, expected) => {
      const { db } = setup()
      // A reserva passa; só a gravação da resposta falha.
      const failingDb = {
        ...db,
        prepare: (sql: string) => {
          if (!sql.includes('window_calls')) throw new Error('D1 indisponível')
          return db.prepare(sql)
        },
      } as unknown as D1Database
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      const gate = createEspnGate(failingDb)

      expect(await attempt(gate, status)).toEqual(expected)
      expect(error).toHaveBeenCalled()
    },
  )

  it('falha do D1 na reserva propaga: sem vaga confirmada não há chamada descoordenada', async () => {
    const { db } = setup()
    const failingDb = {
      ...db,
      prepare: () => {
        throw new Error('D1 indisponível')
      },
    } as unknown as D1Database

    await expect(createEspnGate(failingDb).reserve()).rejects.toThrow('D1 indisponível')
  })

  it('isEspnRefusal separa recusa do orçamento de falha do sync', () => {
    expect(isEspnRefusal(new EspnUnavailableError('blocked', T0))).toBe(true)
    expect(isEspnRefusal(new Error('ESPN respondeu 500'))).toBe(false)
  })
})

describe('retomada pelo operador', () => {
  it('resumeProviderAccess limpa suspensão, bloqueio e sequência; o gate volta a reservar', async () => {
    const { db, gate } = setup()
    await attempt(gate, 401)
    await expect(gate.reserve()).rejects.toMatchObject({ reason: 'suspended' })

    await resumeProviderAccess(db, 'espn', T0 + MIN)

    expect(await readProviderState(db, 'espn')).toEqual({
      blockedUntil: 0,
      forbiddenStreak: 0,
      suspendedAt: null,
      suspendedReason: null,
    })
    await expect(gate.reserve()).resolves.toEqual({ forbiddenStreak: 0 })
  })
})

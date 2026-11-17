/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  EspnUnavailableError,
  fetchEspnScoreboard,
  resetEspnClientForTests,
  setEspnMinIntervalForTests,
} from '../providers/espn'
import { flakyD1 } from '../testing/flakyD1'
import { createSqliteD1 } from '../testing/sqliteD1'
import { CallBudgetExhaustedError } from './callBudget'
import {
  ESPN_FORBIDDEN_BACKOFF_MS,
  ESPN_FORBIDDEN_SUSPEND_AFTER,
  ESPN_RATE_LIMIT_ABSURD_RETRY_AFTER_MS,
  ESPN_RATE_LIMIT_PAUSE_MS,
  createEspnDiscoveryGate,
  createEspnGate,
  isEspnRefusal,
  readEspnAccessPause,
  resetEspnAccessForTests,
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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  setProviderRateLimitForTests('espn', 1000)
  resetEspnAccessForTests()
  resetEspnClientForTests()
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
  return { sqlite, db, gate, at, alerts, ae }
}

/** Uma tentativa: reserva a vaga e registra a resposta com o status dado. */
async function attempt(
  gate: ReturnType<typeof createEspnGate>,
  status: number,
  headers: HeadersInit = {},
) {
  await gate.reserve()
  return gate.note(status, new Headers(headers))
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
    await Promise.all([gate.reserve(), gate.reserve()])

    const [a, b] = await Promise.all([gate.note(403, new Headers()), gate.note(403, new Headers())])

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

    await gate.reserve()
    expect(await gate.note(200, new Headers())).toBeNull()

    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 0,
      suspendedAt: null,
    })
    // O 403 seguinte recomeça do primeiro passo.
    expect((await attempt(gate, 403))?.retryAt).toBe(T0 + 30 * MIN)
  })
})

describe('controle de acesso da ESPN: respostas entrelaçadas de gates independentes', () => {
  /**
   * Dois gates (dois isolates) reservam vaga antes de qualquer resposta, então os
   * dois enxergam a sequência de 403 zerada. A última resposta, na ordem em que o D1
   * as grava, vence: sucesso depois de 403 zera a sequência; 403 depois de sucesso
   * conta 1. O estado não pode depender do que a reserva viu.
   */
  async function interleave(responses: [first: number, second: number]) {
    const { db, sqlite } = setup()
    const a = createEspnGate(db)
    const b = createEspnGate(db)
    await a.reserve()
    await b.reserve()
    // `responses` é a ordem em que as respostas chegam ao D1; A recebe o 403 e B o 200.
    const arrivals = {
      403: () => a.note(403, new Headers()),
      200: () => b.note(200, new Headers()),
    } as const
    for (const status of responses) await arrivals[status as 403 | 200]()
    return { db, sqlite }
  }

  it('A=403 e depois B=200: o sucesso mais recente zera a sequência', async () => {
    const { db } = await interleave([403, 200])

    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 0,
      suspendedAt: null,
    })
  })

  it('B=200 e depois A=403: o 403 mais recente conta 1', async () => {
    const { db } = await interleave([200, 403])

    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 1,
      blockedUntil: T0 + 15 * MIN,
    })
  })

  it('o sucesso zera a sequência mas não levanta o bloqueio que o 403 já impôs', async () => {
    const { db, gate } = await (async () => {
      const { db, sqlite } = await interleave([403, 200])
      return { db, sqlite, gate: createEspnGate(db) }
    })()

    // O 403 espaçou a coleta em 15 min: o sucesso concorrente não a antecipa.
    await expect(gate.reserve()).rejects.toMatchObject({
      reason: 'blocked',
      retryAt: T0 + 15 * MIN,
    })
    expect(await readProviderState(db, 'espn')).toMatchObject({ forbiddenStreak: 0 })
  })

  it('com a sequência já em 2, o sucesso entrelaçado a zera e o 403 seguinte recomeça do 1º passo', async () => {
    const { db, sqlite, gate, at } = setup()
    sqlite.exec(`UPDATE provider_rate_state SET forbidden_streak = 2 WHERE provider = 'espn'`)
    const other = createEspnGate(db)
    await other.reserve()
    await gate.reserve()
    // As duas reservas viram a sequência em 2; o sucesso chega depois do 403.
    await gate.note(403, new Headers())
    at(6 * 60 * MIN)
    await other.note(200, new Headers())

    expect(await readProviderState(db, 'espn')).toMatchObject({ forbiddenStreak: 0 })
  })
})

describe('controle de acesso da ESPN: a gravação da proibição falha', () => {
  /** Só a gravação do estado de acesso falha; a reserva da vaga e as leituras seguem. */
  const writesAccessState = (sql: string) =>
    sql.includes('UPDATE provider_rate_state') &&
    !sql.includes('window_calls') &&
    !sql.includes('forbidden_streak = 0')

  function flaky() {
    const { sqlite, db, alerts, ae } = setup()
    const d1 = { broken: true }
    const unreliable = flakyD1(db, { failStatement: (sql) => d1.broken && writesAccessState(sql) })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const gate = createEspnGate(unreliable, ae)
    const at = (ms: number) => vi.setSystemTime(T0 + ms)
    return { sqlite, db, gate, d1, alerts, at }
  }

  it.each([401, 451])(
    'falha ao gravar a suspensão do %i: a reserva seguinte NÃO passa e a coleta só volta depois de gravar',
    async (status) => {
      const { db, gate, d1, alerts } = flaky()

      // A resposta proibiu o acesso e a gravação falhou: o chamador já recebe a suspensão...
      expect((await attempt(gate, status))?.reason).toBe('suspended')
      // ...mas o D1 segue sem a suspensão (o que a reserva seguinte leria como liberado).
      expect(await readProviderState(db, 'espn')).toMatchObject({ suspendedAt: null })
      expect(alerts()).toHaveLength(1)

      // O bloqueio local impede novas reservas na hora, e a gravação é tentada a cada uma.
      await expect(gate.reserve()).rejects.toMatchObject({ reason: 'suspended' })
      await expect(gate.reserve()).rejects.toMatchObject({ reason: 'suspended' })
      expect(await readProviderState(db, 'espn')).toMatchObject({ suspendedAt: null })

      // O D1 volta: a próxima reserva grava a suspensão e segue recusada, agora pelo D1.
      d1.broken = false
      await expect(gate.reserve()).rejects.toMatchObject({ reason: 'suspended' })
      expect(await readProviderState(db, 'espn')).toMatchObject({
        suspendedReason: `http_${status}`,
      })

      // O bloqueio local caiu depois de gravar: só o operador retoma, e o gate volta a reservar.
      await resumeProviderAccess(db, 'espn', T0 + MIN)
      await expect(gate.reserve()).resolves.toBeUndefined()
    },
  )

  it('outro isolate que gravou a suspensão antes: a gravação repetida é idempotente e preserva o motivo', async () => {
    const { db, sqlite, gate, d1 } = flaky()
    await attempt(gate, 401)
    sqlite.exec(
      `UPDATE provider_rate_state SET suspended_at = ${T0 - MIN}, suspended_reason = 'http_451' WHERE provider = 'espn'`,
    )

    d1.broken = false
    await expect(gate.reserve()).rejects.toMatchObject({ reason: 'suspended' })

    expect(await readProviderState(db, 'espn')).toMatchObject({
      suspendedAt: T0 - MIN,
      suspendedReason: 'http_451',
    })
  })

  it('o bloqueio vale para chamadas já enfileiradas no mutex do cliente: só a primeira sai', async () => {
    const { db, gate, d1 } = flaky()
    setEspnMinIntervalForTests(0)
    const fetchMock = vi.fn(async () => new Response('{"message":"proibido"}', { status: 401 }))
    vi.stubGlobal('fetch', fetchMock)

    const results = await Promise.allSettled([
      fetchEspnScoreboard('bra.1', '20261014', undefined, gate),
      fetchEspnScoreboard('bra.1', '20261015', undefined, gate),
      fetchEspnScoreboard('bra.1', '20261016', undefined, gate),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(results.map((r) => (r as PromiseRejectedResult).reason)).toEqual(
      Array.from({ length: 3 }, () => expect.objectContaining({ reason: 'suspended' })),
    )
    expect(await readProviderState(db, 'espn')).toMatchObject({ suspendedAt: null })

    // D1 de volta: a gravação é feita e a fila de chamadas segue recusada pelo estado do D1.
    d1.broken = false
    await expect(fetchEspnScoreboard('bra.1', '20261017', undefined, gate)).rejects.toMatchObject({
      reason: 'suspended',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(await readProviderState(db, 'espn')).toMatchObject({ suspendedReason: 'http_401' })
  })

  it('403 sem gravar: a reserva seguinte espera os 15 min e a sequência é gravada antes de liberar', async () => {
    const { db, gate, d1, at } = flaky()

    expect(await attempt(gate, 403)).toEqual({ reason: 'blocked', retryAt: T0 + 15 * MIN })
    expect(await readProviderState(db, 'espn')).toMatchObject({ forbiddenStreak: 0 })

    at(5 * MIN)
    await expect(gate.reserve()).rejects.toMatchObject({
      reason: 'blocked',
      retryAt: T0 + 15 * MIN,
    })

    // Passados os 15 min, com o D1 de volta, a reserva grava o 403 (com o instante dele) e passa.
    d1.broken = false
    at(16 * MIN)
    await expect(gate.reserve()).resolves.toBeUndefined()
    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 1,
      blockedUntil: T0 + 15 * MIN,
    })
  })

  it('403 sem gravar e o prazo vencido com o D1 ainda fora: o bloqueio local não prende a coleta para sempre', async () => {
    const { gate, at } = flaky()
    await attempt(gate, 403)

    at(16 * MIN)

    // A reserva em si precisa do D1 e passa; o que não pode é o bloqueio local, de prazo vencido, recusar.
    await expect(gate.reserve()).resolves.toBeUndefined()
  })

  it('429 sem gravar: o bloqueio local respeita o Retry-After de 2 h', async () => {
    const { gate, d1, at, db } = flaky()

    expect(await attempt(gate, 429, { 'retry-after': '7200' })).toEqual({
      reason: 'blocked',
      retryAt: T0 + 120 * MIN,
    })
    at(90 * MIN)
    await expect(gate.reserve()).rejects.toMatchObject({
      reason: 'blocked',
      retryAt: T0 + 120 * MIN,
    })

    d1.broken = false
    at(91 * MIN)
    await expect(gate.reserve()).rejects.toMatchObject({ reason: 'blocked' })
    expect(await readProviderState(db, 'espn')).toMatchObject({ blockedUntil: T0 + 120 * MIN })
  })

  it('429 com Retry-After absurdo sem gravar: suspensão local até gravar', async () => {
    const { gate } = flaky()

    expect((await attempt(gate, 429, { 'retry-after': '999999' }))?.reason).toBe('suspended')

    await expect(gate.reserve()).rejects.toMatchObject({ reason: 'suspended' })
  })

  it('falha ao zerar a sequência no sucesso não bloqueia a coleta', async () => {
    const { db, sqlite } = setup()
    sqlite.exec(`UPDATE provider_rate_state SET forbidden_streak = 2 WHERE provider = 'espn'`)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const gate = createEspnGate(
      flakyD1(db, { failStatement: (sql) => sql.includes('forbidden_streak = 0') }),
    )

    await gate.reserve()
    expect(await gate.note(200, new Headers())).toBeNull()

    await expect(gate.reserve()).resolves.toBeUndefined()
  })

  it('com saldo de subrequests, a regravação pendente também paga a chamada dela', async () => {
    const { sqlite, db, d1 } = (() => {
      const { sqlite, db } = setup()
      const state = { broken: true }
      return {
        sqlite,
        db: flakyD1(db, { failStatement: (sql) => state.broken && writesAccessState(sql) }),
        d1: state,
      }
    })()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const callGate = { callsLeft: vi.fn(() => 10), chargeFetch: vi.fn() }
    const gate = createEspnGate(db, undefined, callGate)
    await gate.reserve()
    await gate.note(401, new Headers())

    // A tentativa pede 3 (vaga, fetch e registro) e a regravação, mais 1: com 3 ela nem tenta.
    callGate.callsLeft.mockReturnValue(3)
    d1.broken = false
    await expect(gate.reserve()).rejects.toBeInstanceOf(CallBudgetExhaustedError)
    expect(
      sqlite.prepare('SELECT suspended_at FROM provider_rate_state WHERE provider = ?').get('espn'),
    ).toEqual({
      suspended_at: null,
    })
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

    const outcome = await gate.note(429, new Headers({ 'retry-after': '30' }))

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
    await expect(gate.reserve()).resolves.toBeUndefined()
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
    await expect(gate.reserve()).resolves.toBeUndefined()
  })
})

describe('gate da descoberta e leitura do estado de acesso', () => {
  it('readEspnAccessPause: livre, bloqueada até blocked_until e suspensa', async () => {
    const { db, sqlite } = setup()

    expect(await readEspnAccessPause(db, T0)).toBeNull()

    sqlite.exec(
      `UPDATE provider_rate_state SET blocked_until = ${T0 + 5 * MIN} WHERE provider = 'espn'`,
    )
    expect(await readEspnAccessPause(db, T0)).toEqual({ reason: 'blocked', retryAt: T0 + 5 * MIN })
    // O bloqueio vencido não pausa.
    expect(await readEspnAccessPause(db, T0 + 5 * MIN)).toBeNull()

    sqlite.exec(
      `UPDATE provider_rate_state SET suspended_at = ${T0}, suspended_reason = 'http_401'`,
    )
    expect(await readEspnAccessPause(db, T0 + 10 * MIN)).toMatchObject({ reason: 'suspended' })
  })

  it('o sucesso não escreve no D1 e a reserva não consome vaga: a descoberta segue a 1 chamada por request', async () => {
    const { db, sqlite } = setup()
    const gate = createEspnDiscoveryGate(db)
    const before = sqlite.prepare('SELECT window_calls, updated_at FROM provider_rate_state').all()

    await gate.reserve()
    expect(await gate.note(200, new Headers())).toBeNull()
    expect(await gate.note(500, new Headers())).toBeNull()

    expect(
      sqlite.prepare('SELECT window_calls, updated_at FROM provider_rate_state').all(),
    ).toEqual(before)
  })

  it('a resposta que proíbe é registrada como no gate completo e para os requests seguintes do gate', async () => {
    const { db, alerts } = setup()
    const writeDataPoint = vi.fn()
    const gate = createEspnDiscoveryGate(db, {
      writeDataPoint,
    } as unknown as AnalyticsEngineDataset)
    await gate.reserve()

    expect(await gate.note(403, new Headers())).toEqual({
      reason: 'blocked',
      retryAt: T0 + 15 * MIN,
    })

    expect(await readProviderState(db, 'espn')).toMatchObject({
      forbiddenStreak: 1,
      blockedUntil: T0 + 15 * MIN,
    })
    expect(writeDataPoint).toHaveBeenCalledTimes(1)
    // Sem consultar o D1: o bloqueio ficou na memória do gate.
    await expect(gate.reserve()).rejects.toMatchObject({
      reason: 'blocked',
      retryAt: T0 + 15 * MIN,
    })
    void alerts
  })

  it('a proibição que o D1 não grava segue valendo no isolate, também para o gate da descoberta', async () => {
    const { db } = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = flakyD1(db, {
      failStatement: (sql) =>
        sql.includes('UPDATE provider_rate_state') && !sql.includes('window_calls'),
    })
    const gate = createEspnDiscoveryGate(failing)
    await gate.reserve()

    expect((await gate.note(401, new Headers()))?.reason).toBe('suspended')

    // Outro gate do mesmo isolate (outra execução da descoberta ou o gate completo) não passa.
    await expect(createEspnDiscoveryGate(failing).reserve()).rejects.toMatchObject({
      reason: 'suspended',
    })
    await expect(createEspnGate(failing).reserve()).rejects.toMatchObject({ reason: 'suspended' })
  })

  it('401 que o D1 não gravou e voltou: a descoberta seguinte recusa em vez de liberar o fetch', async () => {
    const { db } = setup()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const state = { broken: true }
    const unreliable = flakyD1(db, {
      failStatement: (sql) =>
        state.broken && sql.includes('UPDATE provider_rate_state') && !sql.includes('window_calls'),
    })
    const first = createEspnDiscoveryGate(unreliable)
    await first.reserve()
    expect((await first.note(401, new Headers()))?.reason).toBe('suspended')
    expect(await readProviderState(db, 'espn')).toMatchObject({ suspendedAt: null })

    // O D1 volta; a descoberta seguinte lê o estado ainda livre (nada gravado) e prossegue
    // até a reserva, que regrava a suspensão e precisa recusar o fetch.
    state.broken = false
    expect(await readEspnAccessPause(db)).toBeNull()
    await expect(createEspnDiscoveryGate(db).reserve()).rejects.toMatchObject({
      reason: 'suspended',
    })
    expect(await readProviderState(db, 'espn')).toMatchObject({ suspendedReason: 'http_401' })
  })
})

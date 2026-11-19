import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./security/limits', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./security/limits')>()
  return {
    ...actual,
    clearExpiredSecurityRecords: vi.fn(async () => {}),
  }
})
vi.mock('./observability/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./observability/events')>()
  return {
    ...actual,
    logError: vi.fn(),
  }
})

vi.mock('./notifications/roundReminder', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./notifications/roundReminder')>()),
  sendRoundReminders: vi.fn(async () => {}),
}))
vi.mock('./observability/export', () => ({
  exportRecentDays: vi.fn(async () => {}),
}))
vi.mock('./observability/quotaUsage', () => ({
  checkQuotaUsage: vi.fn(async () => 'ok'),
}))
vi.mock('./matches/poller', () => ({
  pollActiveMatches: vi.fn(async () => {}),
}))
vi.mock('./matches/fixtureDiscovery', () => ({
  DISCOVERY_CALL_BUDGET: 45,
  discoverFixtures: vi.fn(async () => {}),
}))
vi.mock('./matches/fdWork', () => ({
  footballDataDrain: vi.fn((deps: unknown) => ({ provider: 'football-data', deps })),
}))
vi.mock('./matches/espnWork', () => ({
  espnDrain: vi.fn((deps: unknown) => ({ provider: 'espn', deps })),
}))
vi.mock('./matches/drainCoordinator', () => ({
  runProviderDrains: vi.fn(async () => 0),
}))

import { signJwt } from './auth/jwt'
import {
  DAILY_EXPORT_CRON,
  FIXTURE_DISCOVERY_CRON,
  LEGACY_RESULT_POLLER_CRON,
  POLLER_AND_DRAIN_CRON,
  PROVIDER_WORK_DRAIN_MINUTES,
  RESULT_POLLER_MINUTES,
  ROUND_REMINDER_CRON,
} from './crons'
import worker from './index'
import { runProviderDrains } from './matches/drainCoordinator'
import { espnDrain } from './matches/espnWork'
import { footballDataDrain } from './matches/fdWork'
import { discoverFixtures } from './matches/fixtureDiscovery'
import { pollActiveMatches } from './matches/poller'
import { sendRoundReminders } from './notifications/roundReminder'
import { exportRecentDays } from './observability/export'
import { checkQuotaUsage } from './observability/quotaUsage'
import type { Env } from './types'

import { clearExpiredSecurityRecords } from './security/limits'
import { logError } from './observability/events'

const env = {
  DB: {
    prepare: () => ({ bind: () => ({ first: async () => ({ hits: 1 }) }) }),
    batch: vi.fn(async () => []),
  } as never,
  AE: { writeDataPoint: vi.fn() } as never,
  RESEND_API_KEY: 'rk',
  FOOTBALL_API_KEY: 'fk',
  FRONTEND_URL: 'http://localhost:5173',
  JWT_SECRET: 'jwt-secret',
  BASE_URL: 'https://api.palpitae.com.br',
} as unknown as Env

const ctx = {
  waitUntil: (p: Promise<unknown>) => p,
} as unknown as ExecutionContext

function run(cron: string, scheduledTime = Date.now(), runEnv: Env = env) {
  const controller = {
    cron,
    scheduledTime,
  } as unknown as ScheduledController
  return worker.scheduled!(controller, runEnv, ctx)
}

/** Eventos gravados no Analytics Engine de teste, como [event_type, blob2]. */
function events(runEnv: Env) {
  const write = vi.mocked((runEnv.AE as AnalyticsEngineDataset).writeDataPoint)
  return write.mock.calls.map(([point]) => point?.blobs?.slice(0, 2))
}

describe('scheduled handler routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logs an error if clearExpiredSecurityRecords fails', async () => {
    const error = new Error('DB timeout')
    vi.mocked(clearExpiredSecurityRecords).mockRejectedValueOnce(error)

    await run('*/30 * * * *')

    // Wait for the floating promise to reject
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(clearExpiredSecurityRecords).toHaveBeenCalledTimes(1)
    expect(clearExpiredSecurityRecords).toHaveBeenCalledWith(env.DB)

    expect(logError).toHaveBeenCalledTimes(1)
    expect(logError).toHaveBeenCalledWith(
      env.AE,
      'security_storage_error',
      '[limits] Limpeza de registros expirados falhou:',
      error,
      { blobs: ['cleanup'] },
    )
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('routes the round-reminder cron to sendRoundReminders only', async () => {
    await run('0 10 * * *')

    expect(sendRoundReminders).toHaveBeenCalledTimes(1)
    expect(sendRoundReminders).toHaveBeenCalledWith(
      env.DB,
      'rk',
      env.AE,
      'http://localhost:5173',
      { secret: 'jwt-secret', apiBaseUrl: 'https://api.palpitae.com.br' },
      undefined,
      { fetchBudget: 45, pilotAccess: env },
    )
    expect(exportRecentDays).not.toHaveBeenCalled()
    expect(pollActiveMatches).not.toHaveBeenCalled()
    expect(discoverFixtures).not.toHaveBeenCalled()
  })

  it('passes the configured reminder budget and pilot list to sendRoundReminders', async () => {
    const reminderEnv = {
      ...env,
      REMINDER_FETCH_BUDGET: '120',
      ADMIN_EMAIL: 'admin@example.com',
      PILOT_EMAILS: 'piloto@example.com',
    } as Env

    await run('0 10 * * *', Date.now(), reminderEnv)

    expect(sendRoundReminders).toHaveBeenCalledWith(
      env.DB,
      'rk',
      env.AE,
      'http://localhost:5173',
      { secret: 'jwt-secret', apiBaseUrl: 'https://api.palpitae.com.br' },
      undefined,
      { fetchBudget: 120, pilotAccess: reminderEnv },
    )
  })

  it('assina o link de descadastro com UNSUBSCRIBE_SECRET quando ele existe', async () => {
    const reminderEnv = { ...env, UNSUBSCRIBE_SECRET: 'unsub-secret' } as Env

    await run('0 10 * * *', Date.now(), reminderEnv)

    expect(sendRoundReminders).toHaveBeenCalledWith(
      env.DB,
      'rk',
      env.AE,
      'http://localhost:5173',
      { secret: 'unsub-secret', apiBaseUrl: 'https://api.palpitae.com.br' },
      undefined,
      { fetchBudget: 45, pilotAccess: reminderEnv },
    )
  })

  it('volta ao JWT_SECRET quando UNSUBSCRIBE_SECRET está vazio', async () => {
    const reminderEnv = { ...env, UNSUBSCRIBE_SECRET: '  ' } as Env

    await run('0 10 * * *', Date.now(), reminderEnv)

    expect(sendRoundReminders).toHaveBeenCalledWith(
      env.DB,
      'rk',
      env.AE,
      'http://localhost:5173',
      { secret: 'jwt-secret', apiBaseUrl: 'https://api.palpitae.com.br' },
      undefined,
      { fetchBudget: 45, pilotAccess: reminderEnv },
    )
  })

  it('routes the daily-export cron to exportRecentDays only', async () => {
    await run('5 0 * * *')

    expect(exportRecentDays).toHaveBeenCalledTimes(1)
    expect(checkQuotaUsage).toHaveBeenCalledTimes(1)
    expect(sendRoundReminders).not.toHaveBeenCalled()
    expect(pollActiveMatches).not.toHaveBeenCalled()
    expect(discoverFixtures).not.toHaveBeenCalled()
  })

  it('o cron do export mede as cotas do dia anterior no mesmo horário', async () => {
    await run('5 0 * * *', 1794614700000)

    expect(checkQuotaUsage).toHaveBeenCalledWith(env, new Date(1794614700000))
  })

  it('só o cron do export mede as cotas', async () => {
    await run(POLLER_AND_DRAIN_CRON)
    await run('0 10 * * *')
    await run('15 6 * * *')

    expect(checkQuotaUsage).not.toHaveBeenCalled()
  })

  it('routes the fixture-discovery cron to discoverFixtures only', async () => {
    await run('15 6 * * *', 1792022400000)

    expect(discoverFixtures).toHaveBeenCalledTimes(1)
    // O saldo de 45 subrequests da invocação é o do ramo, com a limpeza do `scheduled` por fora.
    expect(discoverFixtures).toHaveBeenCalledWith(env.DB, 'fk', env.AE, 1792022400000, {
      callBudget: 45,
    })
    expect(pollActiveMatches).not.toHaveBeenCalled()
    expect(sendRoundReminders).not.toHaveBeenCalled()
    expect(exportRecentDays).not.toHaveBeenCalled()
  })

  /** Instante UTC fixo, no dia 2026-10-12, com o minuto escolhido. */
  const atMinute = (minute: number) => Date.UTC(2026, 9, 12, 14, minute, 0)

  it.each(RESULT_POLLER_MINUTES)(
    'trigger fundido, minuto %i: roda só o poller, sem competir com o dreno',
    async (minute) => {
      const scheduledTime = atMinute(minute)
      await run(POLLER_AND_DRAIN_CRON, scheduledTime)

      expect(pollActiveMatches).toHaveBeenCalledTimes(1)
      expect(pollActiveMatches).toHaveBeenCalledWith(env.DB, 'fk', env.AE, scheduledTime)
      expect(runProviderDrains).not.toHaveBeenCalled()
      expect(sendRoundReminders).not.toHaveBeenCalled()
      expect(exportRecentDays).not.toHaveBeenCalled()
      expect(discoverFixtures).not.toHaveBeenCalled()
    },
  )

  it.each(PROVIDER_WORK_DRAIN_MINUTES)(
    'trigger fundido, minuto %i: roda só o dreno da fila durável',
    async (minute) => {
      await run(POLLER_AND_DRAIN_CRON, atMinute(minute))

      // Os drenos da football-data e da ESPN entram na lista do coordenador, que
      // reparte o orçamento de subrequests da invocação entre os dois. Nenhum
      // cron novo (ADR-027).
      expect(footballDataDrain).toHaveBeenCalledWith({ apiKey: 'fk', ae: env.AE })
      expect(espnDrain).toHaveBeenCalledWith({ ae: env.AE })
      expect(runProviderDrains).toHaveBeenCalledTimes(1)
      expect(runProviderDrains).toHaveBeenCalledWith(
        env.DB,
        [
          { provider: 'football-data', deps: { apiKey: 'fk', ae: env.AE } },
          { provider: 'espn', deps: { ae: env.AE } },
        ],
        { ae: env.AE },
      )
      expect(pollActiveMatches).not.toHaveBeenCalled()
      expect(sendRoundReminders).not.toHaveBeenCalled()
      expect(exportRecentDays).not.toHaveBeenCalled()
      expect(discoverFixtures).not.toHaveBeenCalled()
    },
  )

  it('o minuto do despacho vem do horário agendado em UTC, não do relógio do Worker', async () => {
    // 00:30:59 UTC: o segundo de atraso do disparo não muda o minuto.
    await run(POLLER_AND_DRAIN_CRON, Date.UTC(2026, 9, 12, 0, 30, 59))

    expect(pollActiveMatches).toHaveBeenCalledTimes(1)
    expect(runProviderDrains).not.toHaveBeenCalled()
  })

  it('00:05 UTC: o cron fundido drena e o export roda por conta própria, sem se atrapalhar', async () => {
    const scheduledTime = Date.UTC(2026, 9, 12, 0, 5, 0)

    await run(POLLER_AND_DRAIN_CRON, scheduledTime)
    await run(DAILY_EXPORT_CRON, scheduledTime)

    expect(runProviderDrains).toHaveBeenCalledTimes(1)
    expect(exportRecentDays).toHaveBeenCalledTimes(1)
    expect(checkQuotaUsage).toHaveBeenCalledTimes(1)
    expect(pollActiveMatches).not.toHaveBeenCalled()
  })

  it('os outros três crons seguem como antes e não tocam poller nem dreno', async () => {
    await run(DAILY_EXPORT_CRON, Date.UTC(2026, 9, 12, 0, 5, 0))
    await run(ROUND_REMINDER_CRON, Date.UTC(2026, 9, 12, 10, 0, 0))
    await run(FIXTURE_DISCOVERY_CRON, Date.UTC(2026, 9, 12, 6, 15, 0))

    expect(exportRecentDays).toHaveBeenCalledTimes(1)
    expect(sendRoundReminders).toHaveBeenCalledTimes(1)
    expect(discoverFixtures).toHaveBeenCalledTimes(1)
    expect(pollActiveMatches).not.toHaveBeenCalled()
    expect(runProviderDrains).not.toHaveBeenCalled()
  })

  it.each([
    [0, 0],
    [14, 30],
  ])(
    'na transição, o cron antigo do poller (minuto %i:%i) ainda roda só o poller',
    async (hour, minute) => {
      await run(LEGACY_RESULT_POLLER_CRON, Date.UTC(2026, 9, 12, hour, minute, 0))

      expect(pollActiveMatches).toHaveBeenCalledTimes(1)
      expect(runProviderDrains).not.toHaveBeenCalled()
      expect(events(env)).not.toContainEqual(['scheduled_unknown_cron', LEGACY_RESULT_POLLER_CRON])
    },
  )

  it('a expressão antiga do dreno (nunca registrada) não roda nada e vira cron desconhecido', async () => {
    const cron = '5,10,20,25,35,40,50,55 * * * *'
    await run(cron, Date.UTC(2026, 9, 12, 14, 35, 0))

    expect(events(env)).toContainEqual(['scheduled_unknown_cron', cron])
    expect(pollActiveMatches).not.toHaveBeenCalled()
    expect(runProviderDrains).not.toHaveBeenCalled()
  })

  it('cron desconhecido registra evento e não roda o poller', async () => {
    await run('0 6 * * *')

    expect(events(env)).toContainEqual(['scheduled_unknown_cron', '0 6 * * *'])
    expect(pollActiveMatches).not.toHaveBeenCalled()
    expect(sendRoundReminders).not.toHaveBeenCalled()
    expect(exportRecentDays).not.toHaveBeenCalled()
    expect(discoverFixtures).not.toHaveBeenCalled()
    expect(runProviderDrains).not.toHaveBeenCalled()
  })
})

describe('configuração opcional ausente', () => {
  const complete = {
    ...env,
    EVENTS: {} as never,
    PROXY_SHARED_SECRET: 'proxy',
    CF_ACCOUNT_ID: 'account',
    AE_SQL_TOKEN: 'token',
    CF_ANALYTICS_TOKEN: 'analytics-token',
  } as Env

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('não registra nada com tudo configurado', async () => {
    await run(POLLER_AND_DRAIN_CRON, Date.now(), complete)

    expect(events(complete)).toEqual([])
  })

  it.each([
    'EVENTS',
    'PROXY_SHARED_SECRET',
    'BASE_URL',
    'CF_ACCOUNT_ID',
    'AE_SQL_TOKEN',
    'CF_ANALYTICS_TOKEN',
  ] as const)('sem %s registra um evento por execução', async (name) => {
    const partial = { ...complete, [name]: undefined } as Env

    await run(POLLER_AND_DRAIN_CRON, Date.now(), partial)
    expect(events(partial)).toEqual([['scheduled_config_missing', name]])

    await run('5 0 * * *', Date.now(), partial)
    expect(events(partial)).toEqual([
      ['scheduled_config_missing', name],
      ['scheduled_config_missing', name],
    ])
  })

  it('sem AE o aviso sai no log, já que o evento não tem onde ser gravado', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await run(POLLER_AND_DRAIN_CRON, Date.now(), { ...complete, AE: undefined } as Env)

    expect(error).toHaveBeenCalledWith('[scheduled] Configuração ausente: AE')
    error.mockRestore()
  })
})

describe('public routes', () => {
  it('mounts the invite preview under /public without requiring auth', async () => {
    const res = await worker.fetch(new Request('https://api.test/public/invites/nope'), env, ctx)

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Convite não encontrado' })
  })
})

describe('erros em JSON', () => {
  it('rota inexistente responde 404 com { error }', async () => {
    const res = await worker.fetch(new Request('http://localhost/rota-que-nao-existe'), env, ctx)

    expect(res.status).toBe(404)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Rota não encontrada' })
  })

  it('exceção não tratada em rota responde 500 com { error }', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const token = await signJwt({ sub: 'user-1', email: 'a@example.com' }, env.JWT_SECRET, 3600)
    // O D1 falha depois da sessão, do orçamento diário e do balde por minuto. O
    // handler da rota não trata a exceção.
    let calls = 0
    const query = async () => {
      if (++calls > 3) throw new Error('D1_ERROR: no such table')
      return { revoked: 0, valid_after: null, email: 'a@example.com', hits: 1 }
    }
    const failingDb = {
      prepare: () => ({
        bind: () => ({
          first: query,
          all: async () => ({ results: [await query()] }),
        }),
      }),
    }

    const res = await worker.fetch(
      new Request('http://localhost/groups/group-1/members', {
        headers: { Cookie: `session=${token}` },
      }),
      { ...env, DB: failingDb } as unknown as Env,
      ctx,
    )

    expect(res.status).toBe(500)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await res.json()).toEqual({ error: 'Erro interno. Tente novamente.' })
  })
})

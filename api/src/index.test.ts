import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./notifications/roundReminder', () => ({
  sendRoundReminders: vi.fn(async () => {}),
}))
vi.mock('./observability/export', () => ({
  exportRecentDays: vi.fn(async () => {}),
}))
vi.mock('./matches/poller', () => ({
  pollActiveMatches: vi.fn(async () => {}),
}))

import worker from './index'
import { pollActiveMatches } from './matches/poller'
import { sendRoundReminders } from './notifications/roundReminder'
import { exportRecentDays } from './observability/export'
import type { Env } from './types'

const env = {
  DB: {} as never,
  AE: { writeDataPoint: vi.fn() } as never,
  RESEND_API_KEY: 'rk',
  FOOTBALL_API_KEY: 'fk',
  FRONTEND_URL: 'http://localhost:5173',
  JWT_SECRET: 'jwt-secret',
  BASE_URL: 'https://api.palpitae.com.br',
} as unknown as Env

const ctx = { waitUntil: (p: Promise<unknown>) => p } as unknown as ExecutionContext

function run(cron: string) {
  const controller = { cron, scheduledTime: Date.now() } as unknown as ScheduledController
  return worker.scheduled!(controller, env, ctx)
}

describe('scheduled handler routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('routes the round-reminder cron to sendRoundReminders only', async () => {
    await run('0 10 * * *')

    expect(sendRoundReminders).toHaveBeenCalledTimes(1)
    expect(sendRoundReminders).toHaveBeenCalledWith(env.DB, 'rk', env.AE, 'http://localhost:5173', {
      secret: 'jwt-secret',
      apiBaseUrl: 'https://api.palpitae.com.br',
    })
    expect(exportRecentDays).not.toHaveBeenCalled()
    expect(pollActiveMatches).not.toHaveBeenCalled()
  })

  it('routes the daily-export cron to exportRecentDays only', async () => {
    await run('5 0 * * *')

    expect(exportRecentDays).toHaveBeenCalledTimes(1)
    expect(sendRoundReminders).not.toHaveBeenCalled()
    expect(pollActiveMatches).not.toHaveBeenCalled()
  })

  it('falls back to the result poller for any other cron', async () => {
    await run('*/30 * * * *')

    expect(pollActiveMatches).toHaveBeenCalledTimes(1)
    expect(sendRoundReminders).not.toHaveBeenCalled()
    expect(exportRecentDays).not.toHaveBeenCalled()
  })
})

/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  FD_QUOTA_DEFAULT_PAUSE_MS,
  FD_QUOTA_MAX_PAUSE_MS,
  clearFootballDataPause,
  type FootballDataQuota,
} from './footballDataQuota'
import {
  FD_CALLS_PER_MINUTE,
  FootballDataSlotBusyError,
  noteFootballDataBlock,
  reserveFootballDataSlot,
  setFootballDataRateLimitForTests,
} from './providerBudget'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.useRealTimers()
  clearFootballDataPause()
  // O setup global da suíte sobe o teto para os fluxos de pipeline.
  setFootballDataRateLimitForTests(1000)
})

function setup() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  return { sqlite, db }
}

const quota = (remaining: number | null, resetSeconds: number | null): FootballDataQuota => ({
  remaining,
  resetSeconds,
})

describe('orçamento compartilhado da football-data', () => {
  it('reserva vaga na janela e recusa quando o orçamento do minuto acaba', async () => {
    setFootballDataRateLimitForTests(2)
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')

    await reserveFootballDataSlot(db, now)
    await reserveFootballDataSlot(db, now)
    await expect(reserveFootballDataSlot(db, now)).rejects.toBeInstanceOf(FootballDataSlotBusyError)

    const state = sqlite.prepare('SELECT * FROM provider_rate_state').get() as {
      window_started_at: number
      window_calls: number
    }
    // A recusa não consome vaga: duas reservas na janela de 12:00.
    expect(state.window_started_at).toBe(Math.floor(now / 60_000))
    expect(state.window_calls).toBe(2)
  })

  it('reservas concorrentes disputam a mesma janela: uma leva a vaga, a outra fica sem', async () => {
    setFootballDataRateLimitForTests(1)
    const { db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')

    const results = await Promise.allSettled([
      reserveFootballDataSlot(db, now),
      reserveFootballDataSlot(db, now),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const refused = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    )
    expect(refused).toHaveLength(1)
    expect(refused[0].reason).toBeInstanceOf(FootballDataSlotBusyError)
  })

  it('janela nova volta a conceder, e o orçamento configurado é o do free tier com folga', async () => {    setFootballDataRateLimitForTests(FD_CALLS_PER_MINUTE)
    const { db } = setup()
    const now = Date.parse('2026-11-16T12:00:59Z')

    for (let i = 0; i < FD_CALLS_PER_MINUTE; i++) await reserveFootballDataSlot(db, now)
    await expect(reserveFootballDataSlot(db, now)).rejects.toBeInstanceOf(FootballDataSlotBusyError)
    // Um minuto depois a janela recomeça.
    await expect(reserveFootballDataSlot(db, now + 1000)).resolves.toBeUndefined()
    expect(FD_CALLS_PER_MINUTE).toBeLessThan(10)
  })

  it('bloqueio de 429 recusa a reserva até o reset informado', async () => {
    const { db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')

    await noteFootballDataBlock(db, 429, quota(null, 120), now)
    await expect(reserveFootballDataSlot(db, now + 1000)).rejects.toBeInstanceOf(
      FootballDataSlotBusyError,
    )
    await expect(reserveFootballDataSlot(db, now + 120_000)).resolves.toBeUndefined()
  })

  it('429 grava o bloqueio com o reset informado, capado, e a cota zerada também bloqueia', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')

    // Cota zerada em resposta 200 com reset válido: mesmo tratamento do 429.
    await noteFootballDataBlock(db, 200, quota(0, 30), now)
    const blocked = sqlite
      .prepare('SELECT blocked_until, last_remaining FROM provider_rate_state')
      .get() as { blocked_until: number; last_remaining: number }
    expect(blocked.blocked_until).toBe(now + 30_000)
    expect(blocked.last_remaining).toBe(0)

    // Reset absurdo de outra janela não trava o serviço: cap de 1 h, e a pausa
    // em curso nunca encurta.
    await noteFootballDataBlock(db, 429, quota(0, 5 * 60 * 60), now + 1000)
    const after = sqlite
      .prepare('SELECT blocked_until, last_reset_at FROM provider_rate_state')
      .get() as { blocked_until: number; last_reset_at: number }
    expect(after.blocked_until).toBe(now + 1000 + FD_QUOTA_MAX_PAUSE_MS)
    expect(after.last_reset_at).toBe(now + 1000 + 5 * 60 * 60 * 1000)
  })

  it('429 sem reset válido usa a espera conservadora, e resposta normal não bloqueia', async () => {
    const { sqlite, db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')

    await noteFootballDataBlock(db, 429, quota(null, null), now)
    let state = sqlite.prepare('SELECT blocked_until FROM provider_rate_state').get() as {
      blocked_until: number
    }
    expect(state.blocked_until).toBe(now + FD_QUOTA_DEFAULT_PAUSE_MS)

    // Uma pausa em curso nunca encurta.
    await noteFootballDataBlock(db, 429, quota(null, 10), now + 1000)
    state = sqlite.prepare('SELECT blocked_until FROM provider_rate_state').get() as {
      blocked_until: number
    }
    expect(state.blocked_until).toBe(now + FD_QUOTA_DEFAULT_PAUSE_MS)

    // Resposta comum: nada gravado além do que já estava.
    await noteFootballDataBlock(db, 200, quota(7, 3), now + 2000)
    state = sqlite.prepare('SELECT blocked_until FROM provider_rate_state').get() as {
      blocked_until: number
    }
    expect(state.blocked_until).toBe(now + FD_QUOTA_DEFAULT_PAUSE_MS)
  })

  it('o bloqueio no D1 coordena isolates diferentes: a recusa é do orçamento, não do isolate', async () => {
    const { db } = setup()
    const now = Date.parse('2026-11-16T12:00:00Z')

    // O isolate pausa sozinho (`noteFootballDataResponse`) e grava o bloqueio no
    // D1; um segundo reserve no MESMO D1, depois do 429, é recusado mesmo que
    // o isolate que bloqueou já tenha terminado.
    await noteFootballDataBlock(db, 429, quota(null, 60), now)
    await expect(reserveFootballDataSlot(db, now + 1000)).rejects.toBeInstanceOf(
      FootballDataSlotBusyError,
    )
  })
})

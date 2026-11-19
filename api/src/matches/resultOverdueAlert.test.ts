import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  checkAndSendResultOverdueAlert,
  classifySendFailure,
  DEFAULT_OVERDUE_ALERT_COOLDOWN_HOURS,
  overdueAlertCallsLeft,
  overdueAlertCooldownHours,
  overdueAlertEnabled,
  overdueAlertIdempotencyKey,
  RESULT_OVERDUE_ALERT_CALLS,
  RESULT_OVERDUE_ALERT_KEY,
} from './resultOverdueAlert'
import { INVOCATION_CALL_LIMIT } from './callBudget'
import { EmailError } from '../notifications/email'

const NOW = Date.parse('2026-11-19T18:00:00Z')
const COOLDOWN_MS = DEFAULT_OVERDUE_ALERT_COOLDOWN_HOURS * 60 * 60 * 1000

/** Início atrasado no `nowMs` do alerta e no `datetime('now')` do D1 de teste. */
function isoHoursBefore(nowMs: number, hours: number): string {
  const startMs = Math.min(nowMs, Date.now()) - hours * 60 * 60 * 1000
  return new Date(startMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function seedOverdue(
  sqlite: ReturnType<typeof createSqliteD1>['sqlite'],
  nowMs: number,
  hoursAgo = 4,
) {
  const start = isoHoursBefore(nowMs, hoursAgo)
  sqlite.exec(`
    INSERT INTO competitions (id, name, slug, season, provider, external_id, visibility, status)
    VALUES ('c1', 'Liga', 'liga-2026', '2026', 'football-data', '1', 'public', 'ongoing');
    INSERT INTO teams (id, name, short_name, slug)
    VALUES ('t1', 'A', 'A', 'a'), ('t2', 'B', 'B', 'b');
    INSERT INTO matches (
      id, competition_id, external_id, provider, home_team_id, away_team_id,
      start_time, status, round, postponed, home_score, away_score, scored_at
    ) VALUES
      ('m1', 'c1', '1', 'football-data', 't1', 't2',
        '${start}', 'scheduled', '1', 0, NULL, NULL, NULL);
  `)
}

function addOverdueMatch(
  sqlite: ReturnType<typeof createSqliteD1>['sqlite'],
  nowMs: number,
  id: string,
  hoursAgo: number,
) {
  const start = isoHoursBefore(nowMs, hoursAgo)
  sqlite.exec(`
    INSERT INTO matches (
      id, competition_id, external_id, provider, home_team_id, away_team_id,
      start_time, status, round, postponed, home_score, away_score, scored_at
    ) VALUES
      ('${id}', 'c1', '${id}', 'football-data', 't1', 't2',
        '${start}', 'scheduled', '1', 0, NULL, NULL, NULL);
  `)
}

function alertRow(sqlite: ReturnType<typeof createSqliteD1>['sqlite']) {
  return sqlite
    .prepare(`SELECT last_sent_at, last_count FROM ops_alert_state WHERE alert_key = ?`)
    .get(RESULT_OVERDUE_ALERT_KEY) as { last_sent_at: number; last_count: number } | undefined
}

function fakeAe() {
  const writeDataPoint = vi.fn()
  return { ae: { writeDataPoint } as unknown as AnalyticsEngineDataset, writeDataPoint }
}

function alertEvents(writeDataPoint: ReturnType<typeof vi.fn>) {
  return writeDataPoint.mock.calls
    .map(([point]) => point as { blobs: string[]; doubles: number[] })
    .filter((p) => p.blobs[0] === 'result_overdue_alert')
}

describe('flags do alerta', () => {
  it('fica desligado por padrão', () => {
    expect(overdueAlertEnabled(undefined)).toBe(false)
    expect(overdueAlertEnabled('')).toBe(false)
    expect(overdueAlertEnabled('0')).toBe(false)
  })

  it('liga com 1/true/yes/on', () => {
    expect(overdueAlertEnabled('1')).toBe(true)
    expect(overdueAlertEnabled('true')).toBe(true)
    expect(overdueAlertEnabled('YES')).toBe(true)
    expect(overdueAlertEnabled('on')).toBe(true)
  })

  it('cooldown padrão 6 h', () => {
    expect(DEFAULT_OVERDUE_ALERT_COOLDOWN_HOURS).toBe(6)
    expect(overdueAlertCooldownHours(undefined)).toBe(6)
    expect(overdueAlertCooldownHours('12')).toBe(12)
    expect(overdueAlertCooldownHours('0')).toBe(6)
  })

  it('RESULT_OVERDUE_ALERT_CALLS cobre contagem + reserva + fetch + liberação', () => {
    expect(RESULT_OVERDUE_ALERT_CALLS).toBe(4)
  })

  it('chave de idempotência deriva só do instante da reserva', () => {
    expect(overdueAlertIdempotencyKey(NOW)).toBe(`result-overdue-${NOW}`)
    expect(overdueAlertIdempotencyKey(NOW + 1)).toBe(`result-overdue-${NOW + 1}`)
  })

  it('overdueAlertCallsLeft desconta o gasto e a limpeza do cron', () => {
    expect(overdueAlertCallsLeft(0, 1)).toBe(INVOCATION_CALL_LIMIT - 1)
    expect(overdueAlertCallsLeft(45, 1)).toBe(4)
    expect(overdueAlertCallsLeft(46, 1)).toBe(3)
  })
})

describe('classifySendFailure', () => {
  it('trata 400/401/403/422 como definitiva', () => {
    for (const status of [400, 401, 403, 422]) {
      expect(classifySendFailure(new EmailError(status, 'x'))).toBe('definitive')
    }
  })

  it('trata 409, 429, 5xx, timeout e rede como ambígua', () => {
    expect(classifySendFailure(new EmailError(409, 'concurrent_idempotent_requests'))).toBe(
      'ambiguous',
    )
    expect(classifySendFailure(new EmailError(409, 'invalid_idempotent_request'))).toBe('ambiguous')
    expect(classifySendFailure(new EmailError(409, 'something else'))).toBe('ambiguous')
    expect(classifySendFailure(new EmailError(429, 'rate'))).toBe('ambiguous')
    expect(classifySendFailure(new EmailError(500, 'boom'))).toBe('ambiguous')
    expect(classifySendFailure(new DOMException('aborted', 'TimeoutError'))).toBe('ambiguous')
    expect(classifySendFailure(new TypeError('network'))).toBe('ambiguous')
  })
})

describe('checkAndSendResultOverdueAlert', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const baseEnv = {
    ADMIN_EMAIL: 'admin@palpitae.com.br',
    RESEND_API_KEY: 're_test',
    RESULT_OVERDUE_ALERT: '1',
    FRONTEND_URL: 'https://palpitae.com.br',
  }

  it('disabled quando a variável não liga o canal', async () => {
    const { db } = createSqliteD1()
    const outcome = await checkAndSendResultOverdueAlert(
      db,
      { ...baseEnv, RESULT_OVERDUE_ALERT: undefined },
      undefined,
      NOW,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('disabled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('misconfig sem ADMIN_EMAIL ou sem RESEND_API_KEY', async () => {
    const { db } = createSqliteD1()
    expect(
      await checkAndSendResultOverdueAlert(
        db,
        { ...baseEnv, ADMIN_EMAIL: undefined },
        undefined,
        NOW,
        RESULT_OVERDUE_ALERT_CALLS,
      ),
    ).toBe('misconfig')
    expect(
      await checkAndSendResultOverdueAlert(
        db,
        { ...baseEnv, RESEND_API_KEY: '' },
        undefined,
        NOW,
        RESULT_OVERDUE_ALERT_CALLS,
      ),
    ).toBe('misconfig')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skipped_budget sem saldo de subrequests', async () => {
    const { db } = createSqliteD1()
    const outcome = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      undefined,
      NOW,
      RESULT_OVERDUE_ALERT_CALLS - 1,
    )
    expect(outcome).toBe('skipped_budget')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('clear quando não há jogo atrasado', async () => {
    const { db } = createSqliteD1()
    const outcome = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      undefined,
      NOW,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('clear')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('2xx: reserva, envia e mantém cooldown com chave da reserva', async () => {
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, NOW, 4)

    const outcome = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      undefined,
      NOW,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('sent')
    expect(fetchMock).toHaveBeenCalledOnce()
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const body = JSON.parse(String(init.body))
    expect(body.to).toBe('admin@palpitae.com.br')
    expect(body.subject).toBe('[Palpitae] 1 resultado atrasado')
    expect(body.html).toMatch(/admin\/metricas/)
    expect(body.html).not.toMatch(/\d+ min|\d+ h\)/)
    expect((init.headers as Record<string, string>)['Idempotency-Key']).toBe(
      overdueAlertIdempotencyKey(NOW),
    )

    const row = alertRow(sqlite)
    expect(row?.last_sent_at).toBe(NOW)
    expect(row?.last_count).toBe(1)
  })

  it('flexiona o assunto no plural', async () => {
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, NOW, 4)
    addOverdueMatch(sqlite, NOW, 'm2', 5)

    await checkAndSendResultOverdueAlert(db, baseEnv, undefined, NOW, RESULT_OVERDUE_ALERT_CALLS)
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.subject).toBe('[Palpitae] 2 resultados atrasados')
  })

  it('suppressed dentro do cooldown (sem reenviar)', async () => {
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, NOW, 4)
    sqlite
      .prepare(
        `INSERT INTO ops_alert_state (alert_key, last_sent_at, last_count, updated_at)
         VALUES (?, ?, 1, ?)`,
      )
      .run(RESULT_OVERDUE_ALERT_KEY, NOW - 60 * 60 * 1000, NOW - 60 * 60 * 1000)

    const outcome = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      undefined,
      NOW,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('suppressed')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(alertRow(sqlite)?.last_sent_at).toBe(NOW - 60 * 60 * 1000)
  })

  it('reserva volta a ser admitida depois do cooldown', async () => {
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, NOW, 4)
    const sevenHoursAgo = NOW - 7 * 60 * 60 * 1000
    sqlite
      .prepare(
        `INSERT INTO ops_alert_state (alert_key, last_sent_at, last_count, updated_at)
         VALUES (?, ?, 1, ?)`,
      )
      .run(RESULT_OVERDUE_ALERT_KEY, sevenHoursAgo, sevenHoursAgo)

    const outcome = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      undefined,
      NOW,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('sent')
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(alertRow(sqlite)?.last_sent_at).toBe(NOW)
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers['Idempotency-Key']).toBe(overdueAlertIdempotencyKey(NOW))
  })

  it.each([400, 422])(
    '%s libera a reserva e o tick seguinte envia com chave nova',
    async (status) => {
      fetchMock.mockResolvedValueOnce(new Response('bad', { status }))
      const { db, sqlite } = createSqliteD1()
      seedOverdue(sqlite, NOW, 4)

      const outcome = await checkAndSendResultOverdueAlert(
        db,
        baseEnv,
        undefined,
        NOW,
        RESULT_OVERDUE_ALERT_CALLS,
      )
      expect(outcome).toBe('send_failed')
      expect(alertRow(sqlite)?.last_sent_at).toBe(0)

      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
      const retryAt = NOW + 1
      const retry = await checkAndSendResultOverdueAlert(
        db,
        baseEnv,
        undefined,
        retryAt,
        RESULT_OVERDUE_ALERT_CALLS,
      )
      expect(retry).toBe('sent')
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(
        ((fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>)[
          'Idempotency-Key'
        ],
      ).toBe(overdueAlertIdempotencyKey(retryAt))
      expect(alertRow(sqlite)?.last_sent_at).toBe(retryAt)
    },
  )

  async function expectUncertainKeepsReservation(
    firstError: Response | Error,
    detail: string,
  ): Promise<void> {
    if (firstError instanceof Response) {
      fetchMock.mockResolvedValueOnce(firstError)
    } else {
      fetchMock.mockRejectedValueOnce(firstError)
    }
    const { db, sqlite, writeDataPoint, ae } = (() => {
      const created = createSqliteD1()
      const fake = fakeAe()
      return { ...created, ...fake }
    })()
    seedOverdue(sqlite, NOW, 4)

    const outcome = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      ae,
      NOW,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('send_uncertain')
    expect(alertRow(sqlite)?.last_sent_at).toBe(NOW)
    expect(alertEvents(writeDataPoint).some((e) => e.blobs[1] === 'send_uncertain')).toBe(true)
    expect(alertEvents(writeDataPoint).some((e) => e.blobs[2] === detail)).toBe(true)

    // Contagens diferentes dentro do cooldown: não reenvia.
    addOverdueMatch(sqlite, NOW, 'm2', 5)
    const midCooldown = NOW + 30 * 60 * 1000
    const again = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      ae,
      midCooldown,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(again).toBe('suppressed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(alertRow(sqlite)?.last_sent_at).toBe(NOW)

    // Depois da fronteira que Math.floor(now/cooldown) mudaria, ainda dentro do cooldown.
    const pastOldWindow = (Math.floor(NOW / COOLDOWN_MS) + 1) * COOLDOWN_MS
    expect(Math.floor(pastOldWindow / COOLDOWN_MS)).toBeGreaterThan(Math.floor(NOW / COOLDOWN_MS))
    expect(pastOldWindow - NOW).toBeLessThanOrEqual(COOLDOWN_MS)
    const stillHeld = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      ae,
      pastOldWindow,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(stillHeld).toBe('suppressed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  }

  it('timeout mantém a reserva e não reenvia no cooldown', async () => {
    await expectUncertainKeepsReservation(
      new DOMException('The operation was aborted.', 'TimeoutError'),
      'send_error',
    )
  })

  it('erro de rede mantém a reserva e não reenvia no cooldown', async () => {
    await expectUncertainKeepsReservation(new TypeError('fetch failed'), 'send_error')
  })

  it('500 mantém a reserva e não reenvia no cooldown', async () => {
    await expectUncertainKeepsReservation(new Response('boom', { status: 500 }), 'http_500')
  })

  it('409 concurrent_idempotent_requests mantém a reserva', async () => {
    await expectUncertainKeepsReservation(
      new Response('{"name":"concurrent_idempotent_requests"}', { status: 409 }),
      'http_409',
    )
  })

  it('409 invalid_idempotent_request mantém a reserva', async () => {
    await expectUncertainKeepsReservation(
      new Response('{"name":"invalid_idempotent_request"}', { status: 409 }),
      'http_409',
    )
  })

  it('409 com corpo desconhecido mantém a reserva', async () => {
    await expectUncertainKeepsReservation(new Response('conflict', { status: 409 }), 'http_409')
  })

  it('429 mantém a reserva e não reenvia no cooldown', async () => {
    await expectUncertainKeepsReservation(new Response('rate', { status: 429 }), 'http_429')
  })

  it('falha ao liberar mantém a reserva até o cooldown', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 422 }))
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, NOW, 4)

    let releaseAttempts = 0
    const wrapped = {
      prepare(sql: string) {
        if (sql.includes('UPDATE ops_alert_state') && sql.includes('last_sent_at = 0')) {
          return {
            bind: () => ({
              run: async () => {
                releaseAttempts += 1
                throw new Error('D1 write failed')
              },
            }),
          }
        }
        return db.prepare(sql)
      },
    } as unknown as D1Database

    const outcome = await checkAndSendResultOverdueAlert(
      wrapped,
      baseEnv,
      undefined,
      NOW,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('send_failed')
    expect(releaseAttempts).toBe(1)
    expect(alertRow(sqlite)?.last_sent_at).toBe(NOW)

    const again = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      undefined,
      NOW + 30 * 60 * 1000,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(again).toBe('suppressed')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('falha ao reservar o cooldown não envia e-mail', async () => {
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, NOW, 4)
    const broken = {
      prepare(sql: string) {
        if (sql.includes('ops_alert_state') && sql.includes('INSERT')) {
          return {
            bind: () => ({
              run: async () => {
                throw new Error('D1 write failed')
              },
            }),
          }
        }
        return db.prepare(sql)
      },
    } as unknown as D1Database

    const outcome = await checkAndSendResultOverdueAlert(
      broken,
      baseEnv,
      undefined,
      NOW,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('send_failed')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(alertRow(sqlite)).toBeUndefined()
  })

  it('dois ticks concorrentes: só um envia', async () => {
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, NOW, 4)

    const [a, b] = await Promise.all([
      checkAndSendResultOverdueAlert(db, baseEnv, undefined, NOW, RESULT_OVERDUE_ALERT_CALLS),
      checkAndSendResultOverdueAlert(db, baseEnv, undefined, NOW + 1, RESULT_OVERDUE_ALERT_CALLS),
    ])

    const outcomes = [a, b].sort()
    expect(outcomes).toEqual(['sent', 'suppressed'])
    expect(fetchMock).toHaveBeenCalledOnce()
    const row = alertRow(sqlite)
    expect(row?.last_sent_at).toBeGreaterThanOrEqual(NOW)
    expect(row?.last_sent_at).toBeLessThanOrEqual(NOW + 1)
  })

  it('isolate antigo não sobrescreve last_sent_at mais novo', async () => {
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, NOW, 4)
    const newer = NOW + 60_000
    sqlite
      .prepare(
        `INSERT INTO ops_alert_state (alert_key, last_sent_at, last_count, updated_at)
         VALUES (?, ?, 1, ?)`,
      )
      .run(RESULT_OVERDUE_ALERT_KEY, newer, newer)

    const outcome = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      undefined,
      NOW,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('suppressed')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(alertRow(sqlite)?.last_sent_at).toBe(newer)
  })
})

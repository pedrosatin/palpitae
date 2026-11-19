import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  checkAndSendResultOverdueAlert,
  DEFAULT_OVERDUE_ALERT_COOLDOWN_HOURS,
  overdueAlertCooldownHours,
  overdueAlertEnabled,
  RESULT_OVERDUE_ALERT_CALLS,
  RESULT_OVERDUE_ALERT_KEY,
} from './resultOverdueAlert'

function seedOverdue(sqlite: ReturnType<typeof createSqliteD1>['sqlite'], hoursAgo = 4) {
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
        strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-${hoursAgo} hours'), 'scheduled', '1', 0, NULL, NULL, NULL);
  `)
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
})

describe('checkAndSendResultOverdueAlert', () => {
  const now = Date.parse('2026-11-19T18:00:00Z')
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
      now,
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
        now,
        RESULT_OVERDUE_ALERT_CALLS,
      ),
    ).toBe('misconfig')
    expect(
      await checkAndSendResultOverdueAlert(
        db,
        { ...baseEnv, RESEND_API_KEY: '' },
        undefined,
        now,
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
      now,
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
      now,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('clear')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('envia e-mail e grava cooldown', async () => {
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, 4)

    const outcome = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      undefined,
      now,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('sent')
    expect(fetchMock).toHaveBeenCalledOnce()
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))
    expect(body.to).toBe('admin@palpitae.com.br')
    expect(body.subject).toMatch(/atrasado/)
    expect(body.html).toMatch(/admin\/metricas/)

    const row = sqlite
      .prepare(`SELECT last_sent_at, last_count FROM ops_alert_state WHERE alert_key = ?`)
      .get(RESULT_OVERDUE_ALERT_KEY) as { last_sent_at: number; last_count: number }
    expect(row.last_sent_at).toBe(now)
    expect(row.last_count).toBe(1)
  })

  it('suppressed dentro do cooldown (sem reenviar)', async () => {
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, 4)
    sqlite
      .prepare(
        `INSERT INTO ops_alert_state (alert_key, last_sent_at, last_count, updated_at)
         VALUES (?, ?, 1, ?)`,
      )
      .run(RESULT_OVERDUE_ALERT_KEY, now - 60 * 60 * 1000, now - 60 * 60 * 1000)

    const outcome = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      undefined,
      now,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('suppressed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reenvia depois do cooldown', async () => {
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, 4)
    const sevenHoursAgo = now - 7 * 60 * 60 * 1000
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
      now,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('sent')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('send_failed quando o Resend responde erro', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
    const { db, sqlite } = createSqliteD1()
    seedOverdue(sqlite, 4)

    const outcome = await checkAndSendResultOverdueAlert(
      db,
      baseEnv,
      undefined,
      now,
      RESULT_OVERDUE_ALERT_CALLS,
    )
    expect(outcome).toBe('send_failed')
    const row = sqlite
      .prepare(`SELECT 1 AS ok FROM ops_alert_state WHERE alert_key = ?`)
      .get(RESULT_OVERDUE_ALERT_KEY)
    expect(row).toBeUndefined()
  })
})

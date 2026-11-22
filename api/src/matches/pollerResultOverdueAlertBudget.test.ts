/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { D1_CALLS_PER_INVOCATION, limitD1Calls } from '../testing/d1CallLimit'
import { createSqliteD1 } from '../testing/sqliteD1'
import { pollActiveMatches } from './poller'
import * as resultOverdueAlert from './resultOverdueAlert'
import { RESULT_OVERDUE_ALERT_CALLS, RESULT_OVERDUE_ALERT_KEY } from './resultOverdueAlert'

/**
 * Com o alerta de resultado atrasado ligado, o tick do poller (retorno antecipado
 * sem tarefas, caminho com atraso, falha de pontuação e fronteiras de saldo)
 * não tenta a chamada 51 do plano Free. O D1 de teste recusa a 51ª; o fetch do
 * Resend entra na mesma conta. Partidas nascem do mesmo `NOW` do poller.
 */

const NOW = Date.parse('2026-11-19T18:00:00Z')
const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const alertEnv = {
  ADMIN_EMAIL: 'admin@palpitae.com.br',
  RESEND_API_KEY: 're_test',
  RESULT_OVERDUE_ALERT: '1',
  FRONTEND_URL: 'https://palpitae.com.br',
}

function isoHoursBefore(hours: number): string {
  const startMs = Math.min(NOW, Date.now()) - hours * 60 * 60 * 1000
  return new Date(startMs).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function seedOverdueMatch(sqlite: DatabaseSync) {
  const start = isoHoursBefore(4)
  sqlite.exec(`
    INSERT INTO competitions (id, name, slug, season, provider, external_id, visibility, status)
    VALUES ('c1', 'Liga', 'liga-2026', '2026', 'football-data', '2013', 'public', 'ongoing');
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

function seedFinishedUnscored(sqlite: DatabaseSync) {
  const start = isoHoursBefore(4)
  sqlite.exec(`
    INSERT INTO competitions (id, name, slug, season, provider, external_id, visibility, status)
    VALUES ('c1', 'Liga', 'liga-2026', '2026', 'football-data', '2013', 'public', 'ongoing');
    INSERT INTO teams (id, name, short_name, slug)
    VALUES ('t1', 'A', 'A', 'a'), ('t2', 'B', 'B', 'b');
    INSERT INTO matches (
      id, competition_id, external_id, provider, home_team_id, away_team_id,
      start_time, status, round, postponed, home_score, away_score, scored_at
    ) VALUES
      ('m1', 'c1', '1', 'football-data', 't1', 't2',
        '${start}', 'finished', '1', 0, 2, 1, NULL);
    INSERT INTO users (id, email, provider, provider_id) VALUES ('u1', 'u1@example.com', 'google', 'g1');
    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
      VALUES ('g1', 'Bolão', 'c1', 'u1', 'INV1');
    INSERT INTO group_members (id, group_id, user_id, role) VALUES ('gm1', 'g1', 'u1', 'owner');
    INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
      VALUES ('p1', 'u1', 'g1', 'm1', 1, 0);
  `)
}

function stubFetch(chargeFetch: () => void, resendStatus = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      chargeFetch()
      const url = String(input)
      if (url.includes('api.resend.com')) return new Response('ok', { status: resendStatus })
      if (url.includes('api.football-data.org')) {
        return Response.json({ competition: { id: 2013, code: 'BSA' }, matches: [] })
      }
      return Response.json({ events: [] })
    }),
  )
}

function fakeAe() {
  const writeDataPoint = vi.fn()
  return { ae: { writeDataPoint } as unknown as AnalyticsEngineDataset, writeDataPoint }
}

function alertOutcomes(writeDataPoint: ReturnType<typeof vi.fn>): string[] {
  return writeDataPoint.mock.calls
    .map(([point]) => point as { blobs: string[] })
    .filter((p) => p.blobs[0] === 'result_overdue_alert')
    .map((p) => p.blobs[1])
}

function expectNoCall51(limited: ReturnType<typeof limitD1Calls>) {
  expect(limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
  const logged = [console.error, console.warn, console.info].flatMap((fn) =>
    vi.mocked(fn).mock.calls.map((args) => args.map(String).join(' ')),
  )
  expect(logged.filter((line) => line.includes('Too many API requests'))).toEqual([])
}

function forceAlertCallsLeft(left: number) {
  vi.spyOn(resultOverdueAlert, 'overdueAlertCallsLeft').mockReturnValue(left)
}

describe('poller com alerta de atraso no limite de subrequests', () => {
  it('retorno antecipado sem tarefas: alerta roda (clear) e a chamada 51 não sai', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    const limited = limitD1Calls(db)
    stubFetch(limited.chargeFetch)
    limited.startInvocation()
    const { ae, writeDataPoint } = fakeAe()

    await pollActiveMatches(limited.db, 'test-key', ae, NOW, alertEnv)

    expectNoCall51(limited)
    expect(alertOutcomes(writeDataPoint)).toContain('clear')
    const resendCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes('api.resend.com'))
    expect(resendCalls).toHaveLength(0)
  })

  it('com jogo atrasado o alerta envia e o tick fica no teto de 50', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedOverdueMatch(sqlite)

    const limited = limitD1Calls(db)
    stubFetch(limited.chargeFetch)
    limited.startInvocation()
    const { ae, writeDataPoint } = fakeAe()

    await pollActiveMatches(limited.db, 'test-key', ae, NOW, alertEnv)

    expectNoCall51(limited)
    expect(alertOutcomes(writeDataPoint)).toContain('sent')
    const resendCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes('api.resend.com'))
    expect(resendCalls).toHaveLength(1)
    const row = sqlite
      .prepare(`SELECT last_sent_at FROM ops_alert_state WHERE alert_key = ?`)
      .get(RESULT_OVERDUE_ALERT_KEY) as { last_sent_at: number } | undefined
    expect(row?.last_sent_at).toBe(NOW)
  })

  it('falha de pontuação: alerta executa antes do throw e não passa de 50', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedFinishedUnscored(sqlite)
    sqlite.exec(`
      CREATE TEMP TRIGGER pontuacao_quebrada BEFORE UPDATE OF points_awarded ON predictions
        BEGIN SELECT RAISE(ABORT, 'D1_ERROR: disco cheio'); END;
    `)

    const limited = limitD1Calls(db)
    stubFetch(limited.chargeFetch)
    limited.startInvocation()
    const { ae, writeDataPoint } = fakeAe()

    await expect(
      pollActiveMatches(limited.db, 'test-key', ae, NOW, alertEnv),
    ).rejects.toThrow(/disco cheio/)

    expectNoCall51(limited)
    expect(alertOutcomes(writeDataPoint).length).toBeGreaterThan(0)
  })

  it('saldo exatamente 4 depois da limpeza: envia o alerta', async () => {
    forceAlertCallsLeft(RESULT_OVERDUE_ALERT_CALLS)

    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedOverdueMatch(sqlite)
    const limited = limitD1Calls(db)
    stubFetch(limited.chargeFetch)
    limited.startInvocation()
    const { ae, writeDataPoint } = fakeAe()

    await pollActiveMatches(limited.db, 'test-key', ae, NOW, alertEnv)

    expect(resultOverdueAlert.overdueAlertCallsLeft).toHaveBeenCalled()
    expect(alertOutcomes(writeDataPoint)).toContain('sent')
    const row = sqlite
      .prepare(`SELECT last_sent_at FROM ops_alert_state WHERE alert_key = ?`)
      .get(RESULT_OVERDUE_ALERT_KEY) as { last_sent_at: number } | undefined
    expect(row?.last_sent_at).toBe(NOW)
    expectNoCall51(limited)
  })

  it('saldo 3 depois da limpeza: skipped_budget sem consultar D1 nem enviar', async () => {
    forceAlertCallsLeft(RESULT_OVERDUE_ALERT_CALLS - 1)

    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedOverdueMatch(sqlite)

    let countSqlHits = 0
    const limitedBase = limitD1Calls(db)
    const countingDb = new Proxy(limitedBase.db, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('COUNT(DISTINCT competition_id)') && sql.includes('MIN(start_time)')) {
              countSqlHits += 1
            }
            return target.prepare(sql)
          }
        }
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as D1Database

    stubFetch(limitedBase.chargeFetch)
    limitedBase.startInvocation()
    const { ae, writeDataPoint } = fakeAe()

    await pollActiveMatches(countingDb, 'test-key', ae, NOW, alertEnv)

    expect(alertOutcomes(writeDataPoint)).toContain('skipped_budget')
    expect(countSqlHits).toBe(0)
    const resendCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes('api.resend.com'))
    expect(resendCalls).toHaveLength(0)
    const row = sqlite
      .prepare(`SELECT last_sent_at FROM ops_alert_state WHERE alert_key = ?`)
      .get(RESULT_OVERDUE_ALERT_KEY) as { last_sent_at: number } | undefined
    expect(row).toBeUndefined()
    expectNoCall51(limitedBase)
  })

  it('falha definitiva libera a reserva com 4 chamadas e sem passar de 50', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    seedOverdueMatch(sqlite)

    const limited = limitD1Calls(db)
    stubFetch(limited.chargeFetch, 422)
    limited.startInvocation()
    const { ae, writeDataPoint } = fakeAe()

    await pollActiveMatches(limited.db, 'test-key', ae, NOW, alertEnv)

    expect(alertOutcomes(writeDataPoint)).toContain('send_failed')
    const row = sqlite
      .prepare(`SELECT last_sent_at FROM ops_alert_state WHERE alert_key = ?`)
      .get(RESULT_OVERDUE_ALERT_KEY) as { last_sent_at: number } | undefined
    expect(row?.last_sent_at).toBe(0)
    expect(limited.calls()).toBeGreaterThanOrEqual(RESULT_OVERDUE_ALERT_CALLS)
    expectNoCall51(limited)
  })
})

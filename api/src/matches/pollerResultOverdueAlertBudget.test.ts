/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { D1_CALLS_PER_INVOCATION, limitD1Calls } from '../testing/d1CallLimit'
import { createSqliteD1 } from '../testing/sqliteD1'
import { pollActiveMatches } from './poller'
import { RESULT_OVERDUE_ALERT_CALLS, RESULT_OVERDUE_ALERT_KEY } from './resultOverdueAlert'

/**
 * Com o alerta de resultado atrasado ligado, o tick do poller (retorno antecipado
 * sem tarefas, caminho com atraso e falha de pontuação) não tenta a chamada 51
 * do plano Free. O D1 de teste recusa a 51ª; o fetch do Resend entra na mesma conta.
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

function seedOverdueMatch(sqlite: DatabaseSync) {
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
        strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-4 hours'), 'scheduled', '1', 0, NULL, NULL, NULL);
  `)
}

function seedFinishedUnscored(sqlite: DatabaseSync) {
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
        strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-4 hours'), 'finished', '1', 0, 2, 1, NULL);
    INSERT INTO users (id, email, provider, provider_id) VALUES ('u1', 'u1@example.com', 'google', 'g1');
    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
      VALUES ('g1', 'Bolão', 'c1', 'u1', 'INV1');
    INSERT INTO group_members (id, group_id, user_id, role) VALUES ('gm1', 'g1', 'u1', 'owner');
    INSERT INTO predictions (id, user_id, group_id, match_id, predicted_home_score, predicted_away_score)
      VALUES ('p1', 'u1', 'g1', 'm1', 1, 0);
  `)
}

function stubFetch(chargeFetch: () => void) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request) => {
      chargeFetch()
      const url = String(input)
      if (url.includes('api.resend.com')) return new Response(null, { status: 200 })
      if (url.includes('api.football-data.org')) {
        return Response.json({ competition: { id: 2013, code: 'BSA' }, matches: [] })
      }
      return Response.json({ events: [] })
    }),
  )
}

function expectNoCall51(limited: ReturnType<typeof limitD1Calls>) {
  expect(limited.calls()).toBeLessThanOrEqual(D1_CALLS_PER_INVOCATION)
  const logged = [console.error, console.warn, console.info].flatMap((fn) =>
    vi.mocked(fn).mock.calls.map((args) => args.map(String).join(' ')),
  )
  expect(logged.filter((line) => line.includes('Too many API requests'))).toEqual([])
}

describe('poller com alerta de atraso no limite de subrequests', () => {
  it('retorno antecipado sem tarefas: alerta roda e a chamada 51 não sai', async () => {
    const { sqlite, db } = createSqliteD1()
    handles.push(sqlite)
    // Sem jogos: tasks e toScore vazios; o alerta encerra em clear.
    const limited = limitD1Calls(db)
    stubFetch(limited.chargeFetch)
    limited.startInvocation()

    await pollActiveMatches(limited.db, 'test-key', undefined, NOW, alertEnv)

    expectNoCall51(limited)
    expect(limited.calls()).toBeLessThan(RESULT_OVERDUE_ALERT_CALLS + 5)
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

    await pollActiveMatches(limited.db, 'test-key', undefined, NOW, alertEnv)

    expectNoCall51(limited)
    expect(limited.calls()).toBeGreaterThanOrEqual(RESULT_OVERDUE_ALERT_CALLS - 1)
    const resendCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).includes('api.resend.com'))
    expect(resendCalls).toHaveLength(1)
    const row = sqlite
      .prepare(`SELECT last_sent_at FROM ops_alert_state WHERE alert_key = ?`)
      .get(RESULT_OVERDUE_ALERT_KEY) as { last_sent_at: number } | undefined
    expect(row?.last_sent_at).toBe(NOW)
  })

  it('falha de pontuação relança depois do alerta e não passa de 50', async () => {
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

    await expect(
      pollActiveMatches(limited.db, 'test-key', undefined, NOW, alertEnv),
    ).rejects.toThrow(/disco cheio/)

    expectNoCall51(limited)
  })
})

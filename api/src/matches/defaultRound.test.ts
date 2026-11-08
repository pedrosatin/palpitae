/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import type { ExecutionContext } from '@cloudflare/workers-types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import { defaultRoundSql, leftoverCutoff, roundRuleBinds } from './defaultRound'

// "Agora" da auditoria de produção: 07/11/2026.
const NOW = '2026-11-07T15:00:00.000Z'

type Row = {
  round: string
  start: string
  status?: 'scheduled' | 'live' | 'finished'
  postponed?: 0 | 1
  phase?: string
  lockedAt?: string | null
}

const handles: DatabaseSync[] = []

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

afterEach(() => {
  vi.useRealTimers()
  for (const sqlite of handles.splice(0)) sqlite.close()
})

function seed(rows: Row[]) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('alice', 'alice@example.com', 'google', 'g-alice', 'Alice');
    INSERT INTO profiles (user_id, nickname) VALUES ('alice', 'Alice');
    DELETE FROM competitions;
    INSERT INTO competitions (id, name, slug, season, status, type, penalty_phases, visibility) VALUES
      ('bra', 'Brasileirão 2026', 'brasileirao-2026', '2026', 'ongoing', 'league', '[]', 'public');
    INSERT INTO teams (id, name, short_name, slug) VALUES
      ('cha', 'Chapecoense', 'CHA', 'chapecoense'),
      ('vas', 'Vasco', 'VAS', 'vasco');
    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code) VALUES
      ('grupo', 'Realidade do BR', 'bra', 'alice', 'AAAA-BBBB');
    INSERT INTO group_members (group_id, user_id, joined_at) VALUES
      ('grupo', 'alice', '2026-01-01T00:00:00Z');
  `)
  const insert = sqlite.prepare(`
    INSERT INTO matches (
      id, competition_id, external_id, provider, home_team_id, away_team_id,
      start_time, status, round, phase, postponed, locked_at
    ) VALUES (?, 'bra', ?, 'football-data', 'cha', 'vas', ?, ?, ?, ?, ?, ?)
  `)
  rows.forEach((r, i) => {
    const status = r.status ?? (r.start <= NOW ? 'finished' : 'scheduled')
    const lockedAt = r.lockedAt !== undefined ? r.lockedAt : status === 'finished' ? r.start : null
    insert.run(
      `m-${r.round}-${i}`,
      `fd-${i}`,
      r.start,
      status,
      r.round,
      r.phase ?? null,
      r.postponed ?? 0,
      lockedAt,
    )
  })
  return { sqlite, db }
}

async function defaultRound(db: D1Database): Promise<string | null> {
  const row = await db
    .prepare(defaultRoundSql('?'))
    .bind(...roundRuleBinds(NOW), 'bra')
    .first<{ round: string }>()
  return row?.round ?? null
}

function round(n: string, starts: string[], extra: Partial<Row> = {}): Row[] {
  return starts.map((start) => ({ round: n, start, ...extra }))
}

/** Brasileirão 2026 em 07/11: 1–34 encerradas, 21 com CHA×VAS remarcado, 35 toda futura. */
function brasileiraoNovembro(): Row[] {
  const rows: Row[] = []
  for (let r = 1; r <= 34; r++) {
    if (r === 21) continue
    const day = new Date(Date.parse('2026-04-01T22:00:00Z') + (r - 1) * 6 * 86_400_000)
    const start = r === 34 ? '2026-11-02T22:00:00Z' : day.toISOString()
    rows.push(...round(String(r), Array(10).fill(start)))
  }
  rows.push(
    ...round('21', [
      '2026-07-25T21:00:00Z',
      '2026-07-25T23:30:00Z',
      '2026-07-26T19:00:00Z',
      '2026-07-26T21:00:00Z',
      '2026-07-26T23:30:00Z',
      '2026-07-27T00:00:00Z',
      '2026-08-20T23:30:00Z',
      '2026-09-17T23:30:00Z',
      '2026-10-22T23:30:00Z',
    ]),
    { round: '21', start: '2026-11-14T23:30:00Z', status: 'scheduled' },
  )
  rows.push(
    ...round('35', [
      '2026-11-14T21:30:00Z',
      '2026-11-15T19:00:00Z',
      '2026-11-15T21:30:00Z',
      '2026-11-15T23:30:00Z',
      '2026-11-16T19:00:00Z',
      '2026-11-16T21:30:00Z',
      '2026-11-18T22:00:00Z',
      '2026-11-19T00:30:00Z',
      '2026-11-19T22:00:00Z',
      '2026-11-20T00:30:00Z',
    ]),
  )
  // Rodadas seguintes já com tabela: o último jogo da competição não é da 35.
  rows.push(...round('36', Array(10).fill('2026-11-22T22:00:00Z')))
  rows.push(...round('37', Array(10).fill('2026-11-29T22:00:00Z')))
  rows.push(...round('38', Array(10).fill('2026-12-06T22:00:00Z')))
  return rows
}

describe('defaultRoundSql', () => {
  it('ignora a rodada antiga com um jogo remarcado e abre na próxima rodada (cenário real)', async () => {
    const { db } = seed(brasileiraoNovembro())
    expect(await defaultRound(db)).toBe('35')
  })

  it('mantém a rodada em andamento, com jogos de ontem e de amanhã', async () => {
    const { db } = seed([
      ...round('20', Array(10).fill('2026-10-31T22:00:00Z')),
      ...round('21', [...Array(5).fill('2026-11-06T22:00:00Z'), ...Array(5).fill('2026-11-08T22:00:00Z')]),
      ...round('22', Array(10).fill('2026-11-12T22:00:00Z')),
    ])
    expect(await defaultRound(db)).toBe('21')
  })

  it('mantém o mata-mata de ida e volta com uma semana de intervalo até a volta', async () => {
    const { db } = seed([
      ...round('QUARTER_FINALS', Array(4).fill('2026-10-30T22:00:00Z'), { phase: 'QUARTER_FINALS' }),
      ...round('QUARTER_FINALS', Array(4).fill('2026-11-08T22:00:00Z'), { phase: 'QUARTER_FINALS' }),
      ...round('SEMI_FINALS', Array(2).fill('2026-11-20T22:00:00Z'), { phase: 'SEMI_FINALS' }),
    ])
    expect(await defaultRound(db)).toBe('QUARTER_FINALS')
  })

  it('sem jogo futuro não há rodada aberta (fim de temporada cai no último jogo)', async () => {
    const { db } = seed([
      ...round('37', Array(10).fill('2026-10-29T22:00:00Z')),
      ...round('38', Array(10).fill('2026-11-01T22:00:00Z')),
    ])
    expect(await defaultRound(db)).toBeNull()
  })

  it('volta à regra antiga quando todas as rodadas com jogo futuro ficaram para trás', async () => {
    const { db } = seed([
      ...round('21', Array(9).fill('2026-07-26T22:00:00Z')),
      { round: '21', start: '2026-11-14T23:30:00Z' },
      ...round('30', Array(9).fill('2026-09-20T22:00:00Z')),
      { round: '30', start: '2026-11-21T23:30:00Z' },
      ...round('38', Array(10).fill('2026-11-01T22:00:00Z')),
    ])
    expect(await defaultRound(db)).toBe('21')
  })

  it('adiado sem data nova guarda o horário passado e não reabre a rodada (ADR-013)', async () => {
    const { db } = seed([
      ...round('21', Array(9).fill('2026-07-26T22:00:00Z')),
      { round: '21', start: '2026-07-26T22:00:00Z', status: 'scheduled', postponed: 1, lockedAt: null },
      ...round('35', Array(10).fill('2026-11-15T22:00:00Z')),
    ])
    expect(await defaultRound(db)).toBe('35')
  })

  it('corta exatamente LEFTOVER_ROUND_AGE_DAYS antes de agora', () => {
    expect(leftoverCutoff(NOW)).toBe('2026-10-31T15:00:00.000Z')
  })
})

describe('rodada padrão nos endpoints (SQLite D1)', () => {
  const env: Env = {
    DB: undefined as unknown as D1Database,
    JWT_SECRET: 'test-default-round-secret',
    ADMIN_EMAIL: 'admin@palpitae.com.br',
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    RESEND_API_KEY: 'test-resend',
  }
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  async function get(db: D1Database, path: string) {
    const token = await signJwt(
      { sub: 'alice', email: 'alice@example.com', jti: 'jti-alice' },
      env.JWT_SECRET,
      3600,
    )
    const res = await worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        headers: { Cookie: `session=${token}`, 'CF-Connecting-IP': '192.0.2.41' },
      }),
      { ...env, DB: db },
      ctx,
    )
    expect(res.status).toBe(200)
    return res.json()
  }

  it('GET /matches e GET /predictions/user devolvem a rodada 35', async () => {
    const { db } = seed(brasileiraoNovembro())
    const matches = (await get(db, '/matches?competition_id=bra')) as { default_round: string }
    expect(matches.default_round).toBe('35')
    const predictions = (await get(db, '/predictions/user?group_id=grupo&user_id=alice')) as {
      default_round: string
    }
    expect(predictions.default_round).toBe('35')
  })

  it('pendentes da home contam a rodada 35 e o jogo remarcado da 21', async () => {
    const { sqlite, db } = seed(brasileiraoNovembro())
    type Groups = { groups: Array<{ id: string; pending_predictions: number }> }
    const before = (await get(db, '/groups')) as Groups
    expect(before.groups.find((g) => g.id === 'grupo')?.pending_predictions).toBe(11)

    sqlite.exec(`
      INSERT INTO predictions (id, group_id, user_id, match_id, predicted_home_score, predicted_away_score, created_at, updated_at)
      SELECT 'p-' || id, 'grupo', 'alice', id, 1, 0, '${NOW}', '${NOW}'
      FROM matches WHERE round = '21' AND status = 'scheduled'
    `)
    const after = (await get(db, '/groups')) as Groups
    expect(after.groups.find((g) => g.id === 'grupo')?.pending_predictions).toBe(10)
  })

  it('pendentes da home não contam duas vezes a rodada padrão que ficou para trás', async () => {
    const { db } = seed([
      ...round('4', Array(9).fill('2026-02-10T22:00:00Z')),
      // Adiado sem data nova numa rodada antiga: palpite aberto, mas sem prazo.
      { round: '4', start: '2026-02-10T22:00:00Z', status: 'scheduled', postponed: 1, lockedAt: null },
      ...round('21', Array(9).fill('2026-07-26T22:00:00Z')),
      { round: '21', start: '2026-11-14T23:30:00Z' },
      ...round('30', Array(9).fill('2026-09-20T22:00:00Z')),
      { round: '30', start: '2026-11-21T23:30:00Z' },
      ...round('38', Array(10).fill('2026-11-01T22:00:00Z')),
    ])
    const body = (await get(db, '/groups')) as {
      groups: Array<{ id: string; pending_predictions: number }>
    }
    // Padrão = 21 (todas as candidatas ficaram para trás): 1 da 21 + 1 remarcado da 30.
    expect(body.groups.find((g) => g.id === 'grupo')?.pending_predictions).toBe(2)
  })

  it('pendentes da home ignoram jogo futuro de rodada futura que não é a padrão', async () => {
    const { db } = seed([
      ...round('34', Array(10).fill('2026-11-02T22:00:00Z')),
      ...round('35', Array(10).fill('2026-11-15T22:00:00Z')),
      ...round('36', Array(10).fill('2026-11-22T22:00:00Z')),
    ])
    const body = (await get(db, '/groups')) as {
      groups: Array<{ id: string; pending_predictions: number }>
    }
    expect(body.groups.find((g) => g.id === 'grupo')?.pending_predictions).toBe(10)
  })
})

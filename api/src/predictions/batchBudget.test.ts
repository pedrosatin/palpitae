/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { bucketKey, DAILY_BUCKET_ROWS_WRITTEN_PER_ROW } from '../security/limits'
import { reportD1Rows, type ReportedRows } from '../testing/d1RowsReported'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

// Cobrança antecipada das escritas em lote pela API inteira (worker.fetch).

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i
const LIMITER_SQL = /request_limits/

function freezeAt(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(iso))
}

async function setupBatchFixture(options: {
  matchCount: number
  groupIds: string[]
  writtenLimit?: number
}) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)

  const matchIds = Array.from({ length: options.matchCount }, (_, i) => `m${i + 1}`)
  const matchValues = matchIds
    .map(
      (id, i) =>
        `('${id}','c','ext-${i + 1}','test','h','v','2099-01-01T00:00:00Z','scheduled','1',NULL,NULL)`,
    )
    .join(',\n      ')
  const groupValues = options.groupIds
    .map((id) => `('${id}','Grupo ${id}','c','u1','code-${id}')`)
    .join(',\n      ')
  const memberValues = options.groupIds
    .map((id, i) => `('gm-${i + 1}','${id}','u1','owner')`)
    .join(',\n      ')

  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES ('u1','u1@example.test','google','g1');
    INSERT INTO profiles (user_id,nickname) VALUES ('u1','User 1');
    INSERT INTO competitions (id,name,slug,status,penalty_phases)
      VALUES ('c','Liga','test-liga','ongoing','[]');
    INSERT INTO teams (id,name,slug) VALUES ('h','Home','home'), ('v','Away','away');
    INSERT INTO matches (id,competition_id,external_id,provider,home_team_id,away_team_id,start_time,status,round,home_score,away_score)
      VALUES ${matchValues};
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code)
      VALUES ${groupValues};
    INSERT INTO group_members (id,group_id,user_id,role)
      VALUES ${memberValues};
  `)

  const rows = {
    read: 1,
    written: 1,
    limiter: null as ReportedRows | null,
  }
  const reported = reportD1Rows(
    db,
    (sql): ReportedRows =>
      (LIMITER_SQL.test(sql) && rows.limiter) || {
        rows_read: rows.read,
        rows_written: WRITE_SQL.test(sql) ? rows.written : 0,
      },
  )

  const env = {
    DB: reported,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    ...(options.writtenLimit === undefined
      ? {}
      : { D1_DAILY_ROWS_WRITTEN_PER_USER: String(options.writtenLimit) }),
  } as Env

  const token = await signJwt(
    { sub: 'u1', email: 'u1@example.test', jti: crypto.randomUUID() },
    env.JWT_SECRET,
    3 * 86_400,
  )
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  const request = (method: string, path: string, body: unknown) =>
    worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method,
        headers: {
          Cookie: `session=${token}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.10',
        },
        body: JSON.stringify(body),
      }),
      env,
      ctx,
    )

  const seedPredictions = (groupId: string, count: number, home: number, away: number) => {
    const insert = sqlite.prepare(
      `INSERT INTO predictions (id,user_id,group_id,match_id,predicted_home_score,predicted_away_score)
       VALUES (?, 'u1', ?, ?, ?, ?)`,
    )
    for (let i = 0; i < count; i++) {
      insert.run(`${groupId}:${matchIds[i]}`, groupId, matchIds[i], home, away)
    }
  }

  const countGroupPredictions = (groupId: string) =>
    (
      sqlite
        .prepare(`SELECT COUNT(*) AS n FROM predictions WHERE user_id = 'u1' AND group_id = ?`)
        .get(groupId) as { n: number }
    ).n

  const groupScores = (groupId: string) =>
    sqlite
      .prepare(
        `SELECT match_id, predicted_home_score AS h, predicted_away_score AS a
         FROM predictions WHERE user_id = 'u1' AND group_id = ? ORDER BY match_id`,
      )
      .all(groupId) as Array<{ match_id: string; h: number; a: number }>

  const dailyHits = async (kind: 'read' | 'written') => {
    const key = await bucketKey(env.JWT_SECRET, `d1_${kind}:user:u1`)
    const row = sqlite.prepare('SELECT hits FROM request_limits WHERE bucket_key = ?').get(key) as
      | { hits: number }
      | undefined
    return row?.hits
  }

  const seedWrittenHits = async (hits: number) => {
    const key = await bucketKey(env.JWT_SECRET, 'd1_written:user:u1')
    const start = Math.floor(Date.now() / 1000 / 86_400) * 86_400
    sqlite
      .prepare(
        `INSERT INTO request_limits (bucket_key, window_start, hits, expires_at) VALUES (?, ?, ?, ?)`,
      )
      .run(key, start, hits, start + 86_400)
  }

  return {
    sqlite,
    rows,
    matchIds,
    request,
    seedPredictions,
    countGroupPredictions,
    groupScores,
    dailyHits,
    seedWrittenHits,
  }
}

describe('cobrança antecipada do orçamento diário em escritas em lote', () => {
  it('replicate com saldo de 500 recusa 1.000 sem gravar, aceita 400 e barra fontes alternadas', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const targets = Array.from({ length: 10 }, (_, i) => `t${i + 1}`)
    const f = await setupBatchFixture({
      matchCount: 100,
      groupIds: ['srcA', 'srcB', ...targets],
      writtenLimit: 500,
    })
    f.seedPredictions('srcA', 100, 2, 1)
    f.seedPredictions('srcB', 100, 0, 3)

    // 1.000 instruções planejadas > saldo 500 -> 429 sem gravar nada.
    const over = await f.request('POST', '/predictions/replicate', {
      source_group_id: 'srcA',
      target_group_ids: targets,
      match_ids: f.matchIds,
    })
    expect(over.status).toBe(429)
    expect(over.headers.get('Retry-After')).toBe(String(12 * 3600))
    expect(((await over.json()) as { error: string }).error).toMatch(/limite diário/i)
    for (const t of targets) expect(f.countGroupPredictions(t)).toBe(0)
    expect(await f.dailyHits('written')).toBeUndefined()

    // 400 instruções planejadas <= saldo 500 -> grava e desconta uma única vez.
    const ok = await f.request('POST', '/predictions/replicate', {
      source_group_id: 'srcA',
      target_group_ids: targets.slice(0, 4),
      match_ids: f.matchIds,
    })
    expect(ok.status).toBe(200)
    for (const t of targets.slice(0, 4)) expect(f.countGroupPredictions(t)).toBe(100)
    const chargedAfter400 = await f.dailyHits('written')
    expect(chargedAfter400).toBe(400 + 2 * DAILY_BUCKET_ROWS_WRITTEN_PER_ROW)

    // Fonte alternada (srcB com outro placar) sobre os mesmos ou outros destinos passa do saldo restante (96).
    const altSameTargets = await f.request('POST', '/predictions/replicate', {
      source_group_id: 'srcB',
      target_group_ids: targets.slice(0, 4),
      match_ids: f.matchIds,
    })
    expect(altSameTargets.status).toBe(429)
    expect(altSameTargets.headers.get('Retry-After')).toBe(String(12 * 3600))
    for (const t of targets.slice(0, 4)) {
      const scores = f.groupScores(t)
      expect(scores).toHaveLength(100)
      expect(scores.every((s) => s.h === 2 && s.a === 1)).toBe(true)
    }

    const altOtherTarget = await f.request('POST', '/predictions/replicate', {
      source_group_id: 'srcB',
      target_group_ids: [targets[4]!],
      match_ids: f.matchIds,
    })
    expect(altOtherTarget.status).toBe(429)
    expect(f.countGroupPredictions(targets[4]!)).toBe(0)
    expect(await f.dailyHits('written')).toBe(chargedAfter400)

    // O que cabe no saldo restante (90 <= 96) continua gravando.
    const withinRemaining = await f.request('POST', '/predictions/replicate', {
      source_group_id: 'srcB',
      target_group_ids: [targets[4]!],
      match_ids: f.matchIds.slice(0, 90),
    })
    expect(withinRemaining.status).toBe(200)
    expect(f.countGroupPredictions(targets[4]!)).toBe(90)
  })

  it('import respeita o saldo diário, barra fontes alternadas e impõe teto de 1.000 instruções', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const f = await setupBatchFixture({
      matchCount: 600,
      groupIds: ['src600', 'src400a', 'src400b', 'tgt'],
      writtenLimit: 500,
    })
    f.seedPredictions('src600', 600, 1, 0)
    f.seedPredictions('src400a', 400, 2, 0)
    f.seedPredictions('src400b', 400, 0, 2)

    // 600 instruções > saldo 500 -> 429 sem gravar nem marcar importação concluída.
    const over = await f.request('POST', '/predictions/import', {
      source_group_id: 'src600',
      target_group_id: 'tgt',
    })
    expect(over.status).toBe(429)
    expect(over.headers.get('Retry-After')).toBe(String(12 * 3600))
    expect(((await over.json()) as { error: string }).error).toMatch(/limite diário/i)
    expect(f.countGroupPredictions('tgt')).toBe(0)
    expect(await f.dailyHits('written')).toBeUndefined()

    // 400 instruções <= saldo 500 -> grava e desconta (400 palpites + 1 marcador + custo do balde).
    const ok = await f.request('POST', '/predictions/import', {
      source_group_id: 'src400a',
      target_group_id: 'tgt',
    })
    expect(ok.status).toBe(200)
    expect(f.countGroupPredictions('tgt')).toBe(400)
    const charged = await f.dailyHits('written')
    expect(charged).toBe(401 + 2 * DAILY_BUCKET_ROWS_WRITTEN_PER_ROW)

    // Fonte alternada (400 > restante 95) -> 429 sem sobrescrever.
    const alt = await f.request('POST', '/predictions/import', {
      source_group_id: 'src400b',
      target_group_id: 'tgt',
    })
    expect(alt.status).toBe(429)
    expect(f.groupScores('tgt').every((s) => s.h === 2 && s.a === 0)).toBe(true)
    expect(await f.dailyHits('written')).toBe(charged)

    // Teto de 1.000 instruções por requisição no import (mesmo com saldo alto).
    const capFixture = await setupBatchFixture({
      matchCount: 1001,
      groupIds: ['src1001', 'src1000', 'tgtCap'],
      writtenLimit: 5000,
    })
    capFixture.seedPredictions('src1001', 1001, 1, 1)
    capFixture.seedPredictions('src1000', 1000, 2, 1)

    const overCap = await capFixture.request('POST', '/predictions/import', {
      source_group_id: 'src1001',
      target_group_id: 'tgtCap',
    })
    expect(overCap.status).toBe(400)
    expect(capFixture.countGroupPredictions('tgtCap')).toBe(0)

    const atCap = await capFixture.request('POST', '/predictions/import', {
      source_group_id: 'src1000',
      target_group_id: 'tgtCap',
    })
    expect(atCap.status).toBe(200)
    expect(capFixture.countGroupPredictions('tgtCap')).toBe(1000)
  })

  it('bulk cobra as instruções planejadas antes do batch sem gravar na recusa', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const f = await setupBatchFixture({
      matchCount: 100,
      groupIds: ['g1'],
      writtenLimit: 500,
    })
    await f.seedWrittenHits(450)

    // 80 palpites planejados > saldo restante 50 -> 429 sem gravar.
    const over = await f.request('PUT', '/predictions/bulk', {
      group_id: 'g1',
      predictions: f.matchIds.slice(0, 80).map((match_id) => ({
        match_id,
        predicted_home_score: 1,
        predicted_away_score: 0,
      })),
    })
    expect(over.status).toBe(429)
    expect(over.headers.get('Retry-After')).toBe(String(12 * 3600))
    expect(((await over.json()) as { error: string }).error).toMatch(/limite diário/i)
    expect(f.countGroupPredictions('g1')).toBe(0)
    expect(await f.dailyHits('written')).toBe(450)

    // 40 palpites planejados <= saldo restante 50 -> grava e desconta.
    const ok = await f.request('PUT', '/predictions/bulk', {
      group_id: 'g1',
      predictions: f.matchIds.slice(0, 40).map((match_id) => ({
        match_id,
        predicted_home_score: 1,
        predicted_away_score: 0,
      })),
    })
    expect(ok.status).toBe(200)
    expect(f.countGroupPredictions('g1')).toBe(40)
    expect(await f.dailyHits('written')).toBe(450 + 40 + 2 * DAILY_BUCKET_ROWS_WRITTEN_PER_ROW)

    // 20 palpites > saldo restante 6 -> 429 sem gravar.
    const nextOver = await f.request('PUT', '/predictions/bulk', {
      group_id: 'g1',
      predictions: f.matchIds.slice(40, 60).map((match_id) => ({
        match_id,
        predicted_home_score: 2,
        predicted_away_score: 1,
      })),
    })
    expect(nextOver.status).toBe(429)
    expect(f.countGroupPredictions('g1')).toBe(40)
  })

  it('a checagem prévia do lote não entra na medição de uso do handler', async () => {
    freezeAt('2026-11-13T12:00:00Z')
    const f = await setupBatchFixture({
      matchCount: 10,
      groupIds: ['src', 'tgt'],
      writtenLimit: 500,
    })
    f.rows.limiter = { rows_read: 10_000, rows_written: 10_000 }
    f.seedPredictions('src', 5, 1, 0)

    const res = await f.request('POST', '/predictions/replicate', {
      source_group_id: 'src',
      target_group_ids: ['tgt'],
      match_ids: f.matchIds.slice(0, 5),
    })
    expect(res.status).toBe(200)
    expect(await f.dailyHits('written')).toBe(5 + 2 * DAILY_BUCKET_ROWS_WRITTEN_PER_ROW)
  })
})

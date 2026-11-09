/// <reference types="node" />
/**
 * `POST /groups/join` grava em `group_joined` o método de entrada e a flag de
 * cadastro recente, lendo o D1 de verdade (SQLite com as migrations).
 */
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { hashUserId } from '../observability'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const JWT_SECRET = 'test-join-funnel'

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

async function fixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id,created_at) VALUES
      ('owner','owner@example.com','google','1',datetime('now','-30 days')),
      ('fresh','fresh@example.com','google','2',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      ('almost','almost@example.com','google','3',datetime('now','-59 minutes')),
      ('hour','hour@example.com','google','4',datetime('now','-61 minutes')),
      ('veteran','veteran@example.com','google','5',datetime('now','-30 days'));
    INSERT INTO competitions (id,name,slug,status,penalty_phases)
      VALUES ('competition','League','test-league','ongoing','[]');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code)
      VALUES ('group','Private group','competition','owner','ABCD-EFGH');
    INSERT INTO group_members (id,group_id,user_id,role) VALUES ('gm1','group','owner','owner');
  `)
  const writeDataPoint = vi.fn()
  const env = {
    DB: db,
    JWT_SECRET,
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    AE: { writeDataPoint },
  } as unknown as Env
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext

  async function join(user: string, body: Record<string, unknown>) {
    const token = await signJwt(
      { sub: user, email: `${user}@example.com`, jti: crypto.randomUUID() },
      JWT_SECRET,
      3600,
    )
    return worker.fetch(
      new Request('https://api.palpitae.com.br/groups/join', {
        method: 'POST',
        headers: {
          Cookie: `session=${token}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.1',
        },
        body: JSON.stringify(body),
      }),
      env,
      ctx,
    )
  }

  const joinedBlobs = () =>
    writeDataPoint.mock.calls
      .map(([point]) => point as { indexes: string[]; blobs: string[] })
      .filter((point) => point.indexes[0] === 'group_joined')
      .map((point) => point.blobs)

  return { sqlite, join, joinedBlobs }
}

const INVITE = 'ABCD-EFGH'

describe('POST /groups/join: group_joined do funil de convite', () => {
  it('grava convite_link e cadastro recente de quem acabou de criar a conta', async () => {
    const { join, joinedBlobs } = await fixture()

    const res = await join('fresh', { invite_code: INVITE, entry_method: 'convite_link' })

    expect(res.status).toBe(200)
    expect(joinedBlobs()).toEqual([
      ['group_joined', 'group', await hashUserId('fresh'), 'convite_link', '1'],
    ])
  })

  it('grava codigo e conta antiga para quem digitou o código', async () => {
    const { join, joinedBlobs } = await fixture()

    await join('veteran', { invite_code: INVITE, entry_method: 'codigo' })

    expect(joinedBlobs()).toEqual([
      ['group_joined', 'group', await hashUserId('veteran'), 'codigo', '0'],
    ])
  })

  it('separa cadastro recente em 1 h, com o relógio do D1', async () => {
    const { join, joinedBlobs } = await fixture()

    await join('almost', { invite_code: INVITE, entry_method: 'codigo' })
    await join('hour', { invite_code: INVITE, entry_method: 'codigo' })

    expect(joinedBlobs().map((blobs) => blobs[4])).toEqual(['1', '0'])
  })

  it.each([
    ['ausente', undefined],
    ['fora da lista', 'email'],
    ['de outro tipo', 123],
  ])('deixa o método vazio quando vem %s, sem recusar a entrada', async (_label, value) => {
    const { join, joinedBlobs } = await fixture()

    const res = await join('fresh', { invite_code: INVITE, entry_method: value })

    expect(res.status).toBe(200)
    expect(joinedBlobs()[0][3]).toBe('')
  })

  it('não grava evento quando a entrada falha', async () => {
    const { join, joinedBlobs } = await fixture()

    expect((await join('fresh', { invite_code: 'ZZZZ-ZZZZ' })).status).toBe(404)
    await join('fresh', { invite_code: INVITE, entry_method: 'codigo' })
    expect((await join('fresh', { invite_code: INVITE, entry_method: 'codigo' })).status).toBe(409)

    expect(joinedBlobs()).toHaveLength(1)
  })
})

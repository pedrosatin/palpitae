/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../auth/jwt'
import worker from '../index'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

/**
 * Regressão da lacuna apontada na revisão da #792: jogo de mata-mata sem
 * `tie_role` no payload. Em GET /matches, toda fase de mata-mata passa por
 * `indexTies` e sai com `tie_role` (leg1, leg2 ou single), inclusive quando a
 * fase não está em `penalty_phases`.
 */

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

async function fixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES ('u','u@example.com','google','1');
    INSERT INTO competitions (id,name,slug,status,penalty_phases)
      VALUES ('c','Copa','copa-teste','ongoing','["FINAL"]');
    INSERT INTO teams (id,name,slug) VALUES
      ('h','Home','home'), ('a','Away','away'),
      ('x','X','x'), ('y','Y','y');
    INSERT INTO matches (
      id, competition_id, external_id, provider,
      home_team_id, away_team_id, start_time, status, phase, round, leg
    ) VALUES
      ('group','c','e0','football-data','h','a','2099-01-01T00:00:00Z','scheduled','GROUP_STAGE','1',NULL),
      ('qf','c','e1','football-data','h','a','2099-02-01T00:00:00Z','scheduled','QUARTER_FINALS','QUARTER_FINALS',NULL),
      ('leg1','c','e2','football-data','x','y','2099-03-01T00:00:00Z','scheduled','SEMI_FINALS','SEMI_FINALS',1),
      ('leg2','c','e3','football-data','y','x','2099-03-08T00:00:00Z','scheduled','SEMI_FINALS','SEMI_FINALS',2),
      ('final','c','e4','football-data','h','a','2099-04-01T00:00:00Z','scheduled','FINAL','FINAL',NULL);
  `)
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
  } as Env
  const token = await signJwt(
    { sub: 'u', email: 'u@example.com', jti: crypto.randomUUID() },
    env.JWT_SECRET,
    3600,
  )
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  const call = () =>
    worker.fetch(
      new Request('https://api.palpitae.com.br/matches?competition_id=c', {
        headers: { Cookie: `session=${token}` },
      }),
      env,
      ctx,
    )
  return { call }
}

type MatchPayload = {
  id: string
  phase: string | null
  is_knockout: boolean
  decides_on_penalties: boolean
  tie_role?: 'leg1' | 'leg2' | 'single'
}

describe('GET /matches: tie_role em mata-mata', () => {
  it('manda tie_role em toda fase de mata-mata, inclusive sem pênaltis', async () => {
    const { call } = await fixture()
    const response = await call()
    expect(response.status).toBe(200)
    const body = (await response.json()) as { matches: MatchPayload[] }
    const byId = new Map(body.matches.map((m) => [m.id, m]))

    expect(byId.get('group')).toMatchObject({
      is_knockout: false,
      decides_on_penalties: false,
    })
    expect(byId.get('group')).not.toHaveProperty('tie_role')

    // Quartas: mata-mata fora de penalty_phases → sem pênaltis, com tie_role.
    expect(byId.get('qf')).toMatchObject({
      is_knockout: true,
      decides_on_penalties: false,
      tie_role: 'single',
    })

    expect(byId.get('leg1')).toMatchObject({
      is_knockout: true,
      decides_on_penalties: false,
      tie_role: 'leg1',
    })
    expect(byId.get('leg2')).toMatchObject({
      is_knockout: true,
      decides_on_penalties: true,
      tie_role: 'leg2',
    })

    expect(byId.get('final')).toMatchObject({
      is_knockout: true,
      decides_on_penalties: true,
      tie_role: 'single',
    })

    for (const match of body.matches) {
      if (match.is_knockout) {
        expect(match.tie_role, `mata-mata ${match.id} sem tie_role`).toBeDefined()
      } else {
        expect(match, `fase de grupos ${match.id} com tie_role`).not.toHaveProperty('tie_role')
      }
    }
  })
})

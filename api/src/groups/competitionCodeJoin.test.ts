/// <reference types="node" />
/**
 * Prova HTTP + SQLite/D1 real do JOIN competitions.external_id AS competition_code
 * em GET /groups (lista) e GET /groups/:id (detalhe). Sem mock que salte o JOIN.
 */
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'

const handles: DatabaseSync[] = []

afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.unstubAllGlobals()
})

const JWT_SECRET = 'test-competition-code-join'
const ADMIN_EMAIL = 'admin@palpitae.com.br'
const PILOT_EMAIL = 'piloto@example.com'
const ORDINARY_EMAIL = 'comum@example.com'
const OUTSIDER_EMAIL = 'outsider@example.com'

const GAUCHO_ID = 'comp-gaucho-uuid'
const BSA_ID = 'comp-bsa-uuid'
const NULL_EXT_ID = 'comp-null-ext-uuid'
const PILOT_CUP_ID = 'comp-pilot-cup-uuid'

async function fixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)

  sqlite.exec(`
    INSERT INTO users (id, email, provider, provider_id, user_name) VALUES
      ('u-admin', '${ADMIN_EMAIL}', 'google', 'g-admin', 'Admin'),
      ('u-pilot', '${PILOT_EMAIL}', 'google', 'g-pilot', 'Piloto'),
      ('u-ordinary', '${ORDINARY_EMAIL}', 'google', 'g-ordinary', 'Comum'),
      ('u-outsider', '${OUTSIDER_EMAIL}', 'google', 'g-outsider', 'Outsider');

    INSERT INTO profiles (user_id, nickname) VALUES
      ('u-admin', 'Admin'),
      ('u-pilot', 'Piloto'),
      ('u-ordinary', 'Comum'),
      ('u-outsider', 'Outsider');

    INSERT INTO competitions (
      id, name, slug, external_id, provider, season, status, type, penalty_phases, visibility
    ) VALUES
      (
        '${GAUCHO_ID}',
        'Campeonato Gaúcho',
        'campeonato-gaucho-2026',
        'bra.camp.gaucho',
        'espn',
        '2026',
        'ongoing',
        'cup',
        '[]',
        'public'
      ),
      (
        '${BSA_ID}',
        'Campeonato Brasileiro Série A',
        'campeonato-brasileiro-serie-a-2026-join',
        'BSA',
        'football-data',
        '2026',
        'ongoing',
        'league',
        '[]',
        'public'
      ),
      (
        '${NULL_EXT_ID}',
        'Competição Sem Código',
        'comp-sem-codigo-2026',
        NULL,
        NULL,
        '2026',
        'ongoing',
        'cup',
        '[]',
        'public'
      ),
      (
        '${PILOT_CUP_ID}',
        'Copa Piloto',
        'copa-piloto-2026',
        'bra.copa_piloto',
        'espn',
        '2026',
        'ongoing',
        'cup',
        '[]',
        'pilot'
      );

    INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code) VALUES
      ('g-gaucho', 'Grupo Gaúcho', '${GAUCHO_ID}', 'u-ordinary', 'GAUC-HO01'),
      ('g-bsa', 'Grupo BSA', '${BSA_ID}', 'u-ordinary', 'BSA0-0001'),
      ('g-null', 'Grupo Sem Código', '${NULL_EXT_ID}', 'u-ordinary', 'NULL-0001'),
      ('g-pilot', 'Grupo Piloto', '${PILOT_CUP_ID}', 'u-pilot', 'PILO-T001');

    INSERT INTO group_members (id, group_id, user_id, role) VALUES
      ('gm-gaucho', 'g-gaucho', 'u-ordinary', 'owner'),
      ('gm-bsa', 'g-bsa', 'u-ordinary', 'owner'),
      ('gm-null', 'g-null', 'u-ordinary', 'owner'),
      ('gm-pilot-owner', 'g-pilot', 'u-pilot', 'owner'),
      ('gm-pilot-admin', 'g-pilot', 'u-admin', 'member');
  `)

  const env: Env = {
    DB: db,
    JWT_SECRET,
    ADMIN_EMAIL,
    PILOT_EMAILS: PILOT_EMAIL,
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'csec',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FOOTBALL_API_KEY: 'test-key',
    RESEND_API_KEY: 'test-resend',
  }

  const tokens = {
    admin: await signJwt({ sub: 'u-admin', email: ADMIN_EMAIL, jti: 'j-admin' }, JWT_SECRET, 3600),
    pilot: await signJwt({ sub: 'u-pilot', email: PILOT_EMAIL, jti: 'j-pilot' }, JWT_SECRET, 3600),
    ordinary: await signJwt(
      { sub: 'u-ordinary', email: ORDINARY_EMAIL, jti: 'j-ordinary' },
      JWT_SECRET,
      3600,
    ),
    outsider: await signJwt(
      { sub: 'u-outsider', email: OUTSIDER_EMAIL, jti: 'j-outsider' },
      JWT_SECRET,
      3600,
    ),
  }

  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext

  function request(path: string, user: keyof typeof tokens, method = 'GET') {
    return worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method,
        headers: {
          Cookie: `session=${tokens[user]}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.40',
        },
      }),
      env,
      ctx,
    )
  }

  return { sqlite, request }
}

type GroupPayload = {
  id: string
  competition_id: string
  competition_name: string | null
  competition_code: string | null
}

describe('groups competition_code JOIN (HTTP + SQLite)', () => {
  it('returns competitions.external_id as competition_code on list and detail', async () => {
    const { request } = await fixture()

    const listRes = await request('/groups', 'ordinary')
    expect(listRes.status).toBe(200)
    const listBody = (await listRes.json()) as { groups: GroupPayload[] }
    const byId = Object.fromEntries(listBody.groups.map((g) => [g.id, g]))

    expect(byId['g-gaucho']?.competition_code).toBe('bra.camp.gaucho')
    expect(byId['g-gaucho']?.competition_code).not.toBe(GAUCHO_ID)
    expect(byId['g-gaucho']?.competition_code).not.toBe('Campeonato Gaúcho')
    expect(byId['g-gaucho']?.competition_id).toBe(GAUCHO_ID)

    expect(byId['g-bsa']?.competition_code).toBe('BSA')
    expect(byId['g-bsa']?.competition_code).not.toBe(BSA_ID)
    expect(byId['g-bsa']?.competition_code).not.toBe('Campeonato Brasileiro Série A')

    expect(byId['g-null']?.competition_code).toBeNull()
    expect(byId['g-null']?.competition_id).toBe(NULL_EXT_ID)

    // Pilot cup is hidden from ordinary list.
    expect(byId['g-pilot']).toBeUndefined()

    for (const groupId of ['g-gaucho', 'g-bsa', 'g-null'] as const) {
      const detailRes = await request(`/groups/${groupId}`, 'ordinary')
      expect(detailRes.status).toBe(200)
      const detailBody = (await detailRes.json()) as { group: GroupPayload }
      expect(detailBody.group.competition_code).toBe(byId[groupId]!.competition_code)
      expect(detailBody.group.competition_id).toBe(byId[groupId]!.competition_id)
      expect(detailBody.group.competition_code).not.toBe(detailBody.group.competition_id)
      if (detailBody.group.competition_name != null) {
        expect(detailBody.group.competition_code).not.toBe(detailBody.group.competition_name)
      }
    }
  })

  it('denies outsider detail and keeps pilot list gated', async () => {
    const { request } = await fixture()

    expect((await request('/groups/g-gaucho', 'outsider')).status).toBe(404)

    const ordinaryList = (await (await request('/groups', 'ordinary')).json()) as {
      groups: Array<{ id: string }>
    }
    expect(ordinaryList.groups.map((g) => g.id)).not.toContain('g-pilot')

    const pilotList = (await (await request('/groups', 'pilot')).json()) as {
      groups: GroupPayload[]
    }
    const pilotGroup = pilotList.groups.find((g) => g.id === 'g-pilot')
    expect(pilotGroup?.competition_code).toBe('bra.copa_piloto')
    expect(pilotGroup?.competition_code).not.toBe(PILOT_CUP_ID)

    const pilotDetail = (await (await request('/groups/g-pilot', 'pilot')).json()) as {
      group: GroupPayload
    }
    expect(pilotDetail.group.competition_code).toBe('bra.copa_piloto')

    const adminList = (await (await request('/groups', 'admin')).json()) as {
      groups: GroupPayload[]
    }
    expect(adminList.groups.find((g) => g.id === 'g-pilot')?.competition_code).toBe(
      'bra.copa_piloto',
    )
  })
})

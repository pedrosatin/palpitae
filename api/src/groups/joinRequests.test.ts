/// <reference types="node" />
/**
 * Pedido de entrada pelo link público: criação, listagem, aprovação, recusa e
 * limites (dono, membro, visitante, banido, cheio, repetido, diário, link off,
 * código trocado).
 */
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import { hashUserId } from '../observability'
import { createSqliteD1 } from '../testing/sqliteD1'
import type { Env } from '../types'
import {
  JOIN_REQUEST_ALREADY_PENDING,
  JOIN_REQUEST_APPROVE_MEMBERSHIP_CAP,
  JOIN_REQUEST_COOLDOWN,
  JOIN_REQUEST_DAILY_LIMIT,
  JOIN_REQUEST_GROUP_FULL,
  JOIN_REQUEST_GROUP_PENDING_CAP,
  JOIN_REQUEST_OWNER_ONLY,
  JOIN_REQUEST_REFUSED,
  JOIN_REQUESTS_DISABLED,
  JOIN_REQUESTS_PER_USER_PER_DAY,
  JOIN_REQUEST_REJECT_COOLDOWN_DAYS,
} from './joinRequests'
import { MAX_ACTIVE_MEMBERSHIPS } from './groupCaps'

const JWT_SECRET = 'test-join-requests'
const PUBLIC_ID = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const INVITE = 'ABCD-EFGH'

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

async function fixture(opts: { maxMembers?: number; joinRequestsEnabled?: number } = {}) {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  const maxMembers = opts.maxMembers ?? 50
  const joinEnabled = opts.joinRequestsEnabled ?? 1
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id,created_at,user_name) VALUES
      ('owner','owner@example.com','google','1',datetime('now','-30 days'),'Dono'),
      ('member','member@example.com','google','2',datetime('now','-20 days'),'Membro'),
      ('visitor','visitor@example.com','google','3',datetime('now','-10 days'),'Visitante'),
      ('banned','banned@example.com','google','4',datetime('now','-10 days'),'Banido'),
      ('other','other@example.com','google','5',datetime('now','-5 days'),'Outro');
    INSERT INTO profiles (user_id,nickname) VALUES
      ('owner','Dono'), ('member','Membro'), ('visitor','Visitante'),
      ('banned','Banido'), ('other','Outro');
    INSERT INTO competitions (id,name,slug,status,penalty_phases,visibility)
      VALUES ('competition','Brasileirão','brasileirao','ongoing','[]','public');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,public_id,max_members,join_requests_enabled)
      VALUES ('group','Bolão da Firma','competition','owner','${INVITE}','${PUBLIC_ID}',${maxMembers},${joinEnabled});
    INSERT INTO group_members (id,group_id,user_id,role) VALUES
      ('gm-owner','group','owner','owner'),
      ('gm-member','group','member','member');
    INSERT INTO group_bans (group_id,user_id) VALUES ('group','banned');
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

  async function request(
    user: string | null,
    path: string,
    method = 'GET',
    body?: unknown,
  ) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '192.0.2.10',
    }
    if (user) {
      const token = await signJwt(
        { sub: user, email: `${user}@example.com`, jti: crypto.randomUUID() },
        JWT_SECRET,
        3600,
      )
      headers.Cookie = `session=${token}`
    }
    return worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      ctx,
    )
  }

  const events = (index: string) =>
    writeDataPoint.mock.calls
      .map(([point]) => point as { indexes: string[]; blobs: string[] })
      .filter((point) => point.indexes[0] === index)

  return { sqlite, db, request, events }
}

describe('GET /public/groups/:publicId', () => {
  it('mostra só nome, campeonato e membros, sem código nem nomes', async () => {
    const { request } = await fixture()
    const res = await request(null, `/public/groups/${PUBLIC_ID}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      group: Record<string, unknown>
    }
    expect(body.group).toEqual({
      group_name: 'Bolão da Firma',
      competition_name: 'Brasileirão',
      member_count: 2,
      join_requests_enabled: true,
    })
    expect(JSON.stringify(body)).not.toMatch(/ABCD-EFGH|invite|Dono|Membro|owner@/i)
  })

  it('404 para id inválido ou inexistente', async () => {
    const { request } = await fixture()
    expect((await request(null, '/public/groups/nao-e-hex')).status).toBe(404)
    expect((await request(null, `/public/groups/${'b'.repeat(32)}`)).status).toBe(404)
  })
})

describe('POST /groups/join-requests', () => {
  it('exige conta', async () => {
    const { request } = await fixture()
    const res = await request(null, '/groups/join-requests', 'POST', { public_id: PUBLIC_ID })
    expect(res.status).toBe(401)
  })

  it('visitante cria pedido e dispara join_request', async () => {
    const { request, events } = await fixture()
    const res = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { request: { status: string } }
    expect(body.request.status).toBe('pending')
    const logged = events('join_request')
    expect(logged).toHaveLength(1)
    expect(logged[0]!.blobs).toEqual([
      'join_request',
      'group',
      await hashUserId('visitor'),
    ])
  })

  it('membro não pede de novo', async () => {
    const { request } = await fixture()
    const res = await request('member', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(res.status).toBe(409)
  })

  it('banido recebe recusa genérica', async () => {
    const { request } = await fixture()
    const res = await request('banned', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe(JOIN_REQUEST_REFUSED)
    expect(body.error.toLowerCase()).not.toMatch(/ban|revogad/)
  })

  it('grupo cheio recusa', async () => {
    const { request } = await fixture({ maxMembers: 2 })
    const res = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe(JOIN_REQUEST_GROUP_FULL)
  })

  it('pedido repetido pendente', async () => {
    const { request } = await fixture()
    await request('visitor', '/groups/join-requests', 'POST', { public_id: PUBLIC_ID })
    const res = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe(JOIN_REQUEST_ALREADY_PENDING)
  })

  it('limite diário por usuário', async () => {
    const { sqlite, request } = await fixture()
    for (let i = 0; i < JOIN_REQUESTS_PER_USER_PER_DAY; i++) {
      const gid = `g${i}`
      const pid = i.toString(16).padStart(32, '0')
      sqlite.exec(`
        INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,public_id)
          VALUES ('${gid}','G${i}','competition','owner','INV${i}','${pid}');
        INSERT INTO group_members (id,group_id,user_id,role)
          VALUES ('gm-${gid}','${gid}','owner','owner');
      `)
      const res = await request('visitor', '/groups/join-requests', 'POST', {
        public_id: pid,
      })
      expect(res.status).toBe(201)
    }
    const res = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(res.status).toBe(429)
    expect(((await res.json()) as { error: string }).error).toBe(JOIN_REQUEST_DAILY_LIMIT)
  })

  it('link desligado', async () => {
    const { request } = await fixture({ joinRequestsEnabled: 0 })
    const res = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe(JOIN_REQUESTS_DISABLED)
  })

  it('trocar o código de convite não invalida o link', async () => {
    const { request, sqlite } = await fixture()
    sqlite.exec(`UPDATE groups SET invite_code = 'ZZZZ-YYYY' WHERE id = 'group'`)
    const preview = await request(null, `/public/groups/${PUBLIC_ID}`)
    expect(preview.status).toBe(200)
    const res = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(res.status).toBe(201)
  })
})

describe('dono: listar, aprovar e recusar', () => {
  it('só o dono lista (membro e visitante 403/404)', async () => {
    const { request } = await fixture()
    await request('visitor', '/groups/join-requests', 'POST', { public_id: PUBLIC_ID })

    const owner = await request('owner', '/groups/group/join-requests')
    expect(owner.status).toBe(200)
    const listed = (await owner.json()) as { requests: Array<{ user_id: string }> }
    expect(listed.requests).toHaveLength(1)
    expect(listed.requests[0]!.user_id).toBe('visitor')

    expect((await request('member', '/groups/group/join-requests')).status).toBe(403)
    // Quem não é dono (mesmo fora do grupo) recebe 403: a rota confere o sub do dono.
    expect((await request('other', '/groups/group/join-requests')).status).toBe(403)
  })

  it('aprova e dispara group_joined com entry_method request', async () => {
    const { request, events, db } = await fixture()
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    const { request: req } = (await created.json()) as { request: { id: string } }

    const res = await request(
      'owner',
      `/groups/group/join-requests/${req.id}/approve`,
      'POST',
    )
    expect(res.status).toBe(200)

    const member = await db
      .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
      .bind('group', 'visitor')
      .first<{ role: string }>()
    expect(member?.role).toBe('member')

    const joined = events('group_joined')
    expect(joined.some((e) => e.blobs[3] === 'request')).toBe(true)
  })

  it('membro não aprova (checa sub do dono)', async () => {
    const { request } = await fixture()
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    const { request: req } = (await created.json()) as { request: { id: string } }
    const res = await request(
      'member',
      `/groups/group/join-requests/${req.id}/approve`,
      'POST',
    )
    expect(res.status).toBe(403)
  })

  it('recusa não bane e aplica cooldown', async () => {
    const { request, db, sqlite } = await fixture()
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    const { request: req } = (await created.json()) as { request: { id: string } }

    const rejected = await request(
      'owner',
      `/groups/group/join-requests/${req.id}/reject`,
      'POST',
    )
    expect(rejected.status).toBe(200)

    const ban = await db
      .prepare('SELECT user_id FROM group_bans WHERE group_id = ? AND user_id = ?')
      .bind('group', 'visitor')
      .first()
    expect(ban).toBeNull()

    const again = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(again.status).toBe(429)
    expect(((await again.json()) as { error: string }).error).toBe(JOIN_REQUEST_COOLDOWN)

    sqlite.exec(`
      UPDATE group_join_requests
      SET decided_at = datetime('now', '-${JOIN_REQUEST_REJECT_COOLDOWN_DAYS + 1} days')
      WHERE id = '${req.id}'
    `)
    const afterCooldown = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(afterCooldown.status).toBe(201)
  })

  it('GET /groups/:id inclui public_id e contador só para o dono', async () => {
    const { request } = await fixture()
    await request('visitor', '/groups/join-requests', 'POST', { public_id: PUBLIC_ID })

    const owner = await request('owner', '/groups/group')
    const ownerBody = (await owner.json()) as {
      group: {
        public_id: string
        pending_join_request_count: number
        join_requests_enabled: boolean
      }
    }
    expect(ownerBody.group.public_id).toBe(PUBLIC_ID)
    expect(ownerBody.group.pending_join_request_count).toBe(1)
    expect(ownerBody.group.join_requests_enabled).toBe(true)

    const member = await request('member', '/groups/group')
    const memberBody = (await member.json()) as {
      group: { public_id: string; pending_join_request_count: number; invite_code: string | null }
    }
    expect(memberBody.group.public_id).toBe(PUBLIC_ID)
    expect(memberBody.group.pending_join_request_count).toBe(0)
    expect(memberBody.group.invite_code).toBeNull()
  })

  it('dono desliga pedidos pelo PATCH', async () => {
    const { request } = await fixture()
    const res = await request('owner', '/groups/group', 'PATCH', {
      join_requests_enabled: false,
    })
    expect(res.status).toBe(200)
    const preview = await request(null, `/public/groups/${PUBLIC_ID}`)
    const body = (await preview.json()) as { group: { join_requests_enabled: boolean } }
    expect(body.group.join_requests_enabled).toBe(false)
  })

  it('PATCH só de join_requests_enabled não grava group_renamed', async () => {
    const { request, events } = await fixture()
    const res = await request('owner', '/groups/group', 'PATCH', {
      join_requests_enabled: false,
    })
    expect(res.status).toBe(200)
    expect(events('group_renamed')).toHaveLength(0)
  })
})

describe('autorização e corrida', () => {
  const OTHER_PUBLIC = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

  async function otherGroupFixture() {
    const ctx = await fixture()
    ctx.sqlite.exec(`
      INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,public_id,max_members,join_requests_enabled)
        VALUES ('group-b','Outro','competition','other','OTRO-OOOO','${OTHER_PUBLIC}',50,1);
      INSERT INTO group_members (id,group_id,user_id,role)
        VALUES ('gm-other-b','group-b','other','owner');
    `)
    return ctx
  }

  it('IDOR: dono do grupo A não aprova pedido do grupo B pelo id', async () => {
    const { request } = await otherGroupFixture()
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: OTHER_PUBLIC,
    })
    const { request: req } = (await created.json()) as { request: { id: string } }

    const res = await request(
      'owner',
      `/groups/group/join-requests/${req.id}/approve`,
      'POST',
    )
    expect(res.status).toBe(404)
  })

  it('IDOR: dono do grupo A não recusa pedido do grupo B pelo id', async () => {
    const { request } = await otherGroupFixture()
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: OTHER_PUBLIC,
    })
    const { request: req } = (await created.json()) as { request: { id: string } }

    const res = await request(
      'owner',
      `/groups/group/join-requests/${req.id}/reject`,
      'POST',
    )
    expect(res.status).toBe(404)
  })

  it('recusa por membro comum → 403', async () => {
    const { request } = await fixture()
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    const { request: req } = (await created.json()) as { request: { id: string } }
    const res = await request(
      'member',
      `/groups/group/join-requests/${req.id}/reject`,
      'POST',
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe(JOIN_REQUEST_OWNER_ONLY)
  })

  it('PATCH de join_requests_enabled por não dono → 403', async () => {
    const { request } = await fixture()
    const res = await request('member', '/groups/group', 'PATCH', {
      join_requests_enabled: false,
    })
    expect(res.status).toBe(403)
  })

  it('aprovação com grupo cheio → 409 e pedido permanece pending', async () => {
    const { request, sqlite, db } = await fixture({ maxMembers: 2 })
    // Grupo já tem owner+member (2). Pedido criado antes de encher: libera um slot
    // temporário, cria o pedido, depois reaperta o teto.
    sqlite.exec(`UPDATE groups SET max_members = 3 WHERE id = 'group'`)
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(created.status).toBe(201)
    const { request: req } = (await created.json()) as { request: { id: string } }

    sqlite.exec(`
      INSERT INTO users (id,email,provider,provider_id) VALUES ('filler','f@test.com','google','f');
      INSERT INTO group_members (id,group_id,user_id,role) VALUES ('gm-filler','group','filler','member');
      UPDATE groups SET max_members = 2 WHERE id = 'group';
    `)

    const res = await request(
      'owner',
      `/groups/group/join-requests/${req.id}/approve`,
      'POST',
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe(JOIN_REQUEST_GROUP_FULL)

    const row = await db
      .prepare('SELECT status, decided_by FROM group_join_requests WHERE id = ?')
      .bind(req.id)
      .first<{ status: string; decided_by: string | null }>()
    expect(row).toEqual({ status: 'pending', decided_by: null })
  })

  it('aprovação de banido → 403 e pedido rejected', async () => {
    const { request, sqlite, db } = await fixture()
    // Pedido de quem ainda não estava banido; ban depois do pedido.
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    const { request: req } = (await created.json()) as { request: { id: string } }
    sqlite.exec(`INSERT INTO group_bans (group_id, user_id) VALUES ('group', 'visitor')`)

    const res = await request(
      'owner',
      `/groups/group/join-requests/${req.id}/approve`,
      'POST',
    )
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toBe(JOIN_REQUEST_REFUSED)

    const row = await db
      .prepare('SELECT status FROM group_join_requests WHERE id = ?')
      .bind(req.id)
      .first<{ status: string }>()
    expect(row?.status).toBe('rejected')
  })

  it('corrida aprovar × recusar: só uma decisão vence', async () => {
    const { request, db } = await fixture()
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    const { request: req } = (await created.json()) as { request: { id: string } }

    const [approve, reject] = await Promise.all([
      request('owner', `/groups/group/join-requests/${req.id}/approve`, 'POST'),
      request('owner', `/groups/group/join-requests/${req.id}/reject`, 'POST'),
    ])

    const statuses = [approve.status, reject.status].sort()
    // Uma vence (200); a outra vê o pedido já decidido (404).
    expect(statuses).toEqual([200, 404])

    const row = await db
      .prepare('SELECT status FROM group_join_requests WHERE id = ?')
      .bind(req.id)
      .first<{ status: string }>()
    expect(['approved', 'rejected']).toContain(row?.status)
  })

  it('corrida: segundo approve depois do claim atômico falha', async () => {
    const { request, db } = await fixture()
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    const { request: req } = (await created.json()) as { request: { id: string } }

    const first = await request(
      'owner',
      `/groups/group/join-requests/${req.id}/approve`,
      'POST',
    )
    expect(first.status).toBe(200)

    const second = await request(
      'owner',
      `/groups/group/join-requests/${req.id}/approve`,
      'POST',
    )
    expect(second.status).toBe(404)

    const members = await db
      .prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND user_id = ?')
      .bind('group', 'visitor')
      .first<{ n: number }>()
    expect(members?.n).toBe(1)
  })

  it('limite de pendentes por grupo (max_members)', async () => {
    const { request, sqlite } = await fixture({ maxMembers: 3 })
    // Já há 2 membros; cabem 3 pendentes no máximo (= max_members).
    for (let i = 0; i < 3; i++) {
      const uid = `pend${i}`
      sqlite.exec(`
        INSERT INTO users (id,email,provider,provider_id) VALUES ('${uid}','${uid}@t.com','google','${uid}');
      `)
      const res = await request(uid, '/groups/join-requests', 'POST', { public_id: PUBLIC_ID })
      expect(res.status).toBe(201)
    }
    sqlite.exec(`
      INSERT INTO users (id,email,provider,provider_id) VALUES ('pendx','pendx@t.com','google','pendx');
    `)
    const blocked = await request('pendx', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    expect(blocked.status).toBe(429)
    expect(((await blocked.json()) as { error: string }).error).toBe(JOIN_REQUEST_GROUP_PENDING_CAP)
  })

  it('aprovação no teto de grupos da pessoa: mensagem ao dono e pedido pending', async () => {
    const { request, sqlite, db } = await fixture()
    const created = await request('visitor', '/groups/join-requests', 'POST', {
      public_id: PUBLIC_ID,
    })
    const { request: req } = (await created.json()) as { request: { id: string } }

    // Enche o teto de participações do visitor com outros grupos.
    for (let i = 0; i < MAX_ACTIVE_MEMBERSHIPS; i++) {
      const gid = `cap${i}`
      sqlite.exec(`
        INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code,public_id)
          VALUES ('${gid}','C${i}','competition','owner','CAP${i}','${i.toString(16).padStart(32, '0')}');
        INSERT INTO group_members (id,group_id,user_id,role)
          VALUES ('gm-${gid}-o','${gid}','owner','owner'),
                 ('gm-${gid}-v','${gid}','visitor','member');
      `)
    }

    const res = await request(
      'owner',
      `/groups/group/join-requests/${req.id}/approve`,
      'POST',
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { error: string }).error).toBe(JOIN_REQUEST_APPROVE_MEMBERSHIP_CAP)

    const row = await db
      .prepare('SELECT status FROM group_join_requests WHERE id = ?')
      .bind(req.id)
      .first<{ status: string }>()
    expect(row?.status).toBe('pending')
  })
})

describe('trigger public_id', () => {
  it('INSERT no formato antigo (sem public_id) preenche via trigger', async () => {
    const { sqlite } = await fixture()
    sqlite.exec(`
      INSERT INTO groups (id, name, competition_id, owner_user_id, invite_code)
        VALUES ('legacy', 'Legado', 'competition', 'owner', 'LEGA-CYYY');
    `)
    const row = sqlite
      .prepare("SELECT public_id FROM groups WHERE id = 'legacy'")
      .get() as { public_id: string | null }
    expect(row.public_id).toMatch(/^[a-f0-9]{32}$/)
  })
})

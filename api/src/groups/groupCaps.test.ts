/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { signJwt } from '../auth/jwt'
import type { Env } from '../types'
import { createSqliteD1 } from '../testing/sqliteD1'

// Tetos por usuário pela API inteira, com o SQL de produção no SQLite em memória.
// Os números ficam literais aqui: são a decisão do operador, e o teste precisa
// quebrar se a constante mudar sem querer.
const OWNED_CAP_ERROR = 'Você já tem 20 grupos criados. Exclua um para criar outro.'
const JOIN_CAP_ERROR = 'Você já participa de 50 grupos. Saia de um para entrar em outro.'
const CREATE_MEMBERSHIP_CAP_ERROR = 'Você já participa de 50 grupos. Saia de um para criar outro.'

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
})

/**
 * Segura as gravações em `groups` e `group_members` até que os dois pedidos
 * cheguem a elas. Sem isso, um pedido termina antes de o outro ler o banco e o
 * teste passa até com a contagem feita num SELECT separado. `release` solta a
 * espera quando um pedido termina sem gravar.
 */
function holdWritesUntilBothArrive(db: D1Database) {
  const held = new WeakSet<object>()
  let arrivals = 0
  let release!: () => void
  const bothArrived = new Promise<void>((resolve) => {
    release = resolve
  })
  const arrive = () => {
    if (++arrivals >= 2) release()
    return bothArrived
  }
  const wrapped = {
    ...db,
    prepare(sql: string) {
      const statement = db.prepare(sql)
      if (!/^\s*INSERT INTO (groups|group_members)\b/.test(sql)) return statement
      return {
        ...statement,
        bind(...values: unknown[]) {
          const bound = statement.bind(...values)
          const run = bound.run.bind(bound)
          held.add(bound)
          return Object.assign(bound, {
            async run() {
              await arrive()
              return run()
            },
          })
        },
      }
    },
    async batch(statements: D1PreparedStatement[]) {
      if (statements.some((statement) => held.has(statement))) await arrive()
      return db.batch(statements)
    },
  } as unknown as D1Database
  return { db: wrapped, release }
}

async function fixture() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id) VALUES
      ('ana','ana@example.com','google','1'),
      ('dono','dono@example.com','google','2');
    INSERT INTO competitions (id,name,slug,status,penalty_phases)
      VALUES ('competition','League','test-league','ongoing','[]');
  `)
  const env = {
    DB: db,
    JWT_SECRET: 'test-secret',
    BASE_URL: 'https://api.palpitae.com.br',
    FRONTEND_URL: 'https://palpitae.com.br',
    FRONTEND_WORKER_ZONE: 'palpitae-web.pages.dev',
    FOOTBALL_API_KEY: 'test-key',
  } as Env
  const tokens: Record<string, string> = {}
  for (const id of ['ana', 'dono']) {
    tokens[id] = await signJwt(
      { sub: id, email: `${id}@example.com`, jti: crypto.randomUUID() },
      env.JWT_SECRET,
      3600,
    )
  }
  const ctx = {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as ExecutionContext
  const request = async (path: string, user: string, method: string, body?: unknown) =>
    worker.fetch(
      new Request(`https://api.palpitae.com.br${path}`, {
        method,
        headers: {
          Cookie: `session=${tokens[user]}`,
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '192.0.2.1',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      ctx,
    )

  const insertGroup = sqlite.prepare(
    'INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code) VALUES (?,?,?,?,?)',
  )
  const insertMember = sqlite.prepare(
    'INSERT INTO group_members (id,group_id,user_id,role) VALUES (?,?,?,?)',
  )
  let seeded = 0
  /** Grava `count` grupos de `owner`, cada um com a linha do dono, e devolve os ids. */
  function seedGroups(owner: string, count: number): string[] {
    return Array.from({ length: count }, () => {
      const id = `g${++seeded}`
      insertGroup.run(id, `Grupo ${seeded}`, 'competition', owner, inviteCode(id))
      insertMember.run(`${id}-owner`, id, owner, 'owner')
      return id
    })
  }
  /** Põe `user` como membro comum de cada grupo. */
  function seedMemberships(user: string, groupIds: string[]) {
    for (const id of groupIds) insertMember.run(`${id}-${user}`, id, user, 'member')
  }
  const inviteCode = (groupId: string) => `CONV-${groupId.toUpperCase()}`

  const create = (user = 'ana') =>
    request('/groups', user, 'POST', { name: 'Grupo novo', competition_id: 'competition' })
  const join = (groupId: string, user = 'ana') =>
    request('/groups/join', user, 'POST', { invite_code: inviteCode(groupId) })

  const count = (sql: string) => (sqlite.prepare(sql).get() as { n: number }).n
  /** Grupos não excluídos em que `ana` é a dona. */
  const ownedActive = () =>
    count("SELECT COUNT(*) AS n FROM groups WHERE owner_user_id = 'ana' AND deleted_at IS NULL")
  /** Participações de `ana` em grupos não excluídos. */
  const membershipsActive = () =>
    count(
      `SELECT COUNT(*) AS n FROM group_members gm JOIN groups g ON g.id = gm.group_id
        WHERE gm.user_id = 'ana' AND g.deleted_at IS NULL`,
    )
  const totals = () => ({
    groups: count('SELECT COUNT(*) AS n FROM groups'),
    members: count('SELECT COUNT(*) AS n FROM group_members'),
  })

  /** Dispara os dois pedidos com as gravações seguradas e devolve os status em ordem. */
  async function raceStatuses(first: () => Promise<Response>, second: () => Promise<Response>) {
    const gate = holdWritesUntilBothArrive(db)
    env.DB = gate.db
    const responses = await Promise.all([first(), second()].map((res) => res.finally(gate.release)))
    return responses.map((res) => res.status).sort()
  }

  return {
    sqlite,
    request,
    raceStatuses,
    seedGroups,
    seedMemberships,
    create,
    join,
    ownedActive,
    membershipsActive,
    totals,
  }
}

describe('teto de 20 grupos criados por usuário', () => {
  it('aceita o 20º grupo e recusa o 21º com 409 e mensagem em português', async () => {
    const { create, seedGroups, ownedActive, totals } = await fixture()
    seedGroups('ana', 19)

    expect((await create()).status).toBe(201)
    expect(ownedActive()).toBe(20)

    const before = totals()
    const refused = await create()
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: OWNED_CAP_ERROR })
    // A recusa não deixa grupo nem participação pela metade.
    expect(totals()).toEqual(before)
  })

  it('não conta grupo excluído: excluir um libera a vaga', async () => {
    const { create, request, seedGroups, ownedActive } = await fixture()
    const [first] = seedGroups('ana', 20)
    expect((await create()).status).toBe(409)

    expect((await request(`/groups/${first}`, 'ana', 'DELETE')).status).toBe(200)

    expect((await create()).status).toBe(201)
    expect(ownedActive()).toBe(20)
  })

  it('não conta grupo criado por outra pessoa em que o usuário só participa', async () => {
    const { create, seedGroups, seedMemberships, ownedActive } = await fixture()
    seedGroups('ana', 19)
    seedMemberships('ana', seedGroups('dono', 5))

    expect((await create()).status).toBe(201)
    expect(ownedActive()).toBe(20)
  })

  it('de dois pedidos simultâneos no limite, aceita só um', async () => {
    const { create, raceStatuses, seedGroups, ownedActive } = await fixture()
    seedGroups('ana', 19)

    expect(await raceStatuses(create, create)).toEqual([201, 409])
    expect(ownedActive()).toBe(20)
  })
})

describe('teto de 50 participações por usuário', () => {
  it('aceita a 50ª participação e recusa a 51ª com 409 e mensagem em português', async () => {
    const { join, seedGroups, seedMemberships, membershipsActive } = await fixture()
    const groups = seedGroups('dono', 51)
    seedMemberships('ana', groups.slice(0, 49))

    expect((await join(groups[49])).status).toBe(200)
    expect(membershipsActive()).toBe(50)

    const refused = await join(groups[50])
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: JOIN_CAP_ERROR })
    expect(membershipsActive()).toBe(50)
  })

  it('não conta participação removida: sair de um grupo libera a vaga', async () => {
    const { join, request, seedGroups, seedMemberships, membershipsActive } = await fixture()
    const groups = seedGroups('dono', 51)
    seedMemberships('ana', groups.slice(0, 50))
    expect((await join(groups[50])).status).toBe(409)

    expect((await request(`/groups/${groups[0]}/members/ana`, 'ana', 'DELETE')).status).toBe(200)

    expect((await join(groups[50])).status).toBe(200)
    expect(membershipsActive()).toBe(50)
  })

  it('não conta participação em grupo excluído pelo dono', async () => {
    const { join, request, seedGroups, seedMemberships, membershipsActive } = await fixture()
    const groups = seedGroups('dono', 51)
    seedMemberships('ana', groups.slice(0, 50))
    expect((await join(groups[50])).status).toBe(409)

    expect((await request(`/groups/${groups[0]}`, 'dono', 'DELETE')).status).toBe(200)

    expect((await join(groups[50])).status).toBe(200)
    expect(membershipsActive()).toBe(50)
  })

  it('conta os grupos que o próprio usuário criou', async () => {
    const { join, seedGroups, seedMemberships, membershipsActive } = await fixture()
    seedGroups('ana', 10)
    const groups = seedGroups('dono', 41)
    seedMemberships('ana', groups.slice(0, 40))

    const refused = await join(groups[40])

    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: JOIN_CAP_ERROR })
    expect(membershipsActive()).toBe(50)
  })

  it('de duas entradas simultâneas no limite, aceita só uma', async () => {
    const { join, raceStatuses, seedGroups, seedMemberships, membershipsActive } = await fixture()
    const groups = seedGroups('dono', 51)
    seedMemberships('ana', groups.slice(0, 49))

    const statuses = await raceStatuses(
      () => join(groups[49]),
      () => join(groups[50]),
    )

    expect(statuses).toEqual([200, 409])
    expect(membershipsActive()).toBe(50)
  })

  it('criar um grupo também ocupa uma participação e respeita o teto', async () => {
    const { create, seedGroups, seedMemberships, membershipsActive, totals } = await fixture()
    seedMemberships('ana', seedGroups('dono', 49))

    expect((await create()).status).toBe(201)
    expect(membershipsActive()).toBe(50)

    const before = totals()
    const refused = await create()
    expect(refused.status).toBe(409)
    expect(await refused.json()).toEqual({ error: CREATE_MEMBERSHIP_CAP_ERROR })
    expect(totals()).toEqual(before)
  })
})

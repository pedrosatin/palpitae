/// <reference types="node" />
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'
import {
  countInviteJoinsInD1,
  parseEntryMethod,
  readRecentSignupFlag,
  summarizeInviteEvents,
} from './inviteFunnel'

const handles: DatabaseSync[] = []
afterEach(() => {
  for (const sqlite of handles.splice(0)) sqlite.close()
  vi.restoreAllMocks()
})

function database() {
  const { sqlite, db } = createSqliteD1()
  handles.push(sqlite)
  sqlite.exec(`
    INSERT INTO users (id,email,provider,provider_id,created_at) VALUES
      ('owner','o@example.com','google','1',datetime('now','-90 days')),
      ('new','n@example.com','google','2',datetime('now','-3 days')),
      ('old','e@example.com','google','3',datetime('now','-90 days')),
      ('gone','g@example.com','google','4',datetime('now','-90 days'));
    INSERT INTO competitions (id,name,slug,status,penalty_phases)
      VALUES ('c','League','league','ongoing','[]');
    INSERT INTO groups (id,name,competition_id,owner_user_id,invite_code)
      VALUES ('g','Grupo','c','owner','ABCD-EFGH');
    INSERT INTO group_members (id,group_id,user_id,role,joined_at) VALUES
      ('m-owner','g','owner','owner',datetime('now','-1 days')),
      ('m-new','g','new','member',datetime('now','-3 days','+30 minutes')),
      ('m-old','g','old','member',datetime('now','-2 days')),
      ('m-gone','g','gone','member',datetime('now','-45 days'));
  `)
  return { sqlite, db }
}

describe('parseEntryMethod', () => {
  it('aceita só os valores da lista', () => {
    expect(parseEntryMethod('convite_link')).toBe('convite_link')
    expect(parseEntryMethod('convite_antigo')).toBe('convite_antigo')
    expect(parseEntryMethod('codigo')).toBe('codigo')
    expect(parseEntryMethod('CODIGO')).toBe('')
    expect(parseEntryMethod(undefined)).toBe('')
    expect(parseEntryMethod(1)).toBe('')
  })
})

describe('readRecentSignupFlag', () => {
  it('compara a data da entrada com a da conta', async () => {
    const { db } = database()
    expect(await readRecentSignupFlag(db, 'm-new')).toBe('1')
    expect(await readRecentSignupFlag(db, 'm-old')).toBe('0')
  })

  it('aceita created_at em ISO, formato que o login grava', async () => {
    const { sqlite, db } = database()
    sqlite.exec(
      `UPDATE users SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', datetime('now','-2 days')) WHERE id = 'old'`,
    )
    sqlite.exec(
      `UPDATE group_members SET joined_at = datetime('now','-2 days','+10 minutes') WHERE id = 'm-old'`,
    )
    expect(await readRecentSignupFlag(db, 'm-old')).toBe('1')
  })

  it('fica vazia sem o membro ou com o D1 fora do ar', async () => {
    const { db } = database()
    expect(await readRecentSignupFlag(db, 'não-existe')).toBe('')

    vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = {
      prepare: () => {
        throw new Error('d1 fora do ar')
      },
    } as unknown as D1Database
    expect(await readRecentSignupFlag(broken, 'm-new')).toBe('')
  })
})

describe('countInviteJoinsInD1', () => {
  it('conta só convidados da janela e separa novos de quem já tinha conta', async () => {
    const { db } = database()
    expect(await countInviteJoinsInD1(db, 30)).toEqual({
      joins: 2,
      newMembers: 1,
      existingMembers: 1,
    })
    expect(await countInviteJoinsInD1(db, 90)).toEqual({
      joins: 3,
      newMembers: 1,
      existingMembers: 2,
    })
  })

  it('devolve zero sem entradas no período', async () => {
    const { db } = database()
    expect(await countInviteJoinsInD1(db, 1)).toEqual({
      joins: 0,
      newMembers: 0,
      existingMembers: 0,
    })
  })
})

describe('summarizeInviteEvents', () => {
  it('soma aberturas, métodos e flags, separando linhas sem classificação', () => {
    const totals = summarizeInviteEvents([
      { event_type: 'invite_opened', method: '', recent_signup: '', events: '9' },
      { event_type: 'group_joined', method: 'convite_link', recent_signup: '1', events: 3 },
      { event_type: 'group_joined', method: 'convite_link', recent_signup: '0', events: 2 },
      { event_type: 'group_joined', method: 'codigo', recent_signup: '0', events: 4 },
      { event_type: 'group_joined', method: '', recent_signup: '', events: 5 },
    ])

    expect(totals).toEqual({
      opens: 9,
      joins: 14,
      joinsByMethod: { convite_link: 5, convite_antigo: 0, codigo: 4, unknown: 5 },
      newMembers: 3,
      existingMembers: 6,
      unclassifiedJoins: 5,
    })
  })

  it('não deixa texto de blob virar chave e ignora contagem inválida', () => {
    const totals = summarizeInviteEvents([
      { event_type: 'group_joined', method: 'nome-do-grupo', recent_signup: '1', events: 2 },
      { event_type: 'invite_opened', events: 'x' },
      { event_type: 'outro', events: 7 },
    ])

    expect(totals.joinsByMethod).toEqual({ convite_link: 0, convite_antigo: 0, codigo: 0, unknown: 2 })
    expect(totals.opens).toBe(0)
    expect(totals.joins).toBe(2)
  })
})

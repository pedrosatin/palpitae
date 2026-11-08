import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DraftEntries, PenaltyWinner } from './predictionDrafts'
import {
  DRAFT_TTL_MS,
  clearStoredDrafts,
  draftStorageKey,
  parseDrafts,
  readStoredDrafts,
  serializeDrafts,
  writeStoredDrafts,
} from './predictionDraftStorage'

const now = 1_700_000_000_000
const DAY = 24 * 60 * 60 * 1000

function entries(
  scores: Record<string, { home: string; away: string; at?: number }>,
  penalties: Record<string, { winner: PenaltyWinner; at?: number }> = {},
): DraftEntries {
  return {
    drafts: new Map(
      Object.entries(scores).map(([id, { home, away, at = now }]) => [
        id,
        { value: { home, away }, base: '1:0:null', at },
      ]),
    ),
    penaltyDrafts: new Map(
      Object.entries(penalties).map(([id, { winner, at = now }]) => [
        id,
        { value: winner, base: 'sem palpite', at },
      ]),
    ),
  }
}

describe('serializeDrafts / parseDrafts', () => {
  it('serializar e ler de volta preserva placar e pênalti, inclusive pênalti nulo', () => {
    const raw = serializeDrafts(
      entries({ m1: { home: '2', away: '1' } }, { m2: { winner: 'home' }, m3: { winner: null } }),
    )
    const parsed = parseDrafts(raw, now + 1000)
    expect([...parsed.drafts]).toEqual([
      ['m1', { value: { home: '2', away: '1' }, base: '1:0:null', at: now }],
    ])
    expect([...parsed.penaltyDrafts]).toEqual([
      ['m2', { value: 'home', base: 'sem palpite', at: now }],
      ['m3', { value: null, base: 'sem palpite', at: now }],
    ])
  })

  it('não serializa rascunho vazio', () => {
    expect(serializeDrafts({ drafts: new Map(), penaltyDrafts: new Map() })).toBeNull()
  })

  it('descarta só a entrada digitada há mais de 7 dias', () => {
    const raw = serializeDrafts(
      entries(
        {
          old: { home: '2', away: '1', at: now - DRAFT_TTL_MS - 1 },
          recent: { home: '0', away: '0' },
        },
        { oldPenalty: { winner: 'away', at: now - DRAFT_TTL_MS - 1 } },
      ),
    )
    const parsed = parseDrafts(raw, now)
    expect([...parsed.drafts.keys()]).toEqual(['recent'])
    expect(parsed.penaltyDrafts.size).toBe(0)
  })

  it('ignora JSON inválido e entradas malformadas', () => {
    expect(parseDrafts('{', now).drafts.size).toBe(0)
    expect(parseDrafts('null', now).drafts.size).toBe(0)
    const parsed = parseDrafts(
      JSON.stringify({
        scores: {
          ok: { value: { home: '1', away: '0' }, base: 'sem palpite', at: now },
          bad: { value: { home: 'x', away: '0' }, base: 'sem palpite', at: now },
          num: { value: { home: 1, away: 0 }, base: 'sem palpite', at: now },
          noBase: { value: { home: '1', away: '0' }, at: now },
          noAt: { value: { home: '1', away: '0' }, base: 'sem palpite' },
          // Formato sem base nem hora por entrada.
          flat: { home: '1', away: '0' },
        },
        penalties: {
          ok: { value: 'away', base: 'sem palpite', at: now },
          bad: { value: 'draw', base: 'sem palpite', at: now },
          flat: 'home',
        },
      }),
      now,
    )
    expect([...parsed.drafts.keys()]).toEqual(['ok'])
    expect([...parsed.penaltyDrafts.keys()]).toEqual(['ok'])
  })
})

describe('readStoredDrafts / writeStoredDrafts', () => {
  const key = draftStorageKey('u1', 'g1')

  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('chave separa usuário e grupo', () => {
    expect(draftStorageKey('u1', 'g1')).not.toBe(draftStorageKey('u2', 'g1'))
    expect(draftStorageKey('u1', 'g1')).not.toBe(draftStorageKey('u1', 'g2'))
  })

  it('grava, lê e remove a chave quando não sobra rascunho', () => {
    writeStoredDrafts(key, entries({ m1: { home: '2', away: '1' } }))
    expect(readStoredDrafts(key, now).drafts.get('m1')?.value).toEqual({ home: '2', away: '1' })

    writeStoredDrafts(key, { drafts: new Map(), penaltyDrafts: new Map() })
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('regravar não renova o prazo da entrada', () => {
    writeStoredDrafts(key, entries({ m1: { home: '2', away: '1', at: now - 6 * DAY } }))
    // Carregar e gravar de novo no dia seguinte mantém a hora da digitação.
    writeStoredDrafts(key, readStoredDrafts(key, now + DAY))
    expect(readStoredDrafts(key, now + DAY).drafts.get('m1')?.at).toBe(now - 6 * DAY)
    expect(readStoredDrafts(key, now + 2 * DAY).drafts.size).toBe(0)
  })

  it('storage indisponível não lança', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readStoredDrafts(key).drafts.size).toBe(0)
    expect(() => writeStoredDrafts(key, entries({ m1: { home: '2', away: '1' } }))).not.toThrow()
    expect(() => clearStoredDrafts()).not.toThrow()
  })
})

describe('clearStoredDrafts', () => {
  beforeEach(() => localStorage.clear())

  it('apaga os rascunhos de todos os usuários e grupos e mantém as outras chaves', () => {
    localStorage.setItem(draftStorageKey('u1', 'g1'), '{}')
    localStorage.setItem(draftStorageKey('u2', 'g2'), '{}')
    localStorage.setItem('palpitae:analytics-consent', 'granted')

    clearStoredDrafts()

    expect(localStorage.getItem(draftStorageKey('u1', 'g1'))).toBeNull()
    expect(localStorage.getItem(draftStorageKey('u2', 'g2'))).toBeNull()
    expect(localStorage.getItem('palpitae:analytics-consent')).toBe('granted')
  })
})

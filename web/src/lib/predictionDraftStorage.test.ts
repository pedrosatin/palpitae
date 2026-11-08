import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DRAFT_TTL_MS,
  draftStorageKey,
  parseDrafts,
  readStoredDrafts,
  serializeDrafts,
  writeStoredDrafts,
} from './predictionDraftStorage'

describe('serializeDrafts / parseDrafts', () => {
  const now = 1_700_000_000_000

  it('ida e volta preservam placar e pênalti, inclusive pênalti apagado (null)', () => {
    const raw = serializeDrafts(
      {
        drafts: new Map([['m1', { home: '2', away: '1' }]]),
        penaltyDrafts: new Map<string, 'home' | 'away' | null>([
          ['m2', 'home'],
          ['m3', null],
        ]),
      },
      now,
    )
    const parsed = parseDrafts(raw, now + 1000)
    expect([...parsed.drafts]).toEqual([['m1', { home: '2', away: '1' }]])
    expect([...parsed.penaltyDrafts]).toEqual([
      ['m2', 'home'],
      ['m3', null],
    ])
  })

  it('não serializa rascunho vazio', () => {
    expect(serializeDrafts({ drafts: new Map(), penaltyDrafts: new Map() }, now)).toBeNull()
  })

  it('descarta rascunho vencido', () => {
    const raw = serializeDrafts(
      { drafts: new Map([['m1', { home: '2', away: '1' }]]), penaltyDrafts: new Map() },
      now,
    )
    expect(parseDrafts(raw, now + DRAFT_TTL_MS + 1).drafts.size).toBe(0)
  })

  it('ignora JSON inválido e entradas malformadas', () => {
    expect(parseDrafts('{', now).drafts.size).toBe(0)
    expect(parseDrafts('null', now).drafts.size).toBe(0)
    const parsed = parseDrafts(
      JSON.stringify({
        savedAt: now,
        scores: { ok: { home: '1', away: '0' }, bad: { home: 'x', away: '0' }, num: { home: 1, away: 0 } },
        penalties: { ok: 'away', bad: 'draw' },
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
    writeStoredDrafts(key, {
      drafts: new Map([['m1', { home: '2', away: '1' }]]),
      penaltyDrafts: new Map(),
    })
    expect(readStoredDrafts(key).drafts.get('m1')).toEqual({ home: '2', away: '1' })

    writeStoredDrafts(key, { drafts: new Map(), penaltyDrafts: new Map() })
    expect(localStorage.getItem(key)).toBeNull()
  })

  it('storage indisponível não lança', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(readStoredDrafts(key).drafts.size).toBe(0)
    expect(() =>
      writeStoredDrafts(key, {
        drafts: new Map([['m1', { home: '2', away: '1' }]]),
        penaltyDrafts: new Map(),
      }),
    ).not.toThrow()
  })
})

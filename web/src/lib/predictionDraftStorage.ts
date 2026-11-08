/**
 * Guarda no navegador os rascunhos de palpite ainda não salvos, por usuário e
 * grupo, para que recarregar a aba Palpitar não apague o que foi digitado.
 *
 * Quem decide o que vale guardar é `pruneUnsavedDrafts`; aqui só serializamos.
 * Todo acesso ao `localStorage` fica em try/catch: sem storage (modo restrito,
 * cota cheia, SSR), a página funciona como antes, só sem a restauração.
 */
import type { PenaltyWinner, ScoreDraft, UnsavedDrafts } from './predictionDrafts'

const KEY_PREFIX = 'palpitae:rascunho-palpite'

/** Rascunho esquecido por mais que isso é descartado ao ler. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

type StoredDrafts = {
  savedAt: number
  scores: Record<string, ScoreDraft>
  penalties: Record<string, PenaltyWinner>
}

export function draftStorageKey(userId: string, groupId: string): string {
  return `${KEY_PREFIX}:${userId}:${groupId}`
}

export function emptyDrafts(): UnsavedDrafts {
  return { drafts: new Map(), penaltyDrafts: new Map() }
}

const SCORE = /^\d{1,2}$/

function isScoreDraft(value: unknown): value is ScoreDraft {
  if (typeof value !== 'object' || value === null) return false
  const { home, away } = value as Record<string, unknown>
  return typeof home === 'string' && typeof away === 'string' && SCORE.test(home) && SCORE.test(away)
}

function isPenaltyWinner(value: unknown): value is PenaltyWinner {
  return value === 'home' || value === 'away' || value === null
}

/** `null` quando não há nada a guardar: quem chama remove a chave. */
export function serializeDrafts({ drafts, penaltyDrafts }: UnsavedDrafts, now: number): string | null {
  if (drafts.size === 0 && penaltyDrafts.size === 0) return null
  const stored: StoredDrafts = {
    savedAt: now,
    scores: Object.fromEntries(drafts),
    penalties: Object.fromEntries(penaltyDrafts),
  }
  return JSON.stringify(stored)
}

/** Lê o que foi gravado; entrada inválida, vencida ou ausente vira rascunho vazio. */
export function parseDrafts(raw: string | null, now: number): UnsavedDrafts {
  const result = emptyDrafts()
  if (!raw) return result
  let data: Partial<StoredDrafts>
  try {
    data = JSON.parse(raw) as Partial<StoredDrafts>
  } catch {
    return result
  }
  if (typeof data !== 'object' || data === null) return result
  if (typeof data.savedAt !== 'number' || now - data.savedAt > DRAFT_TTL_MS) return result
  for (const [matchId, draft] of Object.entries(data.scores ?? {})) {
    if (isScoreDraft(draft)) result.drafts.set(matchId, { home: draft.home, away: draft.away })
  }
  for (const [matchId, winner] of Object.entries(data.penalties ?? {})) {
    if (isPenaltyWinner(winner)) result.penaltyDrafts.set(matchId, winner)
  }
  return result
}

export function readStoredDrafts(key: string, now = Date.now()): UnsavedDrafts {
  try {
    return parseDrafts(localStorage.getItem(key), now)
  } catch {
    return emptyDrafts()
  }
}

export function writeStoredDrafts(key: string, drafts: UnsavedDrafts, now = Date.now()): void {
  try {
    const serialized = serializeDrafts(drafts, now)
    if (serialized === null) localStorage.removeItem(key)
    else localStorage.setItem(key, serialized)
  } catch {
    // Storage indisponível ou cheio: o rascunho vive só na memória da aba.
  }
}

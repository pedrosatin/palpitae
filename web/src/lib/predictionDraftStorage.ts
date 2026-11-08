/**
 * Guarda no navegador os rascunhos de palpite ainda não salvos, por usuário e
 * grupo, para que recarregar a aba Palpitar não apague o que foi digitado.
 *
 * Quem decide o que vale guardar é `pruneUnsavedDrafts`. Aqui só serializamos.
 * Todo acesso ao `localStorage` fica em try/catch. Em modo restrito, com a cota
 * cheia ou no SSR, a página funciona como antes, só sem a restauração.
 */
import type { DraftEntries, DraftEntry, PenaltyWinner, ScoreDraft } from './predictionDrafts'

const KEY_PREFIX = 'palpitae:rascunho-palpite'

/** Rascunho digitado há mais que isso é descartado ao ler. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000

type StoredDrafts = {
  scores: Record<string, DraftEntry<ScoreDraft>>
  penalties: Record<string, DraftEntry<PenaltyWinner>>
}

export function draftStorageKey(userId: string, groupId: string): string {
  return `${KEY_PREFIX}:${userId}:${groupId}`
}

export function emptyDrafts(): DraftEntries {
  return { drafts: new Map(), penaltyDrafts: new Map() }
}

const SCORE = /^\d{1,2}$/

function isScoreDraft(value: unknown): value is ScoreDraft {
  if (typeof value !== 'object' || value === null) return false
  const { home, away } = value as Record<string, unknown>
  return (
    typeof home === 'string' && typeof away === 'string' && SCORE.test(home) && SCORE.test(away)
  )
}

function isPenaltyWinner(value: unknown): value is PenaltyWinner {
  return value === 'home' || value === 'away' || value === null
}

/** Entrada válida e digitada dentro do prazo. `at` é a hora da digitação, e regravar não a renova. */
function readEntry<T>(
  raw: unknown,
  isValue: (value: unknown) => value is T,
  now: number,
): DraftEntry<T> | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { value, base, at } = raw as Record<string, unknown>
  if (!isValue(value) || typeof base !== 'string' || typeof at !== 'number') return null
  if (now - at > DRAFT_TTL_MS) return null
  return { value, base, at }
}

/** Devolve `null` quando não há nada a guardar, e quem chama remove a chave. */
export function serializeDrafts({ drafts, penaltyDrafts }: DraftEntries): string | null {
  if (drafts.size === 0 && penaltyDrafts.size === 0) return null
  const stored: StoredDrafts = {
    scores: Object.fromEntries(drafts),
    penalties: Object.fromEntries(penaltyDrafts),
  }
  return JSON.stringify(stored)
}

/** Lê o que foi gravado. Entrada inválida ou vencida fica de fora. */
export function parseDrafts(raw: string | null, now: number): DraftEntries {
  const result = emptyDrafts()
  if (!raw) return result
  let data: Partial<StoredDrafts>
  try {
    data = JSON.parse(raw) as Partial<StoredDrafts>
  } catch {
    return result
  }
  if (typeof data !== 'object' || data === null) return result
  for (const [matchId, item] of Object.entries(data.scores ?? {})) {
    const entry = readEntry(item, isScoreDraft, now)
    if (!entry) continue
    const { home, away } = entry.value
    result.drafts.set(matchId, { ...entry, value: { home, away } })
  }
  for (const [matchId, item] of Object.entries(data.penalties ?? {})) {
    const entry = readEntry(item, isPenaltyWinner, now)
    if (entry) result.penaltyDrafts.set(matchId, entry)
  }
  return result
}

export function readStoredDrafts(key: string, now = Date.now()): DraftEntries {
  try {
    return parseDrafts(localStorage.getItem(key), now)
  } catch {
    return emptyDrafts()
  }
}

export function writeStoredDrafts(key: string, drafts: DraftEntries): void {
  try {
    const serialized = serializeDrafts(drafts)
    if (serialized === null) localStorage.removeItem(key)
    else localStorage.setItem(key, serialized)
  } catch {
    // Com o storage indisponível ou cheio, o rascunho vive só na memória da aba.
  }
}

/** Apaga os rascunhos de todos os usuários e grupos deste navegador. O logout chama esta função. */
export function clearStoredDrafts(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(`${KEY_PREFIX}:`)) keys.push(key)
    }
    for (const key of keys) localStorage.removeItem(key)
  } catch {
    // Sem storage não há rascunho guardado para apagar.
  }
}

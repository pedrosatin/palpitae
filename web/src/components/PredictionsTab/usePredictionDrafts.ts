import { useEffect, useMemo, useState } from 'react'
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning'
import {
  draftValues,
  dropStaleDrafts,
  pruneUnsavedDrafts,
  roundsWithDrafts,
  savedBase,
  type DraftEntries,
  type DraftEntry,
  type PenaltyWinner,
} from '../../lib/predictionDrafts'
import { emptyDrafts, readStoredDrafts, writeStoredDrafts } from '../../lib/predictionDraftStorage'
import type { Match, Prediction } from '../MatchCard/types'

function lastStartUpTo(matches: Match[], now: number): number {
  let last = 0
  for (const match of matches) {
    const at = Date.parse(match.start_time)
    if (at <= now && at > last) last = at
  }
  return last
}

/**
 * Rascunhos de placar e pênalti da aba Palpitar. O estado começa pelo que ficou
 * guardado no navegador em `storageKey`, uma chave por usuário e grupo. Com a
 * chave nula, nada é lido nem gravado.
 *
 * Cada rascunho leva o palpite salvo no momento da digitação. Quando o salvo
 * muda, seja por salvamento, importação ou outro aparelho, o rascunho daquele
 * jogo é descartado. Só o que ainda difere do salvo, em jogo aberto, vai para o
 * storage, marca a rodada no seletor e segura o aviso de saída. Quando `now`
 * passa do início do jogo, o rascunho dele sai dessas três marcas.
 */
export function usePredictionDrafts(
  storageKey: string | null,
  matches: Match[],
  predictions: Map<string, Prediction>,
  now: number,
) {
  const [entries, setEntries] = useState<DraftEntries>(() =>
    storageKey ? readStoredDrafts(storageKey) : emptyDrafts(),
  )
  const matchesLoaded = matches.length > 0

  useEffect(() => {
    if (matchesLoaded) setEntries((prev) => dropStaleDrafts(prev, predictions))
  }, [matchesLoaded, predictions])

  const closedAt = lastStartUpTo(matches, now)
  const kept = useMemo(
    () => pruneUnsavedDrafts({ matches, predictions, ...entries, nowMs: closedAt }),
    [matches, predictions, entries, closedAt],
  )
  const unsavedDrafts = useMemo(() => draftValues(kept), [kept])
  const unsavedRounds = useMemo(() => roundsWithDrafts(matches, kept), [matches, kept])

  useEffect(() => {
    if (storageKey && matchesLoaded) writeStoredDrafts(storageKey, kept)
  }, [storageKey, matchesLoaded, kept])
  useBeforeUnloadWarning(unsavedDrafts.drafts.size + unsavedDrafts.penaltyDrafts.size > 0)

  function entryFor<T>(matchId: string, value: T) {
    return { value, base: savedBase(predictions.get(matchId)), at: Date.now() }
  }

  function handleDraftChange(matchId: string, home: string, away: string) {
    const entry = entryFor(matchId, { home, away })
    setEntries((prev) => ({ ...prev, drafts: new Map(prev.drafts).set(matchId, entry) }))
  }

  function handlePenaltyDraftChange(matchId: string, winner: PenaltyWinner) {
    const entry = entryFor(matchId, winner)
    setEntries((prev) => ({
      ...prev,
      penaltyDrafts: new Map(prev.penaltyDrafts).set(matchId, entry),
    }))
  }

  function clearSubmittedDrafts(submitted: Array<{ matchId: string; nextBase: string }>) {
    if (submitted.length === 0) return
    setEntries((prev) => {
      let drafts: Map<string, DraftEntry<{ home: string; away: string }>> | null = null
      let penaltyDrafts: Map<string, DraftEntry<PenaltyWinner>> | null = null
      for (const { matchId, nextBase } of submitted) {
        const d = prev.drafts.get(matchId)
        if (d && d.base !== nextBase) {
          drafts ??= new Map(prev.drafts)
          drafts.delete(matchId)
        }
        const p = prev.penaltyDrafts.get(matchId)
        if (p && p.base !== nextBase) {
          penaltyDrafts ??= new Map(prev.penaltyDrafts)
          penaltyDrafts.delete(matchId)
        }
      }
      if (!drafts && !penaltyDrafts) return prev
      return {
        drafts: drafts ?? prev.drafts,
        penaltyDrafts: penaltyDrafts ?? prev.penaltyDrafts,
      }
    })
  }

  function rebaseDrafts(rebases: Array<{ matchId: string; fromBase: string; toBase: string }>) {
    if (rebases.length === 0) return
    setEntries((prev) => {
      let drafts: Map<string, DraftEntry<{ home: string; away: string }>> | null = null
      let penaltyDrafts: Map<string, DraftEntry<PenaltyWinner>> | null = null
      for (const { matchId, fromBase, toBase } of rebases) {
        const d = prev.drafts.get(matchId)
        if (d && d.base === fromBase) {
          drafts ??= new Map(prev.drafts)
          drafts.set(matchId, { ...d, base: toBase })
        }
        const p = prev.penaltyDrafts.get(matchId)
        if (p && p.base === fromBase) {
          penaltyDrafts ??= new Map(prev.penaltyDrafts)
          penaltyDrafts.set(matchId, { ...p, base: toBase })
        }
      }
      if (!drafts && !penaltyDrafts) return prev
      return {
        drafts: drafts ?? prev.drafts,
        penaltyDrafts: penaltyDrafts ?? prev.penaltyDrafts,
      }
    })
  }

  function hasRawDraft(matchId: string) {
    const currentBase = savedBase(predictions.get(matchId))
    return (
      entries.drafts.get(matchId)?.base === currentBase ||
      entries.penaltyDrafts.get(matchId)?.base === currentBase
    )
  }

  return {
    unsavedDrafts,
    unsavedRounds,
    handleDraftChange,
    handlePenaltyDraftChange,
    clearSubmittedDrafts,
    rebaseDrafts,
    hasRawDraft,
  }
}

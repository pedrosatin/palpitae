import { useEffect, useMemo, useState } from 'react'
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning'
import {
  draftValues,
  dropStaleDrafts,
  pruneUnsavedDrafts,
  roundsWithDrafts,
  savedBase,
  type DraftEntries,
  type PenaltyWinner,
} from '../../lib/predictionDrafts'
import { emptyDrafts, readStoredDrafts, writeStoredDrafts } from '../../lib/predictionDraftStorage'
import type { Match, Prediction } from '../MatchCard'

/**
 * Rascunhos de placar e pênalti da aba Palpitar. O estado começa pelo que ficou
 * guardado no navegador em `storageKey`, uma chave por usuário e grupo. Com a
 * chave nula, nada é lido nem gravado.
 *
 * Cada rascunho leva o palpite salvo no momento da digitação. Quando o salvo
 * muda, seja por salvamento, importação ou outro aparelho, o rascunho daquele
 * jogo é descartado. Só o que ainda difere do salvo, em jogo aberto, vai para o
 * storage, marca a rodada no seletor e segura o aviso de saída.
 */
export function usePredictionDrafts(
  storageKey: string | null,
  matches: Match[],
  predictions: Map<string, Prediction>,
) {
  const [entries, setEntries] = useState<DraftEntries>(() =>
    storageKey ? readStoredDrafts(storageKey) : emptyDrafts(),
  )
  // Antes de os jogos chegarem, tudo pareceria desconhecido e o storage seria apagado.
  const matchesLoaded = matches.length > 0

  // Sem esta limpeza, o rascunho velho voltaria se o salvo retornasse ao valor
  // da base, por exemplo numa segunda importação.
  useEffect(() => {
    if (matchesLoaded) setEntries((prev) => dropStaleDrafts(prev, predictions))
  }, [matchesLoaded, predictions])

  const kept = useMemo(
    () => pruneUnsavedDrafts({ matches, predictions, ...entries }),
    [matches, predictions, entries],
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

  return { unsavedDrafts, unsavedRounds, handleDraftChange, handlePenaltyDraftChange }
}

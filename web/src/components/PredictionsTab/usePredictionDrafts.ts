import { useEffect, useMemo, useState } from 'react'
import { useBeforeUnloadWarning } from '../../hooks/useBeforeUnloadWarning'
import {
  pruneUnsavedDrafts,
  type PenaltyWinner,
  type ScoreDraft,
} from '../../lib/predictionDrafts'
import { emptyDrafts, readStoredDrafts, writeStoredDrafts } from '../../lib/predictionDraftStorage'
import type { Match, Prediction } from '../MatchCard'

/**
 * Rascunhos de placar e pênalti da aba Palpitar, começando pelo que ficou
 * guardado no navegador (`storageKey`, por usuário e grupo; `null` desliga).
 *
 * Só o que ainda difere do salvo, em jogo aberto (`unsavedDrafts`), vai para o
 * storage e segura o aviso de saída. Salvar atualiza `predictions` e tira o
 * jogo de lá sozinho; a importação, que troca o palpite salvo por outro, chama
 * `discardDrafts` para o rascunho velho não voltar por cima do importado.
 */
export function usePredictionDrafts(
  storageKey: string | null,
  matches: Match[],
  predictions: Map<string, Prediction>,
) {
  const [stored] = useState(() => (storageKey ? readStoredDrafts(storageKey) : emptyDrafts()))
  const [drafts, setDrafts] = useState<Map<string, ScoreDraft>>(stored.drafts)
  const [penaltyDrafts, setPenaltyDrafts] = useState<Map<string, PenaltyWinner>>(
    stored.penaltyDrafts,
  )

  const unsavedDrafts = useMemo(
    () => pruneUnsavedDrafts({ matches, predictions, drafts, penaltyDrafts }),
    [matches, predictions, drafts, penaltyDrafts],
  )
  // Antes de os jogos chegarem, tudo pareceria desconhecido e o storage seria apagado.
  const matchesLoaded = matches.length > 0
  useEffect(() => {
    if (storageKey && matchesLoaded) writeStoredDrafts(storageKey, unsavedDrafts)
  }, [storageKey, matchesLoaded, unsavedDrafts])
  useBeforeUnloadWarning(unsavedDrafts.drafts.size + unsavedDrafts.penaltyDrafts.size > 0)

  function handleDraftChange(matchId: string, home: string, away: string) {
    setDrafts((prev) => {
      const next = new Map(prev)
      next.set(matchId, { home, away })
      return next
    })
  }

  function handlePenaltyDraftChange(matchId: string, winner: PenaltyWinner) {
    setPenaltyDrafts((prev) => {
      const next = new Map(prev)
      next.set(matchId, winner)
      return next
    })
  }

  function discardDrafts(matchIds: string[]) {
    if (matchIds.length === 0) return
    function without<T>(prev: Map<string, T>) {
      const next = new Map(prev)
      for (const id of matchIds) next.delete(id)
      return next
    }
    setDrafts(without)
    setPenaltyDrafts(without)
  }

  return {
    drafts,
    penaltyDrafts,
    unsavedDrafts,
    handleDraftChange,
    handlePenaltyDraftChange,
    discardDrafts,
  }
}

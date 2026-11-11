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
 * Início mais recente até `now`, ou 0. O travamento por horário só muda nesses
 * instantes, e com este valor a poda dos rascunhos recalcula só quando um jogo
 * começa. Gravar o storage a cada tique do relógio sobrescreveria o rascunho de
 * outra aba aberta no mesmo grupo.
 */
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
  // Antes de os jogos chegarem, tudo pareceria desconhecido e o storage seria apagado.
  const matchesLoaded = matches.length > 0

  // Sem esta limpeza, o rascunho velho voltaria se o salvo retornasse ao valor
  // da base, por exemplo numa segunda importação.
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

  return { unsavedDrafts, unsavedRounds, handleDraftChange, handlePenaltyDraftChange }
}

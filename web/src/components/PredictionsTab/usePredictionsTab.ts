import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { useMatchRounds } from '../../hooks/useMatchRounds'
import { apiFetch } from '../../lib/api'
import { invalidateApiCache } from '../../lib/api-cache'
import { applyDefaultRoundFromMatches, fetchCompetitionMatches } from '../../lib/competitionMatches'
import { fetchGroupsList } from '../../lib/groupsList'
import { isMatchLocked } from '../../lib/predictionDrafts'
import { draftStorageKey } from '../../lib/predictionDraftStorage'
import type { Match, Prediction } from '../MatchCard'
import { usePredictionDrafts } from './usePredictionDrafts'
import { usePredictionsBulkSave } from './usePredictionsBulkSave'

type PredictionMap = Map<string, Prediction>
/** Grupo de origem → jogos abertos que o usuário palpitou lá. `null`: API antiga, sem o campo. */
type ImportSources = Record<string, string[]> | null
type PredictionsResponse = {
  predictions: Prediction[]
  import_completed?: boolean
  import_sources?: Record<string, string[]>
}

function usePredictionsFetch(
  groupId: string,
  competitionId: string,
  requestedRound: string | null | undefined,
  onRequestedRoundApplied: (() => void) | undefined,
) {
  const [matches, setMatches] = useState<Match[]>([])
  const [predictions, setPredictions] = useState<PredictionMap>(new Map())
  const [importCompleted, setImportCompleted] = useState(false)
  const [importSources, setImportSources] = useState<ImportSources>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)
  const [defaultRound, setDefaultRound] = useState<string | null>(null)
  // A rodada do link fica fora das dependências da busca. Quando o `?rodada=` sai
  // da URL, a aba não busca de novo nem volta para a rodada padrão.
  const requested = useRef({ round: requestedRound, onApplied: onRequestedRoundApplied })
  useEffect(() => {
    requested.current = { round: requestedRound, onApplied: onRequestedRoundApplied }
  })

  useEffect(() => {
    let active = true
    setImportCompleted(false)
    setImportSources(null)
    setLoading(true)
    setError(null)

    Promise.all([
      fetchCompetitionMatches(competitionId),
      apiFetch(`${config.apiUrl}/predictions?group_id=${encodeURIComponent(groupId)}`).then((r) => {
        if (!r.ok) throw new Error('Erro ao carregar palpites')
        return r.json() as Promise<PredictionsResponse>
      }),
    ])
      .then(([matchesData, predictionsData]) => {
        if (!active) return
        setImportCompleted(predictionsData.import_completed === true)
        setImportSources(predictionsData.import_sources ?? null)
        setMatches(matchesData.matches)
        setDefaultRound(matchesData.default_round ?? null)
        const map = new Map<string, Prediction>()
        for (const p of predictionsData.predictions) map.set(p.match_id, p)
        setPredictions(map)

        const { round, onApplied } = requested.current
        applyDefaultRoundFromMatches(
          matchesData.matches,
          matchesData.default_round,
          setRoundIndex,
          round,
        )
        if (round) onApplied?.()
      })
      .catch((e: Error) => {
        if (active) setError(e.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [groupId, competitionId])

  return {
    matches,
    predictions,
    setPredictions,
    loading,
    error,
    roundIndex,
    setRoundIndex,
    defaultRound,
    importCompleted,
    setImportCompleted,
    importSources,
    setImportSources,
  }
}

/**
 * Palpites que cada grupo irmão ainda pode trazer: jogos abertos sem palpite aqui.
 * Recalcula a cada palpite salvo, sem nova ida à API, e descarta jogos que
 * travaram com a página aberta.
 */
function deriveImportOptions(
  otherGroups: { id: string; name: string }[],
  importSources: ImportSources,
  predictions: PredictionMap,
  matches: Match[],
  importCompleted: boolean,
  importExpanded: boolean,
) {
  const open = new Set(matches.filter((m) => !isMatchLocked(m, undefined)).map((m) => m.id))
  const missing = (id: string) =>
    (importSources?.[id] ?? []).filter((matchId) => open.has(matchId) && !predictions.has(matchId))
      .length
  const withMissing = otherGroups.map((g) => ({ id: g.id, name: g.name, missing: missing(g.id) }))
  // API antiga, sem `import_sources`: vale só o marcador de importação concluída.
  if (importSources === null) {
    return { importPending: !importCompleted && withMissing.length > 0, importOptions: withMissing }
  }
  const importable = withMissing.filter((g) => g.missing > 0).sort((a, b) => b.missing - a.missing)
  return {
    importPending: importable.length > 0,
    importOptions: importExpanded ? withMissing : importable,
  }
}

function usePredictionsImport(
  groupId: string,
  competitionId: string,
  userId: string | undefined,
  matches: Match[],
  predictions: PredictionMap,
  setPredictions: Dispatch<SetStateAction<PredictionMap>>,
  importCompleted: boolean,
  setImportCompleted: Dispatch<SetStateAction<boolean>>,
  importSources: ImportSources,
  setImportSources: Dispatch<SetStateAction<ImportSources>>,
) {
  const scope = useRef({ active: true })
  const [importExpanded, setImportExpanded] = useState(false)
  const [otherGroups, setOtherGroups] = useState<{ id: string; name: string }[]>([])
  const [importSourceId, setImportSourceId] = useState<string>('')
  const [importing, setImporting] = useState(false)
  // Grupo da última importação feita nesta visita. A API guarda só o marcador
  // `import_completed`, então ao recarregar a origem não é mais conhecida.
  const [importedFromName, setImportedFromName] = useState<string | null>(null)
  const [importFeedback, setImportFeedback] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  useEffect(() => {
    const current = { active: true }
    scope.current = current
    setOtherGroups([])
    setImportSourceId('')
    setImporting(false)
    setImportFeedback(null)
    setImportExpanded(false)
    setImportedFromName(null)
    // Vindo do painel, a lista já está no cache em memória e não há nova busca.
    fetchGroupsList(userId)
      .then((data) => {
        if (!current.active) return
        const siblings = data.groups.filter(
          (g) => g.competition_id === competitionId && g.id !== groupId,
        )
        // Sem pré-seleção: o padrão é o primeiro de `importOptions`, o grupo com mais
        // palpites faltando.
        setOtherGroups(siblings)
      })
      .catch(() => {})
    return () => {
      current.active = false
    }
  }, [groupId, competitionId, userId])

  const { importPending, importOptions } = deriveImportOptions(
    otherGroups,
    importSources,
    predictions,
    matches,
    importCompleted,
    importExpanded,
  )
  const selectedSourceId = importOptions.some((g) => g.id === importSourceId)
    ? importSourceId
    : (importOptions[0]?.id ?? '')

  async function handleImport() {
    const current = scope.current
    const sourceId = selectedSourceId
    // O seletor de pendências só preenche o que falta, inclusive na primeira
    // importação. O seletor completo, aberto pelo link, sobrescreve.
    const onlyMissing = importSources !== null && !importExpanded
    if (!sourceId || !current.active) return
    trackEvent('click_predictions_importar')
    setImporting(true)
    setImportFeedback(null)
    try {
      const res = await apiFetch(`${config.apiUrl}/predictions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_group_id: sourceId,
          target_group_id: groupId,
          ...(onlyMissing ? { only_missing: true } : {}),
        }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        imported?: number
        locked_skipped?: number
      }
      if (!res.ok) throw new Error(data.error ?? 'Erro ao importar palpites')

      if (!current.active) return
      const imported = data.imported ?? 0
      const skipped = data.locked_skipped ?? 0
      const skippedMsg =
        skipped === 0
          ? ''
          : skipped === 1
            ? '1 palpite já bloqueado foi ignorado.'
            : `${skipped} palpites já bloqueados foram ignorados.`
      // Com palpite importado, o aviso "Palpites importados de <grupo>." já confirma
      // o sucesso. Aqui fica só o que ele não diz.
      const msg = [imported > 0 ? '' : 'Nenhum palpite importado.', skippedMsg]
        .filter(Boolean)
        .join(' ')
      if (imported > 0) {
        setImportCompleted(true)
        setImportedFromName(otherGroups.find((g) => g.id === sourceId)?.name ?? null)
        setImportExpanded(false)
        // Import altera pending_predictions do grupo alvo na home.
        invalidateApiCache('groups:')
      }
      if (msg) setImportFeedback({ ok: true, message: msg })
      try {
        const predsRes = await apiFetch(
          `${config.apiUrl}/predictions?group_id=${encodeURIComponent(groupId)}`,
        )
        if (!predsRes.ok) throw new Error('Erro ao atualizar palpites')
        const predsData = (await predsRes.json()) as PredictionsResponse
        const map = new Map<string, Prediction>()
        for (const p of predsData.predictions) map.set(p.match_id, p)
        if (current.active) {
          // O importado muda o palpite salvo, e `usePredictionDrafts` descarta o
          // rascunho digitado sobre o valor anterior.
          setPredictions(map)
          if (predsData.import_sources) setImportSources(predsData.import_sources)
        }
      } catch {
        if (current.active)
          setImportFeedback({
            ok: false,
            message: [msg, 'Não foi possível atualizar os palpites na tela. Recarregue a página.']
              .filter(Boolean)
              .join(' '),
          })
      }
    } catch (e) {
      if (current.active) setImportFeedback({ ok: false, message: (e as Error).message })
    } finally {
      if (current.active) setImporting(false)
    }
  }

  return {
    importExpanded,
    setImportExpanded,
    otherGroups,
    importOptions,
    importPending,
    importSourceId: selectedSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    importedFromName,
    handleImport,
  }
}

/**
 * `userId` liga a guarda dos rascunhos no navegador; sem ele, ficam só na memória.
 * `requestedRound` vem do `?rodada=` do painel e abre a aba nessa rodada em vez da
 * padrão. `onRequestedRoundApplied` avisa quando ela foi aplicada.
 */
export function usePredictionsTab(
  groupId: string,
  competitionId: string,
  userId?: string,
  requestedRound?: string | null,
  onRequestedRoundApplied?: () => void,
) {
  const {
    matches,
    predictions,
    setPredictions,
    loading,
    error,
    roundIndex,
    setRoundIndex,
    defaultRound,
    importCompleted,
    setImportCompleted,
    importSources,
    setImportSources,
  } = usePredictionsFetch(groupId, competitionId, requestedRound, onRequestedRoundApplied)

  const { unsavedDrafts, unsavedRounds, handleDraftChange, handlePenaltyDraftChange } =
    usePredictionDrafts(userId ? draftStorageKey(userId, groupId) : null, matches, predictions)

  const {
    importExpanded,
    setImportExpanded,
    otherGroups,
    importOptions,
    importPending,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    importedFromName,
    handleImport,
  } = usePredictionsImport(
    groupId,
    competitionId,
    userId,
    matches,
    predictions,
    setPredictions,
    importCompleted,
    setImportCompleted,
    importSources,
    setImportSources,
  )

  const {
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    postponedByRound,
    rescheduledByRound,
    prev,
    next,
  } = useMatchRounds(
    matches,
    roundIndex,
    setRoundIndex,
    {
      prev: 'click_predictions_rodada_anterior',
      next: 'click_predictions_proxima_rodada',
    },
    defaultRound,
  )

  const {
    savingAll,
    savedAll,
    hasSavedPredictions,
    bulkError,
    pendingCount,
    handleSaveAll,
    handleSaved,
  } = usePredictionsBulkSave(
    groupId,
    roundMatches,
    predictions,
    setPredictions,
    selectedRound,
    matches,
    unsavedDrafts,
  )

  // Usa `isMatchLocked`, a regra de `collectRoundDrafts`. Sem jogo aberto na rodada
  // exibida, a barra "Salvar todos" sai da tela. Ela continua enquanto um envio está
  // em andamento ou mostra o erro dele, mesmo que o último jogo aberto comece no meio.
  const showSaveBar =
    roundMatches.some((m) => !isMatchLocked(m, predictions.get(m.id))) ||
    savingAll ||
    bulkError !== null

  return {
    importCompleted,
    showSaveBar,
    unsavedDrafts,
    unsavedRounds,
    matches,
    predictions,
    loading,
    error,
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    postponedByRound,
    rescheduledByRound,
    prev,
    next,
    setRoundIndex,
    savingAll,
    savedAll,
    hasSavedPredictions,
    bulkError,
    pendingCount,
    handleSaveAll,
    importExpanded,
    setImportExpanded,
    otherGroups,
    importOptions,
    importPending,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    importedFromName,
    handleImport,
    handleSaved,
    handleDraftChange,
    handlePenaltyDraftChange,
  }
}

import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { buildApiUrl } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { useMatchRounds } from '../../hooks/useMatchRounds'
import { useNow } from '../../hooks/useNow'
import { apiFetch, CONNECTION_ERROR, readApiError } from '../../lib/api'
import { invalidateApiCache } from '../../lib/api-cache'
import { isListOf, isRecord, UNEXPECTED_RESPONSE } from '../../lib/responseShape'
import {
  applyDefaultRoundFromMatches,
  competitionMatchesQueryOptions,
  matchesQueryErrorMessage,
} from '../../lib/competitionMatches'
import { fetchGroupsList } from '../../lib/groupsList'
import { isMatchLocked } from '../../lib/predictionDrafts'
import { draftStorageKey } from '../../lib/predictionDraftStorage'
import { acceptsFrom } from '../../lib/predictionCopy'
import type { Match, Prediction } from '../MatchCard'
import { usePredictionDrafts } from './usePredictionDrafts'
import { usePredictionsBulkSave } from './usePredictionsBulkSave'
import { usePredictionsReplicate } from './usePredictionsReplicate'

type PredictionMap = Map<string, Prediction>

const TICK_MS = 30_000

type ImportSources = Record<string, string[]> | null
type PredictionsResponse = {
  predictions: Prediction[]
  import_completed?: boolean
  import_sources?: Record<string, string[]>
}
type SiblingGroup = {
  id: string
  name: string
  competition_status?: string | null
  points_exact?: number
}

async function fetchOwnPredictions(groupId: string): Promise<{
  predictions: PredictionMap
  importCompleted: boolean
  importSources: ImportSources
}> {
  const res = await apiFetch(
    buildApiUrl('/predictions', new URLSearchParams({ group_id: groupId })),
  )
  if (!res.ok) throw new Error('Erro ao carregar palpites')
  const data: unknown = await res.json()
  if (!isRecord(data) || !isListOf(data.predictions, { match_id: 'string' }))
    throw new Error(UNEXPECTED_RESPONSE)
  const { predictions: list, import_completed, import_sources } = data as PredictionsResponse
  const predictions: PredictionMap = new Map()
  for (const p of list) predictions.set(p.match_id, p)
  return {
    predictions,
    importCompleted: import_completed === true,
    importSources: isRecord(import_sources) ? import_sources : null,
  }
}

async function postPredictionsImport(
  sourceId: string,
  groupId: string,
  onlyMissing: boolean,
): Promise<{ imported: number; skipped: number }> {
  const res = await apiFetch(buildApiUrl('/predictions/import'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source_group_id: sourceId,
      target_group_id: groupId,
      ...(onlyMissing ? { only_missing: true } : {}),
    }),
  }).catch(() => {
    throw new Error(CONNECTION_ERROR)
  })
  if (!res.ok) throw new Error(await readApiError(res, 'Erro ao importar palpites'))
  const data = (await res.json()) as { imported?: number; locked_skipped?: number }
  return { imported: data.imported ?? 0, skipped: data.locked_skipped ?? 0 }
}

function importResultMessage(imported: number, skipped: number): string {
  const skippedMsg =
    skipped === 0
      ? ''
      : skipped === 1
        ? '1 palpite já bloqueado foi ignorado.'
        : `${skipped} palpites já bloqueados foram ignorados.`
  return [imported > 0 ? '' : 'Nenhum palpite importado.', skippedMsg].filter(Boolean).join(' ')
}

function pickImportSource(options: { id: string }[], id: string): string {
  return options.some((g) => g.id === id) ? id : (options[0]?.id ?? '')
}

function usePredictionsFetch(
  groupId: string,
  competitionId: string,
  requestedRound: string | null | undefined,
  onRequestedRoundApplied: (() => void) | undefined,
) {
  const matchesQuery = useQuery(competitionMatchesQueryOptions(competitionId))
  const [predictions, setPredictions] = useState<PredictionMap>(new Map())
  const [importCompleted, setImportCompleted] = useState(false)
  const [importSources, setImportSources] = useState<ImportSources>(null)
  const [predictionsLoading, setPredictionsLoading] = useState(true)
  const [predictionsError, setPredictionsError] = useState<string | null>(null)
  const [roundIndex, setRoundIndex] = useState(0)
  const requested = useRef({ round: requestedRound, onApplied: onRequestedRoundApplied })
  const appliedDefaultRoundKey = useRef<string | null>(null)
  useEffect(() => {
    requested.current = { round: requestedRound, onApplied: onRequestedRoundApplied }
  })

  useEffect(() => {
    let active = true
    setImportCompleted(false)
    setImportSources(null)
    setPredictionsLoading(true)
    setPredictionsError(null)

    fetchOwnPredictions(groupId)
      .then((predictionsData) => {
        if (!active) return
        setImportCompleted(predictionsData.importCompleted)
        setImportSources(predictionsData.importSources)
        setPredictions(predictionsData.predictions)
      })
      .catch((e: Error) => {
        if (active) setPredictionsError(e.message)
      })
      .finally(() => {
        if (active) setPredictionsLoading(false)
      })
    return () => {
      active = false
    }
  }, [groupId])

  useEffect(() => {
    if (!matchesQuery.data || matchesQuery.isFetching) return
    const key = `${groupId}:${competitionId}`
    if (appliedDefaultRoundKey.current === key) return
    appliedDefaultRoundKey.current = key
    const { round, onApplied } = requested.current
    applyDefaultRoundFromMatches(
      matchesQuery.data.matches,
      matchesQuery.data.default_round,
      setRoundIndex,
      round,
    )
    if (round) onApplied?.()
  }, [groupId, competitionId, matchesQuery.data, matchesQuery.isFetching])

  const matchesError = matchesQueryErrorMessage(matchesQuery.error, matchesQuery.isError)

  return {
    matches: matchesQuery.data?.matches ?? [],
    predictions,
    setPredictions,
    loading: matchesQuery.isPending || predictionsLoading,
    error: matchesError ?? predictionsError,
    roundIndex,
    setRoundIndex,
    defaultRound: matchesQuery.data?.default_round ?? null,
    importCompleted,
    setImportCompleted,
    importSources,
    setImportSources,
  }
}

function mergeFetchedPredictions(
  fetched: PredictionMap,
  current: PredictionMap,
  savedSince: Set<string>,
): PredictionMap {
  const merged = new Map(fetched)
  for (const matchId of savedSince) {
    const saved = current.get(matchId)
    if (saved) merged.set(matchId, saved)
  }
  return merged
}

/**
 * Palpites que cada grupo irmão ainda pode trazer: jogos abertos sem palpite aqui.
 * Recalcula a cada palpite salvo, sem nova ida à API, e descarta jogos que
 * travaram com a página aberta.
 */
function deriveImportOptions(
  otherGroups: SiblingGroup[],
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
  if (importSources === null) {
    return { importPending: !importCompleted && withMissing.length > 0, importOptions: withMissing }
  }
  const importable = withMissing.filter((g) => g.missing > 0).sort((a, b) => b.missing - a.missing)
  return {
    importPending: importable.length > 0,
    importOptions: importExpanded ? withMissing : importable,
  }
}

function useSiblingGroups(
  groupId: string,
  competitionId: string,
  userId: string | undefined,
): SiblingGroup[] {
  const [siblings, setSiblings] = useState<SiblingGroup[]>([])

  useEffect(() => {
    let active = true
    setSiblings([])
    fetchGroupsList(userId)
      .then((data) => {
        if (!active) return
        setSiblings(
          data.groups.filter((g) => g.competition_id === competitionId && g.id !== groupId),
        )
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [groupId, competitionId, userId])

  return siblings
}

type ImportInput = {
  groupId: string
  competitionId: string
  userId: string | undefined
  matches: Match[]
  predictions: PredictionMap
  setPredictions: Dispatch<SetStateAction<PredictionMap>>
  importCompleted: boolean
  setImportCompleted: Dispatch<SetStateAction<boolean>>
  importSources: ImportSources
  setImportSources: Dispatch<SetStateAction<ImportSources>>
  pointsExact: number
}

function usePredictionsImport({
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
  pointsExact,
}: ImportInput) {
  const scope = useRef({ active: true })
  const siblings = useSiblingGroups(groupId, competitionId, userId)
  const otherGroups = siblings.filter((g) =>
    acceptsFrom({ points_exact: g.points_exact ?? 3 }, { points_exact: pointsExact }),
  )
  const savedDuringRefresh = useRef<Set<string> | null>(null)
  function noteSaved(matchIds: string[]) {
    for (const id of matchIds) savedDuringRefresh.current?.add(id)
  }
  const [importExpanded, setImportExpanded] = useState(false)
  const [importSourceId, setImportSourceId] = useState<string>('')
  const [importing, setImporting] = useState(false)
  const [importedFromName, setImportedFromName] = useState<string | null>(null)
  const [importFeedback, setImportFeedback] = useState<{
    ok: boolean
    message: string
  } | null>(null)

  useEffect(() => {
    const current = { active: true }
    scope.current = current
    setImportSourceId('')
    setImporting(false)
    setImportFeedback(null)
    setImportExpanded(false)
    setImportedFromName(null)
    return () => {
      current.active = false
      savedDuringRefresh.current = null
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
  const selectedSourceId = pickImportSource(importOptions, importSourceId)

  async function handleImport() {
    const current = scope.current
    const sourceId = selectedSourceId
    const onlyMissing = importSources !== null && !importExpanded
    if (!sourceId || !current.active) return
    trackEvent('click_predictions_importar')
    setImporting(true)
    setImportFeedback(null)
    try {
      const { imported, skipped } = await postPredictionsImport(sourceId, groupId, onlyMissing)
      if (!current.active) return
      const msg = importResultMessage(imported, skipped)
      if (imported > 0) {
        setImportCompleted(true)
        setImportedFromName(otherGroups.find((g) => g.id === sourceId)?.name ?? null)
        setImportExpanded(false)
        invalidateApiCache('groups:')
      }
      if (msg) setImportFeedback({ ok: true, message: msg })
      const savedSince = new Set<string>()
      savedDuringRefresh.current = savedSince
      try {
        const refreshed = await fetchOwnPredictions(groupId)
        if (current.active) {
          setPredictions((prev) => mergeFetchedPredictions(refreshed.predictions, prev, savedSince))
          if (refreshed.importSources) setImportSources(refreshed.importSources)
        }
      } catch {
        if (current.active)
          setImportFeedback({
            ok: false,
            message: [msg, 'Não foi possível atualizar os palpites na tela. Recarregue a página.']
              .filter(Boolean)
              .join(' '),
          })
      } finally {
        if (savedDuringRefresh.current === savedSince) savedDuringRefresh.current = null
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
    siblings,
    otherGroups,
    importOptions,
    importPending,
    importSourceId: selectedSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    importedFromName,
    handleImport,
    noteSaved,
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
  pointsExact = 3,
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

  const now = useNow(
    TICK_MS,
    matches.map((m) => m.start_time),
  )

  const { unsavedDrafts, unsavedRounds, handleDraftChange, handlePenaltyDraftChange } =
    usePredictionDrafts(userId ? draftStorageKey(userId, groupId) : null, matches, predictions, now)

  const {
    importExpanded,
    setImportExpanded,
    siblings,
    otherGroups,
    importOptions,
    importPending,
    importSourceId,
    setImportSourceId,
    importing,
    importFeedback,
    importedFromName,
    handleImport,
    noteSaved,
  } = usePredictionsImport({
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
    pointsExact,
  })

  const {
    roundKeys,
    safeIndex,
    selectedRound,
    roundMatches,
    labelFor,
    knockoutRounds,
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
    replicateTargets,
    replicateOverflow,
    replicateEnabled,
    replicating,
    replicateFeedback,
    handleReplicateToggle,
    replicate,
    canRetryReplicate,
    retryReplicate,
  } = usePredictionsReplicate(
    { groupId, competitionId, userId, round: selectedRound, pointsExact },
    siblings,
  )
  function replicateSaved(matchIds: string[]) {
    void replicate(matchIds, matches.find((m) => m.id === matchIds[0])?.round ?? selectedRound)
  }

  const {
    savingAll,
    savedAll,
    hasSavedPredictions,
    bulkError,
    pendingCount,
    handleSaveAll,
    handleSaved,
  } = usePredictionsBulkSave({
    groupId,
    roundMatches,
    predictions,
    setPredictions,
    selectedRound,
    allMatches: matches,
    unsavedDrafts,
    onBulkSaved: (matchIds) => {
      noteSaved(matchIds)
      replicateSaved(matchIds)
    },
  })

  function handleSavedAndReplicate(
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) {
    noteSaved([matchId])
    handleSaved(matchId, home, away, penaltyWinner)
    replicateSaved([matchId])
  }

  const hasOpenMatch = roundMatches.some((m) => !isMatchLocked(m, predictions.get(m.id), now))
  const showSaveBar =
    hasOpenMatch || savingAll || bulkError !== null || replicating || replicateFeedback.length > 0

  return {
    now,
    importCompleted,
    showSaveBar,
    hasOpenMatch,
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
    knockoutRounds,
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
    handleSaved: handleSavedAndReplicate,
    replicateTargets,
    replicateOverflow,
    replicateEnabled,
    replicating,
    replicateFeedback,
    handleReplicateToggle,
    canRetryReplicate,
    retryReplicate,
    handleDraftChange,
    handlePenaltyDraftChange,
  }
}

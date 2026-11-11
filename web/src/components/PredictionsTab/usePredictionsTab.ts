import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { useMatchRounds } from '../../hooks/useMatchRounds'
import { useNow } from '../../hooks/useNow'
import { apiFetch } from '../../lib/api'
import { invalidateApiCache } from '../../lib/api-cache'
import { applyDefaultRoundFromMatches, fetchCompetitionMatches } from '../../lib/competitionMatches'
import { fetchGroupsList } from '../../lib/groupsList'
import { isMatchLocked } from '../../lib/predictionDrafts'
import { draftStorageKey } from '../../lib/predictionDraftStorage'
import type { Match, Prediction } from '../MatchCard'
import { usePredictionDrafts } from './usePredictionDrafts'
import { usePredictionsBulkSave } from './usePredictionsBulkSave'
import { usePredictionsReplicate } from './usePredictionsReplicate'

type PredictionMap = Map<string, Prediction>

/** Intervalo do relógio da aba. O "fecha em ..." mostra minutos. */
const TICK_MS = 30_000

/** Grupo de origem → jogos abertos que o usuário palpitou lá. `null`: API antiga, sem o campo. */
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

/** Palpites do usuário no grupo por jogo, com o marcador e as origens da importação. */
async function fetchGroupPredictions(groupId: string): Promise<{
  predictions: PredictionMap
  importCompleted: boolean
  importSources: ImportSources
}> {
  const res = await apiFetch(`${config.apiUrl}/predictions?group_id=${encodeURIComponent(groupId)}`)
  if (!res.ok) throw new Error('Erro ao carregar palpites')
  const data = (await res.json()) as PredictionsResponse
  const predictions: PredictionMap = new Map()
  for (const p of data.predictions) predictions.set(p.match_id, p)
  return {
    predictions,
    importCompleted: data.import_completed === true,
    importSources: data.import_sources ?? null,
  }
}

/** Importa os palpites de `sourceId` para `groupId`. Erro da API vira exceção com a mensagem dela. */
async function postPredictionsImport(
  sourceId: string,
  groupId: string,
  onlyMissing: boolean,
): Promise<{ imported: number; skipped: number }> {
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
  return { imported: data.imported ?? 0, skipped: data.locked_skipped ?? 0 }
}

/**
 * Aviso depois da importação. Com palpite importado, o aviso "Palpites importados
 * de <grupo>." já confirma o sucesso. Aqui fica só o que ele não diz.
 */
function importResultMessage(imported: number, skipped: number): string {
  const skippedMsg =
    skipped === 0
      ? ''
      : skipped === 1
        ? '1 palpite já bloqueado foi ignorado.'
        : `${skipped} palpites já bloqueados foram ignorados.`
  return [imported > 0 ? '' : 'Nenhum palpite importado.', skippedMsg].filter(Boolean).join(' ')
}

/**
 * Grupo escolhido no seletor. Sem escolha válida, vale o primeiro de `options`,
 * o grupo com mais palpites faltando.
 */
function pickImportSource(options: { id: string }[], id: string): string {
  return options.some((g) => g.id === id) ? id : (options[0]?.id ?? '')
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

    Promise.all([fetchCompetitionMatches(competitionId), fetchGroupPredictions(groupId)])
      .then(([matchesData, predictionsData]) => {
        if (!active) return
        setImportCompleted(predictionsData.importCompleted)
        setImportSources(predictionsData.importSources)
        setMatches(matchesData.matches)
        setDefaultRound(matchesData.default_round ?? null)
        setPredictions(predictionsData.predictions)

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
 * Junta a listagem `fetched` ao que está na tela. O palpite que mudou na tela
 * depois de `sentAt`, o estado de quando a listagem foi pedida, é mais novo que
 * ela e fica.
 */
function mergeFetchedPredictions(
  fetched: PredictionMap,
  sentAt: PredictionMap,
  current: PredictionMap,
): PredictionMap {
  const merged = new Map(fetched)
  for (const [matchId, prediction] of current) {
    if (sentAt.get(matchId) !== prediction) merged.set(matchId, prediction)
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

/** Outros grupos do usuário na mesma competição, de onde a importação traz palpites. */
function useSiblingGroups(
  groupId: string,
  competitionId: string,
  userId: string | undefined,
): SiblingGroup[] {
  const [siblings, setSiblings] = useState<SiblingGroup[]>([])

  useEffect(() => {
    let active = true
    setSiblings([])
    // Vindo do painel, a lista já está no cache em memória e não há nova busca.
    fetchGroupsList(userId)
      .then((data) => {
        if (!active) return
        // Sem pré-seleção: o padrão é o primeiro de `importOptions`, o grupo com mais
        // palpites faltando.
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
  pointsExact: number,
) {
  const scope = useRef({ active: true })
  const siblings = useSiblingGroups(groupId, competitionId, userId)
  // Grupo "só vencedor" não é origem para grupo de placar exato: a API recusa, porque
  // o 1x0 do botão não é um placar palpitado.
  const otherGroups = siblings.filter((g) => !(pointsExact > 0 && g.points_exact === 0))
  const latestPredictions = useRef(predictions)
  useEffect(() => {
    latestPredictions.current = predictions
  })
  const [importExpanded, setImportExpanded] = useState(false)
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
    setImportSourceId('')
    setImporting(false)
    setImportFeedback(null)
    setImportExpanded(false)
    setImportedFromName(null)
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
  const selectedSourceId = pickImportSource(importOptions, importSourceId)

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
      const { imported, skipped } = await postPredictionsImport(sourceId, groupId, onlyMissing)
      if (!current.active) return
      const msg = importResultMessage(imported, skipped)
      if (imported > 0) {
        setImportCompleted(true)
        setImportedFromName(otherGroups.find((g) => g.id === sourceId)?.name ?? null)
        setImportExpanded(false)
        // Import altera pending_predictions do grupo alvo na home.
        invalidateApiCache('groups:')
      }
      if (msg) setImportFeedback({ ok: true, message: msg })
      try {
        const sentAt = latestPredictions.current
        const refreshed = await fetchGroupPredictions(groupId)
        if (current.active) {
          // O importado muda o palpite salvo, e `usePredictionDrafts` descarta o
          // rascunho digitado sobre o valor anterior. O palpite salvo enquanto a
          // listagem chegava fica.
          setPredictions((prev) => mergeFetchedPredictions(refreshed.predictions, sentAt, prev))
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

  // Um relógio só para o cabeçalho, os cards e os rascunhos. Ele também vira no
  // início de cada jogo, e o card trava no mesmo instante que a API.
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
    pointsExact,
  )

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
    retryReplicate,
  } = usePredictionsReplicate(
    { groupId, competitionId, userId, round: selectedRound, pointsExact },
    siblings,
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
    replicate,
  )

  // Com a opção marcada, o palpite salvo no card vai também para os outros grupos.
  function handleSavedAndReplicate(
    matchId: string,
    home: number,
    away: number,
    penaltyWinner: 'home' | 'away' | null,
  ) {
    handleSaved(matchId, home, away, penaltyWinner)
    void replicate([matchId])
  }

  // Usa `isMatchLocked`, a regra de `collectRoundDrafts`. Sem jogo aberto na rodada
  // exibida, a barra "Salvar todos" sai da tela. Ela fica enquanto um envio está em
  // andamento, mostra o erro dele e leva a confirmação de "Aplicar também em".
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
    retryReplicate,
    handleDraftChange,
    handlePenaltyDraftChange,
  }
}

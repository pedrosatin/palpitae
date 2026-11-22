import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { buildApiUrl } from '../../../config'
import { trackEvent } from '../../../analytics/ga'
import { getGuideOrigin } from '../../../analytics/guideOrigin'
import { apiFetch, CONNECTION_ERROR, readApiError } from '../../../lib/api'
import { DEFAULT_SCORING, ScoringPreset } from '../constants'
import { selectableCompetitions } from '../competitionStatus'
import type { CompetitionSelectGroups } from '../competitionStatus'
import { Competition, CreatedGroup } from '../types'

interface UseCreateGroupFormProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (group: CreatedGroup) => void
  preferredCompetitionSlug?: string
}

type CompetitionsPayload = {
  list: Competition[]
  groups: CompetitionSelectGroups
}

const EMPTY_GROUPS: CompetitionSelectGroups = { ongoing: [], upcoming: [] }

function competitionsQueryOptions(enabled: boolean) {
  return {
    queryKey: ['competitions', 'selectable'] as const,
    enabled,
    staleTime: 60_000,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<CompetitionsPayload> => {
      const r = await apiFetch(buildApiUrl('/competitions'), { signal })
      if (!r.ok) throw new Error('Não foi possível carregar as competições')
      const data = (await r.json()) as { competitions: Competition[] }
      return selectableCompetitions(data.competitions)
    },
  }
}

export function useCreateGroupForm({
  isOpen,
  onClose,
  onCreated,
  preferredCompetitionSlug,
}: UseCreateGroupFormProps) {
  const competitionsQuery = useQuery(competitionsQueryOptions(isOpen))
  const competitions = competitionsQuery.data?.list ?? []
  const competitionGroups = competitionsQuery.data?.groups ?? EMPTY_GROUPS
  const loadingCompetitions =
    isOpen &&
    (competitionsQuery.isPending || (competitions.length === 0 && competitionsQuery.isFetching))

  const [name, setName] = useState('')
  const [chosenCompetitionId, setCompetitionId] = useState('')
  const [scoringPreset, setScoringPreset] = useState<ScoringPreset>(DEFAULT_SCORING.preset)
  const [pointsExact, setPointsExact] = useState(DEFAULT_SCORING.exact)
  const [pointsWinner, setPointsWinner] = useState(DEFAULT_SCORING.winner)
  const [pointsPenalty, setPointsPenalty] = useState(DEFAULT_SCORING.penalty)
  const [pointsClassified, setPointsClassified] = useState(DEFAULT_SCORING.classified)
  const [predictionsVisibility, setPredictionsVisibility] = useState<'hidden' | 'public'>('hidden')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [created, setCreated] = useState<CreatedGroup | null>(null)

  const formInstanceRef = useRef(0)
  const inFlightRef = useRef(false)

  const preferredCompetition = preferredCompetitionSlug
    ? competitions.find((c) => c.slug === preferredCompetitionSlug)
    : undefined
  const competitionId = chosenCompetitionId || (preferredCompetition ?? competitions[0])?.id || ''
  const preferredCompetitionUnavailable =
    Boolean(preferredCompetitionSlug) && competitions.length > 0 && !preferredCompetition

  const showPenaltyField =
    competitions.find((c) => c.id === competitionId)?.has_penalty_phases === true

  const competitionsError =
    isOpen && competitionsQuery.isError && !competitionsQuery.isFetching
      ? 'Não foi possível carregar as competições'
      : null
  const displayError = error ?? competitionsError

  function reset() {
    formInstanceRef.current += 1
    inFlightRef.current = false
    setName('')
    setCompetitionId('')
    setScoringPreset(DEFAULT_SCORING.preset)
    setPointsExact(DEFAULT_SCORING.exact)
    setPointsWinner(DEFAULT_SCORING.winner)
    setPointsPenalty(DEFAULT_SCORING.penalty)
    setPointsClassified(DEFAULT_SCORING.classified)
    setPredictionsVisibility('hidden')
    setError(null)
    setCreated(null)
    setSubmitting(false)
  }

  function handleClose() {
    reset()
    onClose()
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlightRef.current) return

    if (pointsExact > 0 && pointsExact < pointsWinner) {
      setError('Pontos por placar exato deve ser maior ou igual a pontos por vencedor')
      return
    }
    if (pointsExact + pointsWinner === 0) {
      setError('Pelo menos um tipo de pontuação deve ser maior que zero')
      return
    }

    const instance = formInstanceRef.current
    const isCurrent = () => formInstanceRef.current === instance
    inFlightRef.current = true
    setError(null)
    setSubmitting(true)

    try {
      const res = await apiFetch(buildApiUrl('/groups'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          competition_id: competitionId,
          points_exact: pointsExact,
          points_winner: pointsWinner,
          points_penalty: showPenaltyField ? pointsPenalty : 1,
          points_classified: showPenaltyField ? pointsClassified : 0,
          predictions_visibility: predictionsVisibility,
        }),
      })

      if (!res.ok) {
        const message = await readApiError(res, 'Erro ao criar grupo')
        if (isCurrent()) setError(message)
        return
      }
      const data = (await res.json()) as { group?: CreatedGroup }

      const origem = getGuideOrigin()
      if (origem) trackEvent('submit_criar_grupo', { origem })
      else trackEvent('submit_criar_grupo')
      if (isCurrent()) setCreated(data.group!)
      onCreated(data.group!)
    } catch (err) {
      console.error('Fetch caught error:', err)
      if (isCurrent()) setError(CONNECTION_ERROR)
    } finally {
      if (isCurrent()) {
        inFlightRef.current = false
        setSubmitting(false)
      }
    }
  }

  return {
    competitions,
    competitionGroups,
    loadingCompetitions,
    name,
    setName,
    competitionId,
    setCompetitionId,
    preferredCompetitionUnavailable,
    scoringPreset,
    setScoringPreset,
    pointsExact,
    setPointsExact,
    pointsWinner,
    setPointsWinner,
    pointsClassified,
    setPointsClassified,
    pointsPenalty,
    setPointsPenalty,
    predictionsVisibility,
    setPredictionsVisibility,
    submitting,
    error: displayError,
    created,
    showPenaltyField,
    handleClose,
    handleSubmit,
  }
}

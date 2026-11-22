import { useEffect, useRef, useState } from 'react'
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

export function useCreateGroupForm({
  isOpen,
  onClose,
  onCreated,
  preferredCompetitionSlug,
}: UseCreateGroupFormProps) {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [competitionGroups, setCompetitionGroups] = useState<CompetitionSelectGroups>({
    ongoing: [],
    upcoming: [],
  })
  const [loadingCompetitions, setLoadingCompetitions] = useState(false)

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

  useEffect(() => {
    if (!isOpen || competitions.length > 0) return
    setLoadingCompetitions(true)
    apiFetch(buildApiUrl('/competitions'))
      .then((r) => r.json() as Promise<{ competitions: Competition[] }>)
      .then((data) => {
        const { list, groups } = selectableCompetitions(data.competitions)
        setCompetitions(list)
        setCompetitionGroups(groups)
      })
      .catch(() => setError('Não foi possível carregar as competições'))
      .finally(() => setLoadingCompetitions(false))
  }, [isOpen, competitions.length])

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
    error,
    created,
    showPenaltyField,
    handleClose,
    handleSubmit,
  }
}

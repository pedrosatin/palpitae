import { useEffect, useState } from 'react'
import { config } from '../../../config'
import { trackEvent } from '../../../analytics/ga'
import { apiFetch } from '../../../lib/api'
import { ScoringPreset } from '../constants'
import { Competition, CreatedGroup } from '../types'

interface UseCreateGroupFormProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (group: CreatedGroup) => void
}

export function validateScoringRules(pointsExact: number, pointsWinner: number): string | null {
  if (pointsExact > 0 && pointsExact < pointsWinner) {
    return 'Pontos por placar exato deve ser maior ou igual a pontos por vencedor'
  }
  if (pointsExact + pointsWinner === 0) {
    return 'Pelo menos um tipo de pontuação deve ser maior que zero'
  }
  return null
}

export function buildGroupPayload(params: {
  name: string
  competitionId: string
  pointsExact: number
  pointsWinner: number
  pointsPenalty: number
  showPenaltyField: boolean
  predictionsVisibility: 'hidden' | 'public'
}) {
  return {
    name: params.name.trim(),
    competition_id: params.competitionId,
    points_exact: params.pointsExact,
    points_winner: params.pointsWinner,
    points_penalty: params.showPenaltyField ? params.pointsPenalty : 1,
    predictions_visibility: params.predictionsVisibility,
  }
}

export function useCreateGroupForm({ isOpen, onClose, onCreated }: UseCreateGroupFormProps) {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [loadingCompetitions, setLoadingCompetitions] = useState(false)

  const [name, setName] = useState('')
  const [competitionId, setCompetitionId] = useState('')
  const [scoringPreset, setScoringPreset] = useState<ScoringPreset>('classic')
  const [pointsExact, setPointsExact] = useState(3)
  const [pointsWinner, setPointsWinner] = useState(1)
  const [pointsPenalty, setPointsPenalty] = useState(1)
  const [predictionsVisibility, setPredictionsVisibility] = useState<'hidden' | 'public'>('hidden')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [created, setCreated] = useState<CreatedGroup | null>(null)

  // Bônus de pênalti só aparece quando a competição escolhida tem fases que vão a
  // pênalti em jogo único (Decisão 4) — senão o campo não faz sentido.
  const showPenaltyField =
    competitions.find((c) => c.id === competitionId)?.has_penalty_phases === true

  useEffect(() => {
    if (!isOpen || competitions.length > 0) return
    setLoadingCompetitions(true)
    fetch(`${config.apiUrl}/competitions`)
      .then((r) => r.json() as Promise<{ competitions: Competition[] }>)
      .then((data) => {
        setCompetitions(data.competitions)
        if (data.competitions.length > 0) {
          setCompetitionId(data.competitions[0].id)
        }
      })
      .catch(() => setError('Não foi possível carregar as competições'))
      .finally(() => setLoadingCompetitions(false))
  }, [isOpen, competitions.length])

  function reset() {
    setName('')
    setCompetitionId(competitions[0]?.id ?? '')
    setScoringPreset('classic')
    setPointsExact(3)
    setPointsWinner(1)
    setPointsPenalty(1)
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

    const validationError = validateScoringRules(pointsExact, pointsWinner)
    if (validationError) {
      setError(validationError)
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      const payload = buildGroupPayload({
        name,
        competitionId,
        pointsExact,
        pointsWinner,
        pointsPenalty,
        showPenaltyField,
        predictionsVisibility,
      })

      const res = await apiFetch(`${config.apiUrl}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = (await res.json()) as {
        group?: CreatedGroup
        error?: string
      }

      if (!res.ok) {
        setError(data.error ?? 'Erro ao criar grupo')
        return
      }

      trackEvent('submit_criar_grupo')
      setCreated(data.group!)
      onCreated(data.group!)
    } catch (err) {
      console.error('Fetch caught error:', err)
      setError('Erro de conexão. Tente novamente.')
    } finally {
      setSubmitting(false)
    }
  }

  return {
    competitions,
    loadingCompetitions,
    name,
    setName,
    competitionId,
    setCompetitionId,
    scoringPreset,
    setScoringPreset,
    pointsExact,
    setPointsExact,
    pointsWinner,
    setPointsWinner,
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

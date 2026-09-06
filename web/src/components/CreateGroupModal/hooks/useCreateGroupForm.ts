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

    if (pointsExact > 0 && pointsExact < pointsWinner) {
      setError('Pontos por placar exato deve ser maior ou igual a pontos por vencedor')
      return
    }
    if (pointsExact + pointsWinner === 0) {
      setError('Pelo menos um tipo de pontuação deve ser maior que zero')
      return
    }

    setError(null)
    setSubmitting(true)

    try {
      const res = await apiFetch(`${config.apiUrl}/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          competition_id: competitionId,
          points_exact: pointsExact,
          points_winner: pointsWinner,
          points_penalty: showPenaltyField ? pointsPenalty : 1,
          predictions_visibility: predictionsVisibility,
        }),
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

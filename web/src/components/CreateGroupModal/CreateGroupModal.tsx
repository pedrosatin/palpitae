import { useEffect, useState } from 'react'
import { config } from '../../config'
import { trackEvent } from '../../analytics/ga'
import { apiFetch } from '../../lib/api'
import Button from '../Button'
import Modal from '../Modal'
import Select from '../Select'
import styles from './CreateGroupModal.module.css'
import shared from '../modal-shared.module.css'
import CreateGroupSuccessView from './components/CreateGroupSuccessView'
import ScoringRulesField from './components/ScoringRulesField'
import VisibilityField from './components/VisibilityField'
import { ScoringPreset } from './constants'

interface Competition {
  id: string
  name: string
  slug: string
  season: string | null
  status: string
  /** True when the competition has knockout phases that decide on penalties. */
  has_penalty_phases?: boolean
}

export interface CreatedGroup {
  id: string
  name: string
  invite_code: string
}

interface CreateGroupModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (group: CreatedGroup) => void
}

export default function CreateGroupModal({
  isOpen,
  onClose,
  onCreated,
}: CreateGroupModalProps) {
  const [competitions, setCompetitions] = useState<Competition[]>([])
  const [loadingCompetitions, setLoadingCompetitions] = useState(false)

  const [name, setName] = useState('')
  const [competitionId, setCompetitionId] = useState('')
  const [scoringPreset, setScoringPreset] = useState<ScoringPreset>('classic')
  const [pointsExact, setPointsExact] = useState(3)
  const [pointsWinner, setPointsWinner] = useState(1)
  const [pointsPenalty, setPointsPenalty] = useState(1)
  const [predictionsVisibility, setPredictionsVisibility] = useState<
    'hidden' | 'public'
  >('hidden')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [created, setCreated] = useState<CreatedGroup | null>(null)

  // Bônus de pênalti só aparece quando a competição escolhida tem fases que vão a
  // pênalti em jogo único (Decisão 4) — senão o campo não faz sentido.
  const showPenaltyField =
    competitions.find((c) => c.id === competitionId)?.has_penalty_phases ===
    true

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
      setError(
        'Pontos por placar exato deve ser maior ou igual a pontos por vencedor',
      )
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

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Criar grupo">
      {created ? (
        <CreateGroupSuccessView created={created} onClose={handleClose} />
      ) : (
        <form onSubmit={handleSubmit} className={shared.form}>
          {error && <p className={shared.error}>{error}</p>}

          <div className={shared.field}>
            <label className={shared.label} htmlFor="group-name">
              Nome do grupo
            </label>
            <input
              id="group-name"
              className={shared.input}
              type="text"
              placeholder="Ex: Os Craques do Bairro"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              required
              autoFocus
            />
          </div>

          <div className={shared.field}>
            <label className={shared.label} htmlFor="group-competition">
              Competição
            </label>
            {loadingCompetitions ? (
              <p className={styles.loadingText}>Carregando competições...</p>
            ) : competitions.length === 0 ? (
              <p className={styles.emptyText}>
                Nenhuma competição disponível no momento.
              </p>
            ) : (
              <Select
                id="group-competition"
                value={competitionId}
                onChange={(e) => setCompetitionId(e.target.value)}
                required
              >
                {competitions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.season ? ` ${c.season}` : ''}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <ScoringRulesField
            scoringPreset={scoringPreset}
            setScoringPreset={setScoringPreset}
            pointsExact={pointsExact}
            setPointsExact={setPointsExact}
            pointsWinner={pointsWinner}
            setPointsWinner={setPointsWinner}
            pointsPenalty={pointsPenalty}
            setPointsPenalty={setPointsPenalty}
            showPenaltyField={showPenaltyField}
          />

          <VisibilityField
            predictionsVisibility={predictionsVisibility}
            setPredictionsVisibility={setPredictionsVisibility}
          />

          <div className={shared.actions}>
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || !name.trim() || !competitionId}
            >
              {submitting ? 'Criando...' : 'Criar grupo'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}

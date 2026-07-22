import Button from '../Button'
import Modal from '../Modal'
import Select from '../Select'
import styles from './CreateGroupModal.module.css'
import shared from '../modal-shared.module.css'
import CreateGroupSuccessView from './components/CreateGroupSuccessView'
import ScoringRulesField from './components/ScoringRulesField'
import VisibilityField from './components/VisibilityField'
import { useCreateGroupForm } from './hooks/useCreateGroupForm'

export interface Competition {
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

export default function CreateGroupModal({ isOpen, onClose, onCreated }: CreateGroupModalProps) {
  const {
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
  } = useCreateGroupForm({ isOpen, onClose, onCreated })

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
              maxLength={30}
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
              <p className={styles.emptyText}>Nenhuma competição disponível no momento.</p>
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
            <Button type="button" variant="secondary" onClick={handleClose} disabled={submitting}>
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

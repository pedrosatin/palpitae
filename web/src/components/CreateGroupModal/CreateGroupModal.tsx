import Button from '../Button'
import Modal from '../Modal'
import Select from '../Select'
import styles from './CreateGroupModal.module.css'
import shared from '../modal-shared.module.css'
import CreateGroupSuccessView from './components/CreateGroupSuccessView'
import ScoringRulesField from './components/ScoringRulesField'
import VisibilityField from './components/VisibilityField'
import { useCreateGroupForm } from './hooks/useCreateGroupForm'
import type { Competition, CreatedGroup } from './types'

interface CreateGroupModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: (group: CreatedGroup) => void
  /** Slug da competição que vem escolhida no select, pedido pelo link de um guia. */
  preferredCompetitionSlug?: string
}

const UNAVAILABLE_HINT_ID = 'group-competition-unavailable'

export default function CreateGroupModal({
  isOpen,
  onClose,
  onCreated,
  preferredCompetitionSlug,
}: CreateGroupModalProps) {
  const {
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
  } = useCreateGroupForm({ isOpen, onClose, onCreated, preferredCompetitionSlug })

  // Grupos já calculados no hook no carregamento (fonte única de verdade);
  // sem um dos grupos não há <optgroup> — um título sozinho só adicionaria ruído.
  const groups = competitionGroups
  const hasBothGroups = groups.ongoing.length > 0 && groups.upcoming.length > 0
  const selected = competitions.find((c) => c.id === competitionId)
  const selectedOngoing = selected?.status === 'ongoing'

  function renderOptions(list: Competition[]) {
    return list.map((c) => (
      <option key={c.id} value={c.id}>
        {c.name}
        {c.season ? ` ${c.season}` : ''}
      </option>
    ))
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Criar grupo" analyticsId="criar_grupo">
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
                aria-describedby={preferredCompetitionUnavailable ? UNAVAILABLE_HINT_ID : undefined}
                required
              >
                {hasBothGroups ? (
                  <>
                    <optgroup label="Em andamento">{renderOptions(groups.ongoing)}</optgroup>
                    <optgroup label="Em breve">{renderOptions(groups.upcoming)}</optgroup>
                  </>
                ) : (
                  renderOptions(competitions)
                )}
              </Select>
            )}
            {preferredCompetitionUnavailable && (
              <p id={UNAVAILABLE_HINT_ID} role="status" className={styles.statusHint}>
                A competição do link ainda não está disponível. Escolha outra na lista.
              </p>
            )}
            {selectedOngoing && (
              <p role="status" className={styles.statusHint}>
                Esse campeonato já começou — dá para criar o grupo e palpitar as rodadas que
                faltam.
              </p>
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

          {showPenaltyField && (
            <div className={shared.field}>
              <label className={shared.label} htmlFor="points-classified">
                Bônus classificado
              </label>
              <input
                id="points-classified"
                className={shared.input}
                type="number"
                min={0}
                max={10}
                step={1}
                value={pointsClassified}
                onChange={(e) => setPointsClassified(Number(e.target.value))}
              />
              <p>
                Por acertar quem avança no jogo decisivo. Em ida e volta, considera seus dois
                palpites. 0 desliga.
              </p>
            </div>
          )}

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

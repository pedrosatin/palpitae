import { trackEvent } from '../../../analytics/ga'
import InfoHint from '../../InfoHint/InfoHint'
import styles from '../CreateGroupModal.module.css'
import shared from '../../modal-shared.module.css'
import {
  PRESET_LABELS,
  PRESET_VALUES,
  SCORING_HELP_TEXT,
  ScoringPreset,
} from '../constants'

interface ScoringRulesFieldProps {
  scoringPreset: ScoringPreset
  setScoringPreset: (preset: ScoringPreset) => void
  pointsExact: number
  setPointsExact: (points: number) => void
  pointsWinner: number
  setPointsWinner: (points: number) => void
  pointsPenalty: number
  setPointsPenalty: (points: number) => void
  showPenaltyField: boolean
}

export default function ScoringRulesField({
  scoringPreset,
  setScoringPreset,
  pointsExact,
  setPointsExact,
  pointsWinner,
  setPointsWinner,
  pointsPenalty,
  setPointsPenalty,
  showPenaltyField,
}: ScoringRulesFieldProps) {
  function handlePreset(preset: ScoringPreset) {
    trackEvent('click_create_group_preset_selecionado', { preset })
    setScoringPreset(preset)
    if (preset !== 'custom') {
      setPointsExact(PRESET_VALUES[preset].exact)
      setPointsWinner(PRESET_VALUES[preset].winner)
      setPointsPenalty(PRESET_VALUES[preset].penalty)
    }
  }

  return (
    <div className={shared.field}>
      <span className={shared.label}>Regras de pontuação</span>
      <div className={styles.presetGrid}>
        {(
          ['classic', 'exact_only', 'winner_only', 'custom'] as ScoringPreset[]
        ).map((preset) => (
          <button
            key={preset}
            type="button"
            className={`${styles.presetBtn} ${scoringPreset === preset ? styles.presetBtnActive : ''}`}
            onClick={() => handlePreset(preset)}
            aria-pressed={scoringPreset === preset}
          >
            {PRESET_LABELS[preset]}
          </button>
        ))}
      </div>
      <div className={styles.pointsRow}>
        <div className={styles.pointsField}>
          <InfoHint
            label="Placar exato"
            labelSide="left"
            htmlFor="points-exact"
            text={SCORING_HELP_TEXT.exact}
            onOpen={() =>
              trackEvent('click_create_group_ajuda_pontuacao', {
                campo: 'exact',
              })
            }
          />
          <input
            id="points-exact"
            className={styles.pointsInput}
            type="number"
            min={0}
            max={10}
            value={pointsExact}
            disabled={scoringPreset !== 'custom'}
            onChange={(e) =>
              setPointsExact(
                Math.max(0, Math.min(10, Math.floor(Number(e.target.value)))),
              )
            }
          />
        </div>
        <div className={styles.pointsField}>
          <InfoHint
            label="Vencedor"
            labelSide="left"
            htmlFor="points-winner"
            text={SCORING_HELP_TEXT.winner}
            onOpen={() =>
              trackEvent('click_create_group_ajuda_pontuacao', {
                campo: 'winner',
              })
            }
          />
          <input
            id="points-winner"
            className={styles.pointsInput}
            type="number"
            min={0}
            max={10}
            value={pointsWinner}
            disabled={scoringPreset !== 'custom'}
            onChange={(e) =>
              setPointsWinner(
                Math.max(0, Math.min(10, Math.floor(Number(e.target.value)))),
              )
            }
          />
        </div>
      </div>
      {showPenaltyField && (
        <div className={styles.pointsRow}>
          <div className={styles.pointsField}>
            <label className={styles.pointsLabel} htmlFor="points-penalty">
              Bônus pênalti
            </label>
            <input
              id="points-penalty"
              className={styles.pointsInput}
              type="number"
              min={0}
              max={10}
              value={pointsPenalty}
              disabled={scoringPreset !== 'custom'}
              onChange={(e) =>
                setPointsPenalty(
                  Math.max(0, Math.min(10, Math.floor(Number(e.target.value)))),
                )
              }
            />
          </div>
          <p className={styles.penaltyHint}>
            Pontos extras por acertar quem vence nos pênaltis num palpite de
            empate. 0 desliga.
          </p>
        </div>
      )}
    </div>
  )
}

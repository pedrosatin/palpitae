import type { usePredictionsTab } from './usePredictionsTab'
import styles from './PredictionsTab.module.css'

type ReplicateProps = Pick<
  ReturnType<typeof usePredictionsTab>,
  | 'replicateTargets'
  | 'replicateEnabled'
  | 'replicating'
  | 'replicateFeedback'
  | 'handleReplicateToggle'
> & { showOption: boolean }

/**
 * Opção "Aplicar também em" com os nomes dos grupos onde o palpite será gravado,
 * visíveis antes de salvar. A confirmação aparece depois do envio.
 */
export default function PredictionsReplicateBar({
  replicateTargets,
  replicateEnabled,
  replicating,
  replicateFeedback,
  handleReplicateToggle,
  showOption,
}: ReplicateProps) {
  if (replicateTargets.length === 0) return null
  const feedback = replicateFeedback
  if (!showOption && !feedback) return null
  return (
    <div className={styles.replicateBar}>
      {showOption && (
        <label className={styles.replicateOption}>
          <input
            type="checkbox"
            className={styles.replicateCheckbox}
            checked={replicateEnabled}
            onChange={(e) => handleReplicateToggle(e.target.checked)}
          />
          <span>Aplicar também em: {replicateTargets.map((g) => g.name).join(', ')}</span>
        </label>
      )}
      <div role="status" aria-live="polite">
        {replicating && (
          <span className={styles.replicateInfo}>Aplicando nos outros grupos...</span>
        )}
        {!replicating && feedback && (
          <span className={feedback.ok ? styles.importSuccess : styles.importError}>
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  )
}

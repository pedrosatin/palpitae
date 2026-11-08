import type { usePredictionsTab } from './usePredictionsTab'
import styles from './PredictionsTab.module.css'

type ReplicateProps = Pick<
  ReturnType<typeof usePredictionsTab>,
  'replicateTargets' | 'replicateOverflow' | 'replicateEnabled' | 'handleReplicateToggle'
> & { showOption: boolean }

/**
 * Opção "Aplicar também em" com os nomes dos grupos onde o palpite será gravado,
 * visíveis antes de salvar. A confirmação fica na barra fixa de "Salvar todos".
 */
export default function PredictionsReplicateBar({
  replicateTargets,
  replicateOverflow,
  replicateEnabled,
  handleReplicateToggle,
  showOption,
}: ReplicateProps) {
  if (replicateTargets.length === 0 || !showOption) return null
  return (
    <div className={styles.replicateBar}>
      <label className={styles.replicateOption}>
        <input
          type="checkbox"
          className={styles.replicateCheckbox}
          checked={replicateEnabled}
          onChange={(e) => handleReplicateToggle(e.target.checked)}
        />
        <span>Aplicar também em: {replicateTargets.map((g) => g.name).join(', ')}</span>
      </label>
      {replicateOverflow > 0 && (
        <span className={styles.replicateInfo}>
          O limite é de {replicateTargets.length} grupos por vez.{' '}
          {replicateOverflow === 1
            ? '1 grupo fica de fora.'
            : `${replicateOverflow} grupos ficam de fora.`}
        </span>
      )}
    </div>
  )
}

import Button from '../Button'
import type { usePredictionsTab } from './usePredictionsTab'
import styles from './PredictionsTab.module.css'

type SaveAllProps = Pick<
  ReturnType<typeof usePredictionsTab>,
  | 'showSaveBar'
  | 'replicating'
  | 'replicateFeedback'
  | 'canRetryReplicate'
  | 'retryReplicate'
  | 'bulkError'
  | 'savedAll'
  | 'handleSaveAll'
  | 'pendingCount'
  | 'savingAll'
>

function saveAllLabel(savingAll: boolean, savedAll: boolean, pendingCount: number) {
  if (savingAll) return 'Salvando...'
  if (savedAll) return 'Tudo salvo!'
  if (pendingCount > 0) return `Salvar todos (${pendingCount})`
  return 'Salvar todos'
}

export default function SaveAllBar({
  showSaveBar,
  replicating,
  replicateFeedback,
  canRetryReplicate,
  retryReplicate,
  bulkError,
  savedAll,
  handleSaveAll,
  pendingCount,
  savingAll,
}: SaveAllProps) {
  if (!showSaveBar) return null

  return (
    <div className={styles.saveAllBar} data-save-all-bar>
      <div className={styles.saveAllStatus} aria-live="polite">
        {replicating && (
          <span className={styles.replicateInfo}>Aplicando nos outros grupos...</span>
        )}
        {replicateFeedback.map((f) => (
          <span key={f.id} className={f.ok ? styles.importSuccess : styles.importError}>
            {f.message}
          </span>
        ))}
        {canRetryReplicate && (
          <button type="button" className={styles.retryLink} onClick={retryReplicate}>
            Tentar de novo
          </button>
        )}
      </div>
      {bulkError && <span className={styles.error}>{bulkError}</span>}
      <Button
        size="sm"
        className={`${styles.saveAllBtn} ${savedAll ? styles.saveAllBtnSaved : ''}`}
        onClick={handleSaveAll}
        disabled={pendingCount === 0 || savingAll}
      >
        {saveAllLabel(savingAll, savedAll, pendingCount)}
      </Button>
    </div>
  )
}

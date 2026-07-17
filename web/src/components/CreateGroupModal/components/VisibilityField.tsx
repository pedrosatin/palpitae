import { trackEvent } from '../../../analytics/ga'
import styles from '../CreateGroupModal.module.css'

interface VisibilityFieldProps {
  predictionsVisibility: 'hidden' | 'public'
  setPredictionsVisibility: (visibility: 'hidden' | 'public') => void
}

export default function VisibilityField({
  predictionsVisibility,
  setPredictionsVisibility,
}: VisibilityFieldProps) {
  function handleVisibility(visibility: 'hidden' | 'public') {
    trackEvent(
      visibility === 'public'
        ? 'click_create_group_visibilidade_publica'
        : 'click_create_group_visibilidade_oculta',
    )
    setPredictionsVisibility(visibility)
  }

  return (
    <div className={styles.field}>
      <span className={styles.label}>Visibilidade dos palpites</span>
      <div className={styles.visibilityGroup}>
        <button
          type="button"
          className={`${styles.visibilityOption} ${predictionsVisibility === 'hidden' ? styles.visibilityOptionActive : ''}`}
          onClick={() => handleVisibility('hidden')}
          aria-pressed={predictionsVisibility === 'hidden'}
        >
          <span className={styles.visibilityTitle}>Oculto até palpitar</span>
          <span className={styles.visibilityDesc}>
            Outros palpites só aparecem depois que você palpitar ou o jogo começar
          </span>
        </button>
        <button
          type="button"
          className={`${styles.visibilityOption} ${predictionsVisibility === 'public' ? styles.visibilityOptionActive : ''}`}
          onClick={() => handleVisibility('public')}
          aria-pressed={predictionsVisibility === 'public'}
        >
          <span className={styles.visibilityTitle}>Sempre visível</span>
          <span className={styles.visibilityDesc}>
            Todos veem os palpites em tempo real
          </span>
        </button>
      </div>
    </div>
  )
}

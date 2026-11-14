import Button from '../Button'
import Modal, { type ModalAnalyticsId } from '../Modal'
import styles from './ConfirmModal.module.css'

interface ConfirmModalProps {
  isOpen: boolean
  title?: string
  analyticsId?: ModalAnalyticsId
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmModal({
  isOpen,
  title = 'Confirmar',
  analyticsId = 'confirmacao',
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} analyticsId={analyticsId}>
      <p className={styles.message}>{message}</p>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button
          variant="primary"
          className={danger ? styles.danger : undefined}
          onClick={onConfirm}
          disabled={loading}
        >
          {loading ? 'Aguarde…' : confirmLabel}
        </Button>
      </div>
    </Modal>
  )
}

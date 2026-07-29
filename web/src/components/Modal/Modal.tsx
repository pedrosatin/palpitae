import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { trackEvent } from '../../analytics/ga'
import styles from './Modal.module.css'
import Button from '../Button'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  useEffect(() => {
    if (!isOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            className={styles.closeBtn}
            onClick={() => {
              trackEvent('click_modal_fechar', { modal: title })
              onClose()
            }}
            aria-label="Fechar"
          >
            X
          </Button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  )
}

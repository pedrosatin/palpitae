import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { trackEvent } from '../../analytics/ga'
import styles from './Modal.module.css'
import Button from '../Button'

export type ModalAnalyticsId =
  | 'palpites_membro'
  | 'confirmacao'
  | 'criar_grupo'
  | 'entrar_grupo'
  | 'regras_grupo'
  | 'compartilhar_resultado'
  | 'configurar_grupo'
  | 'lembretes_palpite'
  | 'jogos_grupo'

interface ModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  analyticsId: ModalAnalyticsId
  children: ReactNode
}

export default function Modal({ isOpen, onClose, title, analyticsId, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)

  // O autoFocus de um campo roda no commit, antes de qualquer efeito. Só durante o
  // render o foco ainda está no elemento que abriu o modal.
  const openerRef = useRef<HTMLElement | null>(null)
  const wasOpenRef = useRef(false)
  if (isOpen && !wasOpenRef.current) {
    openerRef.current = document.activeElement as HTMLElement | null
  }
  wasOpenRef.current = isOpen

  // Leva o foco para dentro do diálogo, se nenhum campo já o pediu, e o devolve ao fechar.
  useEffect(() => {
    if (!isOpen) return
    const dialog = dialogRef.current
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus()
    const opener = openerRef.current
    return () => opener?.focus({ preventScroll: true })
  }, [isOpen])

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
      <div
        className={styles.modal}
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            className={styles.closeBtn}
            onClick={() => {
              trackEvent('click_modal_fechar', { modal: analyticsId })
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

import type { ReactNode } from 'react'
import styles from './ErrorState.module.css'

interface ErrorStateProps {
  /** Message to show. Defaults to a generic load failure. Ignored if children given. */
  message?: string
  /** Rich content (e.g. a retry button alongside the text). Overrides `message`. */
  children?: ReactNode
  /** Extra class on the wrapper (e.g. spacing tweaks per tab). */
  className?: string
}

/**
 * Standard error banner shown when a tab or page fails to load.
 *
 * Single source of truth for the "erro ao carregar" look so every surface
 * (Palpitar, Grupo, Ranking, Membros...) reads the same — a surface card with
 * a red left accent, not bare orange text on some screens and a card on others.
 */
export default function ErrorState({
  message = 'Erro ao carregar. Tente novamente.',
  children,
  className,
}: ErrorStateProps) {
  return (
    <div role="alert" className={className ? `${styles.error} ${className}` : styles.error}>
      {children ?? message}
    </div>
  )
}

import type { ReactNode } from 'react'
import styles from './Tooltip.module.css'

interface TooltipProps {
  id: string
  /** Classe de posicionamento do componente que usa o tooltip. */
  className?: string
  children: ReactNode
}

/** Balão de tooltip com o visual compartilhado por `InfoHint` e `PenaltyBadge`. */
export default function Tooltip({ id, className, children }: TooltipProps) {
  return (
    <span role="tooltip" id={id} className={`${styles.tooltip} ${className ?? ''}`}>
      {children}
    </span>
  )
}

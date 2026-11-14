import Tooltip from '../Tooltip/Tooltip'
import { useTooltip } from '../Tooltip/useTooltip'
import styles from './PenaltyBadge.module.css'

/** Shared shootout ball mark — used wherever a penalty winner is shown. */
export function BallIcon({ className }: { className?: string }) {
  return (
    <span className={className} aria-hidden="true">
      ⚽
    </span>
  )
}

interface PenaltyBadgeProps {
  /** Short name of the team predicted/decided to win on penalties. */
  team: string
  /** Texto do tooltip, aberto por clique, toque, Enter ou Espaço. */
  tooltip: string
  /** `subtle` for read-only lists, `accent` for an editable pick chip. */
  variant?: 'subtle' | 'accent'
  /**
   * Quando informado, o clique executa esta ação e o chip não tem tooltip; o
   * texto fica só no `aria-label`. Usado pelo chip editável para reabrir a escolha.
   */
  onActivate?: () => void
  disabled?: boolean
  /** Applied to the root so callers can place it (e.g. margin-left: auto). */
  className?: string
}

export default function PenaltyBadge({
  team,
  tooltip,
  variant = 'subtle',
  onActivate,
  disabled,
  className,
}: PenaltyBadgeProps) {
  const { open, toggle, containerRef, tooltipId, triggerProps } = useTooltip()

  function handleClick() {
    if (onActivate) onActivate()
    else toggle()
  }

  return (
    <span className={`${styles.container} ${className ?? ''}`} ref={containerRef}>
      <button
        type="button"
        className={`${styles.badge} ${variant === 'accent' ? styles.accent : styles.subtle}`}
        onClick={handleClick}
        disabled={disabled}
        aria-label={`Pênaltis: ${team}. ${tooltip}`}
        {...(onActivate ? {} : triggerProps)}
      >
        <BallIcon />
        {team}
      </button>
      {open && (
        <Tooltip id={tooltipId} className={styles.tooltip}>
          {tooltip}
        </Tooltip>
      )}
    </span>
  )
}

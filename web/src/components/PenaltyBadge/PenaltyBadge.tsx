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
  team: string
  tooltip: string
  variant?: 'subtle' | 'accent'
  onActivate?: () => void
  disabled?: boolean
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

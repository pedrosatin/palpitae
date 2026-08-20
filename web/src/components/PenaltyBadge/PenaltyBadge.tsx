import { useEffect, useRef, useState } from 'react'
import styles from './PenaltyBadge.module.css'

export const TOOLTIP_TIMEOUT_MS = 4000

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
  /** Explanatory text shown in the tooltip (hover, focus, or tap). */
  tooltip: string
  /** `subtle` for read-only lists, `accent` for an editable pick chip. */
  variant?: 'subtle' | 'accent'
  /**
   * When set, a click runs this instead of toggling the tooltip (the tooltip
   * still opens on hover/focus). Used by the editable chip to re-open the pick.
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
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  // Auto-dismiss a tapped-open tooltip, mirroring InfoHint.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setOpen(false), TOOLTIP_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function handleClick() {
    if (onActivate) onActivate()
    else setOpen((v) => !v)
  }

  return (
    <span className={`${styles.container} ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        className={`${styles.badge} ${variant === 'accent' ? styles.accent : styles.subtle}`}
        onClick={handleClick}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        disabled={disabled}
        aria-label={`Pênaltis: ${team}. ${tooltip}`}
      >
        <BallIcon />
        {team}
      </button>
      {open && (
        <span role="tooltip" className={styles.tooltip}>
          {tooltip}
        </span>
      )}
    </span>
  )
}

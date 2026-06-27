import { useEffect, useRef, useState } from 'react'
import styles from './InfoHint.module.css'

interface InfoHintProps {
  label: string
  text: string
  /** Which side the label text appears relative to the icon. Default: 'right'. */
  labelSide?: 'left' | 'right'
  /** When set, the label text renders as a <label> element associated with this input id. */
  htmlFor?: string
  /** Called once when the tooltip opens — use for analytics. */
  onOpen?: () => void
}

function InfoSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ display: 'block' }}>
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="5" r="0.9" fill="currentColor" />
      <path d="M8 7.4v3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export default function InfoHint({
  label,
  text,
  labelSide = 'right',
  htmlFor,
  onOpen,
}: InfoHintProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => setOpen(false), 4000)
    return () => clearTimeout(t)
  }, [open])

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function toggle() {
    if (!open) onOpen?.()
    setOpen((v) => !v)
  }

  const LabelEl = htmlFor ? 'label' : 'button'
  const labelProps = htmlFor
    ? { htmlFor, onClick: toggle }
    : { type: 'button' as const, onClick: toggle }

  const labelNode = (
    <LabelEl className={styles.labelText} {...labelProps}>
      {label}
    </LabelEl>
  )

  return (
    <span className={styles.container} ref={containerRef}>
      {labelSide === 'left' && labelNode}
      <button
        type="button"
        className={`${styles.iconBtn} ${open ? styles.iconBtnOpen : ''}`}
        onClick={toggle}
        aria-label={label}
        aria-expanded={open}
      >
        <InfoSvg />
      </button>
      {labelSide === 'right' && labelNode}
      {open && (
        <span role="tooltip" className={styles.tooltip}>
          {text}
        </span>
      )}
    </span>
  )
}

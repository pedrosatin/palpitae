import { useEffect, useId, useRef, useState } from 'react'
import { TOOLTIP_TIMEOUT_MS, useAutoClose } from '../../hooks/useAutoClose'
import { useOutsideClick } from '../../hooks/useOutsideClick'

/**
 * Estado de um tooltip que abre por clique, toque, Enter ou Espaço no gatilho.
 * Fecha com Escape, clique fora ou sozinho após `TOOLTIP_TIMEOUT_MS`.
 */
export function useTooltip(onOpen?: () => void) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLSpanElement>(null)
  const tooltipId = useId()

  useAutoClose(open, () => setOpen(false), TOOLTIP_TIMEOUT_MS)
  useOutsideClick(containerRef, open, () => setOpen(false))

  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open])

  function toggle() {
    if (!open) onOpen?.()
    setOpen((v) => !v)
  }

  const triggerProps = {
    'aria-expanded': open,
    'aria-controls': open ? tooltipId : undefined,
    'aria-describedby': open ? tooltipId : undefined,
  }

  return { open, toggle, containerRef, tooltipId, triggerProps }
}

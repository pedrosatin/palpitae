import { useEffect, useRef } from 'react'

export const TOOLTIP_TIMEOUT_MS = 4000

/** Fecha automaticamente após `ms` milissegundos enquanto `open` estiver verdadeiro. */
export function useAutoClose(open: boolean, close: () => void, ms: number) {
  const closeRef = useRef(close)
  useEffect(() => {
    closeRef.current = close
  })

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => closeRef.current(), ms)
    return () => clearTimeout(timer)
  }, [open, ms])
}

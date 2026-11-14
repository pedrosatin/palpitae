import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

interface UseOutsideClickOptions {
  /** Quando verdadeiro, também fecha ao pressionar Escape. */
  closeOnEscape?: boolean
}

/**
 * Chama `onOutside` em `mousedown` fora de `ref` enquanto `active` estiver
 * verdadeiro. Opcionalmente fecha também ao pressionar `Escape`.
 */
export function useOutsideClick<T extends HTMLElement>(
  ref: RefObject<T | null>,
  active: boolean,
  onOutside: () => void,
  options?: UseOutsideClickOptions,
) {
  const closeOnEscape = options?.closeOnEscape ?? false
  const onOutsideRef = useRef(onOutside)
  useEffect(() => {
    onOutsideRef.current = onOutside
  })

  useEffect(() => {
    if (!active) return

    function handleMouseDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onOutsideRef.current()
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onOutsideRef.current()
      }
    }

    document.addEventListener('mousedown', handleMouseDown)
    if (closeOnEscape) {
      document.addEventListener('keydown', handleKeyDown)
    }

    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      if (closeOnEscape) {
        document.removeEventListener('keydown', handleKeyDown)
      }
    }
  }, [ref, active, closeOnEscape])
}

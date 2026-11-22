import { useEffect } from 'react'

/**
 * Pede confirmação ao fechar ou recarregar a aba enquanto `active` for
 * verdadeiro. O navegador mostra o próprio texto. Não há mensagem personalizada.
 */
export function useBeforeUnloadWarning(active: boolean) {
  useEffect(() => {
    if (!active) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
}

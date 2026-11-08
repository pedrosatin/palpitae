import { useEffect } from 'react'

/**
 * Pede confirmação ao fechar ou recarregar a aba enquanto `active` for
 * verdadeiro. O navegador mostra o texto padrão dele; o nosso é ignorado.
 */
export function useBeforeUnloadWarning(active: boolean) {
  useEffect(() => {
    if (!active) return
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault()
      // Chrome antigo e Safari só mostram o aviso com `returnValue` preenchido.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [active])
}

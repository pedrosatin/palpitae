import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { trackPageView } from './ga'
import { gaPageLocation, gaPageTitle } from './pageContext'

/**
 * Envia `page_view` em navegação interna com URL e título sem dados privados.
 * O primeiro carregamento fica por conta do `config` em `initGa`.
 */
export function useGaPageView(): void {
  const { pathname, search } = useLocation()
  const previous = useRef<{ pathname: string; location: string } | null>(null)

  useEffect(() => {
    const location = gaPageLocation({ origin: window.location.origin, pathname, search })
    const last = previous.current
    // O caminho cru entra na comparação porque dois grupos têm a mesma URL normalizada.
    if (last && (last.pathname !== pathname || last.location !== location)) {
      trackPageView(
        { page_location: location, page_title: gaPageTitle(pathname) },
        last.location,
      )
    }
    previous.current = { pathname, location }
  }, [pathname, search])
}

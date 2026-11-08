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
  const previous = useRef<{ key: string; location: string } | null>(null)

  useEffect(() => {
    const key = `${pathname}${search}`
    const location = gaPageLocation({ origin: window.location.origin, pathname, search })
    if (previous.current && previous.current.key !== key) {
      trackPageView(
        { page_location: location, page_title: gaPageTitle(pathname) },
        previous.current.location,
      )
    }
    previous.current = { key, location }
  }, [pathname, search])
}

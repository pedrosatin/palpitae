import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App'
import CookieConsent from './components/CookieConsent'
import { initGa } from './analytics/ga'
import { documentEntryPathname, rememberInviteDocument } from './lib/invite'
import { appQueryClient } from './lib/queryClient'

initGa()
rememberInviteDocument(documentEntryPathname())

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root element not found in document')

const landingPrerenderizada = rootEl.dataset.prerender === 'landing'

const tree = (
  <StrictMode>
    <QueryClientProvider client={appQueryClient}>
      <BrowserRouter>
        <App landingPrerenderizada={landingPrerenderizada} />
        <CookieConsent />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)

if (landingPrerenderizada) {
  hydrateRoot(rootEl, tree)
} else {
  createRoot(rootEl).render(tree)
}

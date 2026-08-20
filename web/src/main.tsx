import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/global.css'
import App from './App'
import CookieConsent from './components/CookieConsent'
import { initGa } from './analytics/ga'

// Registra o Consent Mode default (denied) e carrega o gtag.js antes do render.
// No-op quando VITE_GA_MEASUREMENT_ID não está configurado.
initGa()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('#root element not found in document')

/**
 * O build embute a landing dentro do `#root` (ver `scripts/prerender.mjs`) e
 * marca o elemento com `data-prerender="landing"`. O script inline no fim do
 * `index.html` remove esse conteúdo — e o atributo — quando a landing não é o
 * que o visitante deve ver (rota privada ou dispositivo com sessão conhecida).
 *
 * Então o atributo, aqui, significa exatamente "a landing já está na tela":
 *  - presente  → `hydrateRoot`, e o App pinta a landing sem esperar o /auth/me;
 *  - ausente   → `createRoot` normal, como antes do pré-render.
 *
 * Usar `createRoot` sobre HTML pré-renderizado faria o React descartar tudo e
 * remontar, desperdiçando o ganho de LCP — daí a distinção.
 */
const landingPrerenderizada = rootEl.dataset.prerender === 'landing'

const tree = (
  <StrictMode>
    <BrowserRouter>
      <App landingPrerenderizada={landingPrerenderizada} />
      <CookieConsent />
    </BrowserRouter>
  </StrictMode>
)

if (landingPrerenderizada) {
  hydrateRoot(rootEl, tree)
} else {
  createRoot(rootEl).render(tree)
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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

createRoot(rootEl).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <CookieConsent />
    </BrowserRouter>
  </StrictMode>,
)

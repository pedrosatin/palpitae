/**
 * Google Analytics 4 com Consent Mode v2 (LGPD).
 *
 * O GA só é ativado quando `config.gaMeasurementId` está definido — em dev/local
 * sem a env `VITE_GA_MEASUREMENT_ID`, nada é carregado (sem script, sem banner).
 *
 * O consentimento começa como `denied`: o gtag.js carrega de forma assíncrona e
 * coleta apenas pings sem cookie (modelagem do Consent Mode) até o usuário
 * aceitar no banner (ver `components/CookieConsent`). A escolha é persistida em
 * localStorage e restaurada nas visitas seguintes.
 */
import { config } from '../config'

const CONSENT_KEY = 'palpitae:analytics-consent'

export type Consent = 'granted' | 'denied'

/** Verdadeiro quando há um measurement id configurado. */
export const gaEnabled = config.gaMeasurementId.length > 0

declare global {
  interface Window {
    dataLayer: unknown[]
    gtag: (...args: unknown[]) => void
  }
}

/** Consentimento salvo de uma visita anterior, ou null se ainda não houve escolha. */
export function getStoredConsent(): Consent | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY)
    return value === 'granted' || value === 'denied' ? value : null
  } catch {
    return null
  }
}

/** Registra a escolha do usuário, persiste e atualiza o Consent Mode do gtag. */
export function setConsent(consent: Consent): void {
  try {
    localStorage.setItem(CONSENT_KEY, consent)
  } catch {
    // localStorage indisponível (modo privado etc.) — segue sem persistir
  }
  window.gtag?.('consent', 'update', { analytics_storage: consent })
}

/**
 * Inicializa o GA. Idempotente e seguro de chamar mesmo sem a env configurada.
 * Deve rodar cedo no boot (main.tsx), antes do primeiro render, para que o
 * Consent Mode default seja registrado antes de qualquer hit.
 */
export function initGa(): void {
  if (!gaEnabled) return

  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    // forma canônica do gtag: empurra o próprio objeto `arguments` no dataLayer
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments)
  }

  // Consent Mode v2 — nega tudo por padrão até o opt-in explícito (LGPD)
  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  })

  // Restaura o consentimento concedido numa visita anterior
  if (getStoredConsent() === 'granted') {
    window.gtag('consent', 'update', { analytics_storage: 'granted' })
  }

  window.gtag('js', new Date())
  window.gtag('config', config.gaMeasurementId)

  // Carrega o gtag.js de forma assíncrona — não bloqueia o render
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${config.gaMeasurementId}`
  document.head.appendChild(script)
}

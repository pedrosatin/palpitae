/**
 * Google Analytics 4 com Consent Mode v2 (LGPD).
 *
 * trackEvent() é o ponto de entrada para eventos customizados. Seguro chamar
 * mesmo sem GA configurado ou com consent negado — o gtag descarta o hit.
 * Nomes de evento seguem snake_case (padrão GA4).
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
    if (value === 'granted') return 'granted'
    if (value?.startsWith('denied')) {
      const parts = value.split(':')
      if (parts.length === 2) {
        const timestamp = parseInt(parts[1], 10)
        // O banner reaparece a cada 30 dias para quem recusou.
        // Re-pedir com muita frequência (ex: 3 dias) é considerado "Consent Fatigue" e
        // pode ir contra o princípio de "consentimento livre" da LGPD/GDPR.
        const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000
        if (Date.now() - timestamp < EXPIRY_MS) {
          return 'denied'
        }
        // Expirou: limpa o storage para mostrar o banner de novo na próxima montagem
        localStorage.removeItem(CONSENT_KEY)
        return null
      }
      // Fallback para o valor antigo (apenas 'denied')
      return 'denied'
    }
    return null
  } catch {
    return null
  }
}

/** Registra a escolha do usuário, persiste e atualiza o Consent Mode do gtag. */
export function setConsent(consent: Consent): void {
  try {
    // Quando o usuário nega, salvamos o timestamp para podermos pedir novamente no futuro
    const valueToStore = consent === 'denied' ? `denied:${Date.now()}` : consent
    localStorage.setItem(CONSENT_KEY, valueToStore)
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

/** Dispara um evento customizado para o GA4. No-op se o GA não estiver ativo. */
export function trackEvent(name: string, params?: Record<string, string | number | boolean>): void {
  window.gtag?.('event', name, params)
}

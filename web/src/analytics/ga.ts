/**
 * Google Analytics 4 com Consent Mode v2 (LGPD).
 *
 * trackEvent() é o ponto de entrada para eventos customizados. Seguro chamar
 * mesmo sem GA configurado. Com consentimento negado, os helpers não enviam hits.
 * Nomes de evento seguem snake_case (padrão GA4).
 *
 * O GA só é ativado quando `config.gaMeasurementId` está definido — em dev/local
 * sem a env `VITE_GA_MEASUREMENT_ID`, nada é carregado (sem script, sem banner).
 *
 * O consentimento começa como `denied`: o gtag.js carrega de forma assíncrona e
 * coleta apenas pings sem cookie até a primeira escolha. Depois de recusar,
 * nada é enviado. Revogar um aceite com o cliente carregado recarrega a página.
 * A escolha fica no localStorage e volta nas visitas seguintes.
 */
import { config } from '../config'
import { gaPageLocation, gaPageTitle, internalReferrer, type GaPage } from './pageContext'

const CONSENT_KEY = 'palpitae:analytics-consent'

let currentConsent: Consent | undefined

export type Consent = 'granted' | 'denied'

/** Verdadeiro quando há um measurement id configurado. */
export const gaEnabled = config.gaMeasurementId.length > 0

declare global {
  interface Window {
    google_tag_manager?: Record<string, unknown>
    dataLayer: unknown[]
    gtag: (...args: unknown[]) => void
    [key: `ga-disable-${string}`]: boolean
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
        const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000
        if (Date.now() - timestamp < EXPIRY_MS) {
          return 'denied'
        }
        localStorage.removeItem(CONSENT_KEY)
        return null
      }
      return 'denied'
    }
    return null
  } catch {
    return null
  }
}

/** Registra a escolha do usuário, persiste e atualiza o Consent Mode do gtag. */
export function setConsent(consent: Consent): void {
  const previousConsent = currentConsent ?? getStoredConsent()
  currentConsent = consent
  window[`ga-disable-${config.gaMeasurementId}`] = consent === 'denied'
  try {
    const valueToStore = consent === 'denied' ? `denied:${Date.now()}` : consent
    localStorage.setItem(CONSENT_KEY, valueToStore)
  } catch {
    // localStorage indisponível (modo privado etc.) — segue sem persistir
  }
  window.gtag?.('consent', 'update', { analytics_storage: consent })
  if (consent === 'denied') {
    clearGaCookies()
    if (previousConsent === 'granted' && window.google_tag_manager && getStoredConsent() === 'denied') {
      window.location.reload()
      return
    }
  }
}

function clearGaCookies(): void {
  const labels = window.location.hostname.split('.')
  const domains = ['', ...labels.map((_, i) => labels.slice(i).join('.'))]
  for (const name of ['_ga', `_ga_${config.gaMeasurementId.slice(2)}`]) {
    for (const domain of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ''}`
    }
  }
}

/**
 * Inicializa o GA. Idempotente e seguro de chamar mesmo sem a env configurada.
 * Deve rodar cedo no boot (main.tsx), antes do primeiro render, para que o
 * Consent Mode default seja registrado antes de qualquer hit.
 */
export function initGa(): void {
  if (!gaEnabled) return

  currentConsent = getStoredConsent() ?? undefined
  window[`ga-disable-${config.gaMeasurementId}`] = currentConsent === 'denied'
  window.dataLayer = window.dataLayer || []
  window.gtag = function gtag() {
    window.dataLayer.push(arguments)
  }

  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  })

  if (currentConsent === 'granted') {
    window.gtag('consent', 'update', { analytics_storage: 'granted' })
  } else if (currentConsent === 'denied') {
    window.gtag('consent', 'update', { analytics_storage: 'denied' })
  }

  window.gtag('js', new Date())
  window.gtag('set', firstLoadPage())
  window.gtag('config', config.gaMeasurementId)

  loadGtagScript()
}

function firstLoadPage(): GaPage & { page_referrer?: string } {
  const { origin, pathname, search } = window.location
  const referrer = internalReferrer(document.referrer, origin)
  return {
    page_location: gaPageLocation({ origin, pathname, search }),
    page_title: gaPageTitle(pathname),
    ...(referrer ? { page_referrer: referrer } : {}),
  }
}

function loadGtagScript(): void {
  const inject = () => {
    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${config.gaMeasurementId}`
    document.head.appendChild(script)
  }

  const scheduleIdle = () =>
    typeof window.requestIdleCallback === 'function'
      ? window.requestIdleCallback(inject)
      : setTimeout(inject, 0)

  if (document.readyState === 'complete') {
    scheduleIdle()
    return
  }

  window.addEventListener('load', scheduleIdle, { once: true })
}

/** Registra uma navegação interna. Os eventos seguintes herdam a mesma página. */
export function trackPageView(page: GaPage, referrer: string): void {
  const params = { ...page, page_referrer: referrer }
  window.gtag?.('set', params)
  if ((currentConsent ?? getStoredConsent()) === 'denied') return
  window.gtag?.('event', 'page_view', params)
}

export type EventParamValue = string | number | boolean
export type EventParams = Record<string, EventParamValue>

/**
 * Parâmetros permitidos por evento no GA4.
 * Chaves fora desta lista e parâmetros enviados para eventos sem entrada na
 * tabela são descartados antes de chamar `gtag`, para evitar envio acidental de
 * texto livre ou dado pessoal.
 */
export const EVENT_ALLOWED_PARAMS: Record<string, readonly string[]> = {
  click_modal_fechar: ['modal'],
  entrar_origem: ['origem'],
  login: ['method', 'origem'],
  share_invite: ['method', 'context'],
  join_group: ['entry_method'],
  join_request: [],
  approve_join_request: [],
  submit_criar_grupo: ['origem'],
  click_create_group_preset_selecionado: ['preset'],
  click_create_group_ajuda_pontuacao: ['campo'],
  click_group_picks_ver_quem_palpitou: ['open'],
  change_group_picks_rodada: ['round'],
  click_group_picks_rodada_anterior: ['round'],
  click_group_picks_proxima_rodada: ['round'],
  click_leaderboard_rodada_anterior: ['round'],
  click_leaderboard_proxima_rodada: ['round'],
  change_leaderboard_rodada: ['round'],
  click_matchcard_salvar: ['match_id'],
  click_matchcard_resultado: ['match_id', 'outcome'],
  click_prediction_penalty_winner: ['match_id', 'winner'],
  change_predictions_rodada: ['round'],
  click_predictions_rodada_adiada: ['round'],
  click_predictions_rodada_anterior: ['round'],
  click_predictions_proxima_rodada: ['round'],
  click_predictions_salvar_todos: ['count', 'round'],
  change_predictions_aplicar_outros_grupos: ['enabled'],
  click_predictions_aplicar_outros_grupos: ['groups'],
  click_standings_ver_grupo: ['group'],
  click_admin_metrics_filtro_campeonato: ['filter', 'value'],
  click_admin_metrics_arquivo_mes: ['month'],
  click_admin_metrics_periodo: ['days'],
  click_admin_radar_periodo: ['days'],
  click_admin_radar_ordenar: ['sort'],
  click_admin_radar_filtrar_status: ['status'],
  click_dashboard_encerrados_toggle: ['open'],
  click_group_detail_abrir_convite: ['open'],
  click_group_detail_tab: ['tab'],
  click_landing_guia: ['guia'],
  click_settings_toggle_lembretes: ['enabled'],
  click_settings_confirmar_lembretes: ['enabled'],
}

function filterEventParams(name: string, params?: EventParams): EventParams | undefined {
  if (!params || !Object.hasOwn(EVENT_ALLOWED_PARAMS, name)) return undefined
  const allowed = EVENT_ALLOWED_PARAMS[name]
  if (allowed.length === 0) return undefined

  const filtered: EventParams = {}
  let hasKeys = false
  for (const key of allowed) {
    if (Object.hasOwn(params, key) && params[key] !== undefined) {
      filtered[key] = params[key]
      hasKeys = true
    }
  }
  return hasKeys ? filtered : undefined
}

/** Dispara um evento customizado para o GA4. No-op sem GA ou com consentimento negado. */
export function trackEvent(name: string, params?: EventParams): void {
  if ((currentConsent ?? getStoredConsent()) === 'denied') return
  window.gtag?.('event', name, filterEventParams(name, params))
}

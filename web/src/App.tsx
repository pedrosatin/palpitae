import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import {
  matchPath,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom'
import { trackLoginIfPending } from './analytics/funnel'
import { trackEvent } from './analytics/ga'
import { captureGuideOrigin } from './analytics/guideOrigin'
import {
  captureEntryOrigin,
  captureInviteEntry,
  clearSignupAttribution,
} from './analytics/signupOrigin'
import { useGaPageView } from './analytics/useGaPageView'
import { RouteErrorBoundary } from './components/ErrorBoundary'
import { buildApiUrl } from './config'
import {
  clearSessionExpired,
  notifyLogoutUnconfirmed,
  SESSION_EXPIRED_EVENT,
} from './lib/api'
import { invalidateApiCache } from './lib/api-cache'
import { INVITE_PATH_PREFIX } from './lib/invite'
import { loggedInLoginTarget, pageLoadedFromHistory } from './lib/loginRedirect'
import { clearStoredDrafts } from './lib/predictionDraftStorage'
import LandingPage from './pages/LandingPage'

/**
 * The authenticated pages pull in the heavy app surface (modals, tabs).
 * They are code-split so a first-time visitor on the public landing
 * only downloads the marketing chunk, not the whole app. While a chunk loads
 * the Suspense fallback is null — the dark background (painted inline in
 * index.html) carries the screen, so there's no spinner flash.
 *
 * LoginPage is also split out even though it's on the unauthenticated branch:
 * `/` (the audited, public URL) renders LandingPage, never LoginPage, so
 * keeping it eager only inflated the critical bundle — including its CSS
 * module and the useDocumentTitle chunk it shares with the authenticated
 * pages — for every anonymous landing visit.
 */
const LoginPage = lazy(() => import('./pages/LoginPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const GroupDetailPage = lazy(() => import('./pages/GroupDetailPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
// Dashboard admin de métricas server-side — sem link de navegação (URL direta);
// a API restringe ao ADMIN_EMAIL, aqui é só rota.
const AdminMetricsPage = lazy(() => import('./pages/AdminMetricsPage'))
// Radar de competições (admin) — inteligência de produto: o que está rolando no
// futebol e quanto o público brasileiro se interessa. Mesmo gate na API.
const AdminRadarPage = lazy(() => import('./pages/AdminRadarPage'))
// Fora do bundle crítico: só carrega quando o `/auth/me` responde 5xx.
const AuthUnavailable = lazy(() => import('./components/AuthUnavailable'))

/**
 * `/convite/:code` é o link compartilhado (a Pages Function de mesmo caminho
 * cuida do preview no WhatsApp). Sem sessão, a rota mostra a InvitePage. Com
 * sessão, vira `/?convite=CODE`, onde o Dashboard abre o fluxo de entrada.
 */
function InviteRedirect() {
  const { code = '' } = useParams()
  const search = code ? `?${new URLSearchParams({ convite: code })}` : ''
  return <Navigate to={`/${search}`} replace />
}

/**
 * Raiz para quem não tem sessão. Link antigo com `?convite=` e sessão que
 * expirou num dispositivo conhecido caem aqui, e a pessoa vê o convite. O
 * redirecionamento espera o auth resolver, para a hidratação da landing casar
 * com o HTML pré-renderizado.
 */
function VisitorHome({ authResolved }: { authResolved: boolean }) {
  const [searchParams] = useSearchParams()
  const convite = searchParams.get('convite')
  if (authResolved && convite) {
    return <Navigate to={`${INVITE_PATH_PREFIX}${encodeURIComponent(convite)}`} replace />
  }
  return <LandingPage />
}

/**
 * Represents an authenticated user's basic profile.
 * Shape mirrors the GET /auth/me response from the API.
 */
interface User {
  id: string
  email: string
  nickname?: string
  avatar_url?: string
  feature_flags?: {
    create_group?: boolean
  }
}

// `unavailable`: o `/auth/me` respondeu 5xx. Não sabemos se há sessão, então ninguém é
// deslogado e a marca de sessão conhecida fica como está.
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable'

/**
 * Marca, em localStorage, que este dispositivo já teve uma sessão autenticada.
 *
 * O cookie de sessão é HttpOnly (invisível ao JS), então essa é a única pista
 * que temos, antes de o `GET /auth/me` responder, sobre quem está chegando.
 * A marca controla a pintura antecipada da landing e o aviso de indisponibilidade
 * nas rotas públicas. Para o LCP: um visitante anônimo em "/" recebe a landing já
 * pré-renderizada no HTML; quem já logou aqui alguma vez continua vendo a tela
 * escura até o auth resolver, para não piscar a página de marketing antes do
 * dashboard.
 *
 * Quem LÊ a flag é o script inline no fim do `index.html`, antes de o React
 * existir — é ele que decide manter ou descartar a landing pré-renderizada.
 * O App também consulta a marca quando `/auth/me` responde 5xx. Perder a flag
 * (storage limpo, aba anônima) faz a landing ser pintada por um instante antes do
 * dashboard; nunca quebra a navegação.
 * A chave é duplicada no `index.html`: se mudar aqui, mude lá também.
 */
const KNOWN_SESSION_KEY = 'palpitae:sessao-conhecida'

function hasKnownSession(): boolean {
  try {
    return localStorage.getItem(KNOWN_SESSION_KEY) === '1'
  } catch {
    return false
  }
}

function setKnownSession(known: boolean) {
  try {
    if (known) localStorage.setItem(KNOWN_SESSION_KEY, '1')
    else localStorage.removeItem(KNOWN_SESSION_KEY)
  } catch {
    // Storage indisponível (modo restrito): seguimos sem a otimização.
  }
}

/**
 * Root application component.
 *
 * Resolves authentication state on mount by calling GET /auth/me.
 * Renders the appropriate page based on the result. Uma página que quebra no
 * render mostra a tela de erro da rota em vez de deixar a tela em branco.
 *
 * `landingPrerenderizada` é verdadeiro quando a landing já está pintada na tela
 * pelo HTML gerado no build e o React está apenas hidratando (ver `main.tsx` e
 * `scripts/prerender.mjs`). Nesse caso o primeiro render PRECISA ser a landing,
 * senão a hidratação diverge do HTML e o React remonta a página inteira.
 */
export default function App({
  landingPrerenderizada = false,
}: {
  landingPrerenderizada?: boolean
}) {
  return (
    <RouteErrorBoundary>
      <AppRoutes landingPrerenderizada={landingPrerenderizada} />
    </RouteErrorBoundary>
  )
}

function AppRoutes({ landingPrerenderizada }: { landingPrerenderizada: boolean }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [retrying, setRetrying] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  useGaPageView()
  const capturedLocation = useRef<string | null>(null)

  useEffect(() => {
    if (capturedLocation.current === location.key) return
    capturedLocation.current = location.key
    const origem = captureGuideOrigin(location.search)
    if (location.pathname === '/entrar' && origem) trackEvent('entrar_origem', { origem })
    captureInviteEntry(location.pathname, location.search)
  }, [location.key, location.pathname, location.search])

  // Uma vez por carga de página: o referrer não muda nas navegações internas.
  useEffect(() => captureEntryOrigin(), [])

  const checkSession = useCallback(() => {
    invalidateApiCache()
    // Raw fetch on purpose: an anonymous visit is the normal logged-out state,
    // not an expired session — apiFetch would flag "sessão expirou" for every
    // visitor. The endpoint answers 200 either way (`{ user }` or
    // `{ authenticated: false }`) so a logged-out visit never surfaces as a
    // console error in devtools/Lighthouse.
    fetch(buildApiUrl('/auth/me'), { credentials: 'include' })
      .then((res) => {
        if (res.status >= 500) return null
        if (!res.ok) throw new Error('unauthenticated')
        return res.json() as Promise<{ user: User } | { authenticated: false }>
      })
      .then((data) => {
        if (data === null) {
          setStatus('unavailable')
        } else if ('user' in data) {
          // Aviso de expiração que sobrou da sessão anterior não vale para esta.
          clearSessionExpired()
          setUser(data.user)
          setStatus('authenticated')
          setKnownSession(true)
          trackLoginIfPending(true)
        } else {
          setStatus('unauthenticated')
          setKnownSession(false)
          trackLoginIfPending(false)
        }
      })
      .catch(() => {
        setStatus('unauthenticated')
        trackLoginIfPending(false)
      })
      .finally(() => setRetrying(false))
  }, [])

  useEffect(checkSession, [checkSession])

  // O aviso fica montado durante a nova tentativa, para o foco não sair do botão.
  function retrySession() {
    setRetrying(true)
    checkSession()
  }

  // Any apiFetch call that hits a 401 broadcasts this event. Drop auth state so the
  // router swaps to the login screen instead of leaving tabs stuck on their own
  // "erro ao carregar" with no data. LoginPage reads the flag to explain why.
  useEffect(() => {
    const onExpired = () => {
      invalidateApiCache()
      setUser(null)
      setStatus('unauthenticated')
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  // Logout explícito apaga os rascunhos de palpite deste navegador. A sessão
  // expirada mantém, porque a pessoa volta a entrar e recupera o que digitou.
  //
  // A tela sai do estado logado mesmo quando o servidor não confirma a revogação.
  // Num 503 a API já apagou o cookie; numa falha de rede ele pode ter ficado. Nos
  // dois casos o token pode continuar valendo, e a tela de login diz isso em vez
  // de tratar a saída como concluída.
  function handleLogout() {
    clearSignupAttribution()
    // Raw fetch on purpose: the user is leaving deliberately — a 401 from an
    // already-dead session must not trigger the "sessão expirou" notice.
    fetch(buildApiUrl('/auth/logout'), {
      method: 'POST',
      credentials: 'include',
    })
      .then(
        (res) => res.ok,
        () => false,
      )
      .then((confirmed) => {
        // Junto com a troca de tela, para a aba Palpitar aberta não regravar antes de desmontar.
        clearStoredDrafts()
        invalidateApiCache()
        clearSessionExpired()
        if (!confirmed) {
          notifyLogoutUnconfirmed()
          navigate('/entrar', { replace: true })
        }
        setUser(null)
        setStatus('unauthenticated')
      })
  }

  // "Sair de todos os dispositivos" já apagou o cookie e as sessões no servidor.
  function handleLoggedOutEverywhere() {
    clearSignupAttribution()
    clearSessionExpired()
    clearStoredDrafts()
    invalidateApiCache()
    setUser(null)
    setStatus('unauthenticated')
  }

  // Enquanto o auth resolve, a landing continua na tela para quem chegou com
  // ela pré-renderizada: ela não depende de nenhum dado da sessão, e esperar o
  // `GET /auth/me` para pintá-la era parte do que atrasava o LCP no mobile. As
  // demais rotas continuam esperando, porque dependem de saber quem é o usuário.
  const paintLandingEarly = status === 'loading' && landingPrerenderizada

  // O convite também não espera o auth, porque o visitante decide nessa tela se entra.
  // Quem tem sessão conhecida já saiu de `/convite/` no script do index.html.
  const paintInviteEarly =
    status === 'loading' && matchPath('/convite/:code', location.pathname) !== null

  // Sem pintura antecipada, seguimos com a tela escura pintada inline no
  // index.html até a rota aparecer — nada de flash branco.
  if (status === 'loading' && !paintLandingEarly && !paintInviteEarly) return null

  // Com o `/auth/me` em 5xx, a landing e o convite seguem no ar para quem nunca
  // teve sessão neste dispositivo. As rotas privadas e quem tem a marca de sessão
  // veem o aviso. A URL fica como está: com a API de volta, "Tentar novamente"
  // abre a mesma rota.
  const publicRoute =
    location.pathname === '/' || matchPath('/convite/:code', location.pathname) !== null
  if (status === 'unavailable' && (!publicRoute || hasKnownSession()))
    return (
      <Suspense fallback={null}>
        <AuthUnavailable onRetry={retrySession} retrying={retrying} />
      </Suspense>
    )

  if (status !== 'authenticated')
    return (
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<VisitorHome authResolved={status !== 'loading'} />} />
          <Route path="/convite/:code" element={<InvitePage />} />
          {/* Durante o loading não sabemos ainda se estas rotas são do
              visitante ou de um usuário logado, então elas não pintam nada. */}
          <Route path="/entrar" element={paintLandingEarly ? null : <LoginPage />} />
          <Route path="*" element={paintLandingEarly ? null : <LoginPage />} />
        </Routes>
      </Suspense>
    )

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<DashboardPage user={user!} onLogout={handleLogout} />} />
        <Route path="/convite/:code" element={<InviteRedirect />} />
        <Route
          path="/grupos/:groupId"
          element={<GroupDetailPage user={user!} onLogout={handleLogout} />}
        />
        <Route
          path="/configuracoes"
          element={
            <SettingsPage
              user={user!}
              onLogout={handleLogout}
              onLogoutAll={handleLoggedOutEverywhere}
            />
          }
        />
        <Route path="/admin/metricas" element={<AdminMetricsPage />} />
        <Route path="/admin/oportunidades" element={<AdminRadarPage />} />
        {/* Quem já tem sessão e toca no CTA de um guia vai ao painel com a mesma
            query. O `from` mantém a atribuição e o `competicao` abre a criação.
            Na volta pelo histórico até `/entrar`, o `competicao` fica de fora. A
            primeira rota do documento tem a chave `default` e é a única que
            corresponde ao tipo de carga do navegador. */}
        <Route
          path="/entrar"
          element={
            <Navigate
              to={loggedInLoginTarget(
                location.search,
                location.key === 'default' && pageLoadedFromHistory(),
              )}
              replace
            />
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

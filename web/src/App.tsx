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
import { clearSessionExpired, notifyLogoutUnconfirmed, SESSION_EXPIRED_EVENT } from './lib/api'
import { invalidateApiCache } from './lib/api-cache'
import { appQueryClient } from './lib/queryClient'
import { INVITE_PATH_PREFIX } from './lib/invite'
import { loggedInLoginTarget, pageLoadedFromHistory } from './lib/loginRedirect'
import { clearStoredDrafts } from './lib/predictionDraftStorage'
import LandingPage from './pages/LandingPage'
import type { User } from './types'

const LoginPage = lazy(() => import('./pages/LoginPage'))
const InvitePage = lazy(() => import('./pages/InvitePage'))
const GroupJoinPage = lazy(() => import('./pages/GroupJoinPage/GroupJoinPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const GroupDetailPage = lazy(() => import('./pages/GroupDetailPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const AdminMetricsPage = lazy(() => import('./pages/AdminMetricsPage'))
const AdminRadarPage = lazy(() => import('./pages/AdminRadarPage'))
const AuthUnavailable = lazy(() => import('./components/AuthUnavailable'))

function InviteRedirect() {
  const { code = '' } = useParams()
  const search = code ? `?${new URLSearchParams({ convite: code })}` : ''
  return <Navigate to={`/${search}`} replace />
}

function VisitorHome({ authResolved }: { authResolved: boolean }) {
  const [searchParams] = useSearchParams()
  const convite = searchParams.get('convite')
  if (authResolved && convite) {
    return <Navigate to={`${INVITE_PATH_PREFIX}${encodeURIComponent(convite)}`} replace />
  }
  return <LandingPage />
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable'

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

  useEffect(() => captureEntryOrigin(), [])

  const checkSession = useCallback(() => {
    invalidateApiCache()
    appQueryClient.clear()
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

  function retrySession() {
    setRetrying(true)
    checkSession()
  }

  const endSession = useCallback(
    ({
      clearDrafts = false,
      beforeLeave,
    }: { clearDrafts?: boolean; beforeLeave?: () => void } = {}) => {
      if (clearDrafts) {
        clearStoredDrafts()
        clearSessionExpired()
      }
      invalidateApiCache()
      appQueryClient.clear()
      beforeLeave?.()
      setUser(null)
      setStatus('unauthenticated')
    },
    [],
  )

  useEffect(() => {
    const onExpired = () => endSession()
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [endSession])

  function handleLogout() {
    clearSignupAttribution()
    fetch(buildApiUrl('/auth/logout'), {
      method: 'POST',
      credentials: 'include',
    })
      .then(
        (res) => res.ok,
        () => false,
      )
      .then((confirmed) => {
        endSession({
          clearDrafts: true,
          beforeLeave: confirmed
            ? undefined
            : () => {
                notifyLogoutUnconfirmed()
                navigate('/entrar', { replace: true })
              },
        })
      })
  }

  function handleLoggedOutEverywhere() {
    clearSignupAttribution()
    endSession({ clearDrafts: true })
  }

  const paintLandingEarly = status === 'loading' && landingPrerenderizada
  const isInviteRoute = matchPath('/convite/:code', location.pathname) !== null
  const isGroupJoinRoute = matchPath('/grupo/:publicId', location.pathname) !== null

  const paintInviteEarly = status === 'loading' && (isInviteRoute || isGroupJoinRoute)

  if (status === 'loading' && !paintLandingEarly && !paintInviteEarly) return null

  const publicRoute = location.pathname === '/' || isInviteRoute || isGroupJoinRoute
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
          <Route path="/grupo/:publicId" element={<GroupJoinPage />} />
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
        <Route path="/grupo/:publicId" element={<GroupJoinPage user={user} />} />
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

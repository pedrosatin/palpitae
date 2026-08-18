import { Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { config } from './config'
import { SESSION_EXPIRED_EVENT } from './lib/api'
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
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const GroupDetailPage = lazy(() => import('./pages/GroupDetailPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
// Dashboard admin de métricas server-side — sem link de navegação (URL direta);
// a API restringe ao ADMIN_EMAIL, aqui é só rota.
const AdminMetricsPage = lazy(() => import('./pages/AdminMetricsPage'))
// Radar de competições (admin) — inteligência de produto: o que está rolando no
// futebol e quanto o público brasileiro se interessa. Mesmo gate na API.
const AdminRadarPage = lazy(() => import('./pages/AdminRadarPage'))

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

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

/**
 * Root application component.
 *
 * Resolves authentication state on mount by calling GET /auth/me.
 * Renders the appropriate page based on the result.
 */
export default function App() {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    // Raw fetch on purpose: an anonymous visit is the normal logged-out state,
    // not an expired session — apiFetch would flag "sessão expirou" for every
    // visitor. The endpoint answers 200 either way (`{ user }` or
    // `{ authenticated: false }`) so a logged-out visit never surfaces as a
    // console error in devtools/Lighthouse.
    fetch(`${config.apiUrl}/auth/me`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('unauthenticated')
        return res.json() as Promise<{ user: User } | { authenticated: false }>
      })
      .then((data) => {
        if ('user' in data) {
          setUser(data.user)
          setStatus('authenticated')
        } else {
          setStatus('unauthenticated')
        }
      })
      .catch(() => setStatus('unauthenticated'))
  }, [])

  // Any apiFetch call that hits a 401 broadcasts this event. Drop auth state so the
  // router swaps to the login screen instead of leaving tabs stuck on their own
  // "erro ao carregar" with no data. LoginPage reads the flag to explain why.
  useEffect(() => {
    const onExpired = () => {
      setUser(null)
      setStatus('unauthenticated')
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  function handleLogout() {
    // Raw fetch on purpose: the user is leaving deliberately — a 401 from an
    // already-dead session must not trigger the "sessão expirou" notice.
    fetch(`${config.apiUrl}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).finally(() => {
      setUser(null)
      setStatus('unauthenticated')
    })
  }

  // While auth resolves, render nothing — the dark background painted inline in
  // index.html keeps the screen calm (no white flash) until the route appears.
  if (status === 'loading') return null

  if (status === 'unauthenticated')
    return (
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/entrar" element={<LoginPage />} />
          <Route path="*" element={<LoginPage />} />
        </Routes>
      </Suspense>
    )

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<DashboardPage user={user!} onLogout={handleLogout} />} />
        <Route
          path="/grupos/:groupId"
          element={<GroupDetailPage user={user!} onLogout={handleLogout} />}
        />
        <Route
          path="/configuracoes"
          element={<SettingsPage user={user!} onLogout={handleLogout} />}
        />
        <Route path="/admin/metricas" element={<AdminMetricsPage />} />
        <Route path="/admin/oportunidades" element={<AdminRadarPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

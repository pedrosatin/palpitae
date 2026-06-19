import { Suspense, lazy, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { config } from './config'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'

/**
 * The authenticated pages pull in the heavy app surface (bracket, modals,
 * tabs). They are code-split so a first-time visitor on the public landing
 * only downloads the marketing chunk, not the whole app. While a chunk loads
 * the Suspense fallback is null — the dark background (painted inline in
 * index.html) carries the screen, so there's no spinner flash.
 */
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const GroupDetailPage = lazy(() => import('./pages/GroupDetailPage'))

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
    fetch(`${config.apiUrl}/auth/me`, { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('unauthenticated')
        return res.json() as Promise<{ user: User }>
      })
      .then((data) => {
        setUser(data.user)
        setStatus('authenticated')
      })
      .catch(() => setStatus('unauthenticated'))
  }, [])

  function handleLogout() {
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
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/entrar" element={<LoginPage />} />
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )

  return (
    <Suspense fallback={null}>
      <Routes>
        <Route
          path="/"
          element={<DashboardPage user={user!} onLogout={handleLogout} />}
        />
        <Route
          path="/grupos/:groupId"
          element={<GroupDetailPage user={user!} onLogout={handleLogout} />}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}

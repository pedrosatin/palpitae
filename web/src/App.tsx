import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { config } from './config'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import GroupDetailPage from './pages/GroupDetailPage'

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

  if (status === 'loading') return null

  if (status === 'unauthenticated') return <LoginPage />

  return (
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
  )
}

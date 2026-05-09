import { useEffect, useState } from 'react'
import { config } from './config'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'

/**
 * Represents an authenticated user's basic profile.
 * Shape mirrors the GET /auth/me response from the API.
 */
interface User {
  id: string
  email: string
  nickname?: string
  avatar_url?: string
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

/**
 * Root application component.
 *
 * Resolves authentication state on mount by calling GET /auth/me.
 * Renders the appropriate page based on the result:
 *
 *   loading         → blank screen while the request is in-flight
 *   unauthenticated → <LoginPage />
 *   authenticated   → main app (dashboard will be added here)
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

  if (status === 'loading') return null

  if (status === 'unauthenticated') return <LoginPage />

  return <DashboardPage user={user!} />
}

import { useEffect, useState } from 'react'
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
}

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

export type View =
  | { page: 'dashboard'; pendingInvite?: string }
  | { page: 'group'; groupId: string }

/**
 * Root application component.
 *
 * Resolves authentication state on mount by calling GET /auth/me.
 * Renders the appropriate page based on the result.
 *
 * Also detects ?convite=XXXX-XXXX in the URL and passes it to the
 * dashboard so the JoinGroupModal can be pre-opened.
 */
export default function App() {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [view, setView] = useState<View>(() => {
    const params = new URLSearchParams(window.location.search)
    const invite = params.get('convite')
    return { page: 'dashboard', pendingInvite: invite ?? undefined }
  })

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

  if (view.page === 'group') {
    return (
      <GroupDetailPage
        user={user!}
        groupId={view.groupId}
        onCreateGroup={() => setView({ page: 'dashboard' })}
        onJoinGroup={() => setView({ page: 'dashboard' })}
        onLogout={handleLogout}
      />
    )
  }

  return (
    <DashboardPage
      user={user!}
      pendingInvite={view.pendingInvite}
      onNavigateToGroup={(groupId) => setView({ page: 'group', groupId })}
      onLogout={handleLogout}
    />
  )
}

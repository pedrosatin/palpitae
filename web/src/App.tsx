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
 * Marca, em localStorage, que este dispositivo já teve uma sessão autenticada.
 *
 * O cookie de sessão é HttpOnly (invisível ao JS), então essa é a única pista
 * que temos, antes de o `GET /auth/me` responder, sobre quem está chegando.
 * Ela existe só para o LCP: um visitante anônimo em "/" recebe a landing já
 * pré-renderizada no HTML; quem já logou aqui alguma vez continua vendo a tela
 * escura até o auth resolver, para não piscar a página de marketing antes do
 * dashboard.
 *
 * Quem LÊ a flag é o script inline no fim do `index.html`, antes de o React
 * existir — é ele que decide manter ou descartar a landing pré-renderizada.
 * Aqui só escrevemos. Perder a flag (storage limpo, aba anônima) faz a landing
 * ser pintada por um instante antes do dashboard; nunca quebra a navegação.
 * A chave é duplicada no `index.html`: se mudar aqui, mude lá também.
 */
const KNOWN_SESSION_KEY = 'palpitae:sessao-conhecida'

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
 * Renders the appropriate page based on the result.
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
          setKnownSession(true)
        } else {
          setStatus('unauthenticated')
          setKnownSession(false)
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

  // Enquanto o auth resolve, a landing continua na tela para quem chegou com
  // ela pré-renderizada: ela não depende de nenhum dado da sessão, e esperar o
  // `GET /auth/me` para pintá-la era parte do que atrasava o LCP no mobile. As
  // demais rotas continuam esperando, porque dependem de saber quem é o usuário.
  const paintLandingEarly = status === 'loading' && landingPrerenderizada

  // Sem a landing antecipada, seguimos com a tela escura pintada inline no
  // index.html até a rota aparecer — nada de flash branco.
  if (status === 'loading' && !paintLandingEarly) return null

  if (status !== 'authenticated')
    return (
      <Suspense fallback={null}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
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

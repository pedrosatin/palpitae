/**
 * Thin wrapper around `fetch` for calls to the Palpitae API.
 *
 * Two things every authenticated call needs, in one place:
 *  - `credentials: 'include'` so the session cookie rides along;
 *  - a single point that notices a 401 (expired/absent session) and tells
 *    the app to bounce the user back to login instead of leaving each tab
 *    stuck on its own "erro ao carregar" with no data.
 *
 * On 401 we broadcast a global event (see `notifySessionExpired`) rather than
 * redirecting here — the wrapper has no router access, and callers still get
 * the raw Response so their existing `if (!res.ok) throw` paths keep working
 * during the brief moment before App tears the authenticated tree down.
 */

/** Window event dispatched when any API call returns 401. */
export const SESSION_EXPIRED_EVENT = 'palpitae:session-expired'

/** sessionStorage flag so the login screen can explain *why* the user landed there. */
const SESSION_EXPIRED_FLAG = 'palpitae:session-expired'

/**
 * Flag the current session as expired and broadcast it.
 * App listens for the event to drop auth state; LoginPage reads the flag to
 * show a "sua sessão expirou" notice.
 */
export function notifySessionExpired(): void {
  if (typeof window === 'undefined') return
  // sessionStorage can throw (private mode / quota) — the event still fires.
  setFlag(SESSION_EXPIRED_FLAG)
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
}

/** Read-and-clear the session-expired flag. Returns true once per expiry. */
export function consumeSessionExpired(): boolean {
  return consumeFlag(SESSION_EXPIRED_FLAG)
}

/**
 * Descarta o aviso de expiração pendente. Novo login e saída pedida pelo usuário
 * encerram a sessão a que o aviso se referia, e a próxima tela de login não o herda.
 */
export function clearSessionExpired(): void {
  consumeFlag(SESSION_EXPIRED_FLAG)
}

/** Flag de sessionStorage: o `POST /auth/logout` não confirmou a revogação no servidor. */
const LOGOUT_UNCONFIRMED_FLAG = 'palpitae:logout-unconfirmed'

/** Marca, para a tela de login, que a saída não foi confirmada pelo servidor. */
export function notifyLogoutUnconfirmed(): void {
  setFlag(LOGOUT_UNCONFIRMED_FLAG)
}

/** Lê e apaga a marca de saída sem confirmação. Verdadeiro uma vez por saída. */
export function consumeLogoutUnconfirmed(): boolean {
  return consumeFlag(LOGOUT_UNCONFIRMED_FLAG)
}

function setFlag(key: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key, '1')
  } catch {
    // Storage indisponível: o aviso não aparece, e o fluxo segue.
  }
}

function consumeFlag(key: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    const flag = window.sessionStorage.getItem(key)
    if (flag) window.sessionStorage.removeItem(key)
    return flag === '1'
  } catch {
    return false
  }
}

/** Aviso para falha de rede ou resposta que não veio da API (HTML de um 502 do proxy). */
export const CONNECTION_ERROR = 'Erro de conexão. Tente novamente.'

/**
 * Mensagem de erro de uma resposta da API que falhou. Único caminho de leitura:
 * devolve o `error` do corpo JSON ou, na falta dele, o `message`; `fallback` quando
 * o JSON não traz nenhum dos dois; e `CONNECTION_ERROR` quando o corpo não é JSON.
 * Nunca lança.
 */
export async function readApiError(res: Response, fallback: string): Promise<string> {
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return CONNECTION_ERROR
  }
  const { error, message } = (body ?? {}) as { error?: unknown; message?: unknown }
  for (const text of [error, message]) {
    if (typeof text === 'string' && text !== '') return text
  }
  return fallback
}

/**
 * `fetch` for API calls: always sends credentials and traps 401 centrally.
 * Drop-in for existing `fetch(...)` call sites — same arguments, same Response.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...init, credentials: 'include' })
  if (res.status === 401) notifySessionExpired()
  return res
}

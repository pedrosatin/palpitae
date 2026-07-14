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
  try {
    window.sessionStorage.setItem(SESSION_EXPIRED_FLAG, '1')
  } catch {
    // sessionStorage can throw (private mode / quota) — the event still fires.
  }
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
}

/** Read-and-clear the session-expired flag. Returns true once per expiry. */
export function consumeSessionExpired(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const flag = window.sessionStorage.getItem(SESSION_EXPIRED_FLAG)
    if (flag) window.sessionStorage.removeItem(SESSION_EXPIRED_FLAG)
    return flag === '1'
  } catch {
    return false
  }
}

/**
 * `fetch` for API calls: always sends credentials and traps 401 centrally.
 * Drop-in for existing `fetch(...)` call sites — same arguments, same Response.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, { credentials: 'include', ...init })
  if (res.status === 401) notifySessionExpired()
  return res
}

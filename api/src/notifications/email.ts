/**
 * Provider seam for transactional e-mail. The rest of the codebase calls
 * `sendEmail()` and knows nothing about Resend — swapping providers (Brevo,
 * SendGrid, etc.) means changing only this file. See ADR-009.
 */

const RESEND_API = 'https://api.resend.com/emails'
// Endereço respondível (não "noreply"): um From ao qual dá pra responder melhora
// engajamento e reduz a chance do Gmail classificar como bulk/Promotions. Requer
// que lembretes@ exista e roteie no Cloudflare Email Routing, senão respostas quicam.
const FROM = 'Palpitae <lembretes@palpitae.com.br>'

export type EmailMessage = {
  to: string
  subject: string
  html: string
  /** Plain-text fallback. Optional, but recommended for deliverability. */
  text?: string
  /** Extra MIME headers (e.g. List-Unsubscribe). Forwarded to Resend as-is. */
  headers?: Record<string, string>
  /**
   * Chave de idempotência do Resend, válida por 24 h. Repetir a chave com o mesmo
   * corpo não envia outro e-mail. Com corpo diferente o Resend responde 409.
   */
  idempotencyKey?: string
}

/**
 * Thrown on a non-2xx Resend response. Carries the HTTP `status` so callers can
 * distinguish transient failures (429 rate limit, 5xx) — worth retrying — from
 * permanent ones (4xx). `retryAfterMs` is parsed from the Retry-After header
 * when present, so a retry can honour the server's backoff hint.
 */
export class EmailError extends Error {
  readonly status: number
  readonly retryAfterMs?: number
  /** Cota diária ou mensal do Resend esgotada. Repetir não adianta até a cota renovar. */
  readonly quotaExceeded: boolean

  constructor(status: number, body: string, retryAfter?: string | null) {
    super(`Resend respondeu ${status}: ${body}`)
    this.name = 'EmailError'
    this.status = status
    this.quotaExceeded = status === 429 && /(daily|monthly)_quota_exceeded/.test(body)
    const secs = retryAfter ? Number(retryAfter) : Number.NaN
    this.retryAfterMs = Number.isFinite(secs) ? secs * 1000 : undefined
  }
}

/**
 * Sends a single transactional e-mail. Throws `EmailError` on a non-2xx response
 * so the caller can isolate, retry, and log per-message failures.
 */
export async function sendEmail(apiKey: string, msg: EmailMessage): Promise<void> {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(msg.idempotencyKey ? { 'Idempotency-Key': msg.idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      ...(msg.text ? { text: msg.text } : {}),
      ...(msg.headers ? { headers: msg.headers } : {}),
    }),
  })

  if (!res.ok) {
    throw new EmailError(res.status, await res.text(), res.headers.get('retry-after'))
  }
}

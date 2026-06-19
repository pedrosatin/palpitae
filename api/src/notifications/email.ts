/**
 * Provider seam for transactional e-mail. The rest of the codebase calls
 * `sendEmail()` and knows nothing about Resend — swapping providers (Brevo,
 * SendGrid, etc.) means changing only this file. See ADR-009.
 */

const RESEND_API = 'https://api.resend.com/emails'
const FROM = 'Palpitae <noreply@send.palpitae.com.br>'

export type EmailMessage = {
  to: string
  subject: string
  html: string
}

/**
 * Sends a single transactional e-mail. Throws on a non-2xx response so the
 * caller can isolate and log per-message failures.
 */
export async function sendEmail(apiKey: string, msg: EmailMessage): Promise<void> {
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to: msg.to, subject: msg.subject, html: msg.html }),
  })

  if (!res.ok) {
    throw new Error(`Resend respondeu ${res.status}: ${await res.text()}`)
  }
}

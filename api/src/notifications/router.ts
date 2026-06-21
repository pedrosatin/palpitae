import { type Context, Hono } from 'hono'
import { requireAuth } from '../auth/middleware'
import { hashUserId, logEvent } from '../observability'
import type { AppContext } from '../types'
import { verifyUnsubToken } from './unsubscribeToken'

const router = new Hono<AppContext>()

/**
 * Minimal HTML confirmation page returned to the unsubscribe link click. Kept
 * self-contained (no app shell) because it's opened straight from an e-mail.
 */
function confirmationPage(message: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Palpitae</title>
</head>
<body style="margin: 0; font-family: sans-serif; background: #f3f4f6;">
  <div style="max-width: 480px; margin: 64px auto; padding: 32px; background: white; border-radius: 12px; text-align: center;">
    <h1 style="font-size: 20px;">${message}</h1>
    <p style="color: #6b7280;">Você pode reativar os lembretes a qualquer momento nas configurações do Palpitae.</p>
    <a href="https://palpitae.com.br" style="display: inline-block; margin-top: 16px; color: #16a34a; font-weight: bold; text-decoration: none;">Ir para o Palpitae</a>
  </div>
</body>
</html>`
}

/** Sets email_unsubscribed_at for the user behind a valid token. Idempotent. */
async function unsubscribeByToken(c: Context<AppContext>): Promise<boolean> {
  const token = c.req.query('token')
  if (!token) return false

  let userId: string
  try {
    userId = await verifyUnsubToken(token, c.env.JWT_SECRET)
  } catch {
    return false
  }

  await c.env.DB.prepare(
    `UPDATE users SET email_unsubscribed_at = datetime('now')
     WHERE id = ? AND email_unsubscribed_at IS NULL`,
  )
    .bind(userId)
    .run()

  logEvent(c.env.AE, 'email_unsubscribed', { blobs: [await hashUserId(userId), 'link'] })
  return true
}

/**
 * GET /notifications/unsubscribe?token=...
 * Public — opened from the e-mail footer link. Always returns an HTML page.
 */
router.get('/unsubscribe', async (c) => {
  const ok = await unsubscribeByToken(c)
  return c.html(
    confirmationPage(
      ok ? 'Pronto! Você não receberá mais os lembretes de rodada.' : 'Link inválido ou expirado.',
    ),
    ok ? 200 : 400,
  )
})

/**
 * POST /notifications/unsubscribe?token=...
 * Public — target of the List-Unsubscribe-Post one-click header (RFC 8058). The
 * mail client sends `List-Unsubscribe=One-Click` in the body; the token stays in
 * the URL. Returns 200 text, no page.
 */
router.post('/unsubscribe', async (c) => {
  const ok = await unsubscribeByToken(c)
  return c.text(ok ? 'unsubscribed' : 'invalid token', ok ? 200 : 400)
})

/**
 * GET /notifications/preferences (auth)
 * Returns the current e-mail preferences for the signed-in user.
 */
router.get('/preferences', requireAuth, async (c) => {
  const userId = c.get('userId')
  const row = await c.env.DB.prepare(`SELECT email_unsubscribed_at FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ email_unsubscribed_at: string | null }>()

  return c.json({ round_reminders: row?.email_unsubscribed_at == null })
})

/**
 * PATCH /notifications/preferences (auth)
 * Body: { round_reminders: boolean }. true → subscribed (NULL), false → opted out.
 */
router.patch('/preferences', requireAuth, async (c) => {
  const userId = c.get('userId')
  const body = (await c.req.json().catch(() => ({}))) as { round_reminders?: unknown }

  if (typeof body.round_reminders !== 'boolean') {
    return c.json({ error: 'round_reminders (boolean) é obrigatório' }, 400)
  }

  const subscribe = body.round_reminders
  await c.env.DB.prepare(
    subscribe
      ? `UPDATE users SET email_unsubscribed_at = NULL WHERE id = ?`
      : `UPDATE users SET email_unsubscribed_at = datetime('now') WHERE id = ? AND email_unsubscribed_at IS NULL`,
  )
    .bind(userId)
    .run()

  logEvent(c.env.AE, subscribe ? 'email_resubscribed' : 'email_unsubscribed', {
    blobs: [await hashUserId(userId), 'settings'],
  })

  return c.json({ round_reminders: subscribe })
})

export { router as notificationsRouter }

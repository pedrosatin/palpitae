import { Hono } from 'hono'
import { html } from 'hono/html'
import * as v from 'valibot'
import { requireAuth } from '../auth/middleware'
import { validateJson } from '../http/validateJson'
import { hashUserId, logEvent } from '../observability'
import type { AppContext } from '../types'
import { applyMailjetUnsubscribeEvents, mailjetWebhookAuthorized } from './mailjetEvents'
import { markEmailUnsubscribed } from './optOut'
import { verifyUnsubTokenForEnv } from './unsubscribeToken'
import {
  mailjetPayloadSchema,
  mapPatchPreferencesError,
  patchPreferencesSchema,
  PREFERENCES_ROUND_REMINDERS_MSG,
} from './writeSchemas'

const router = new Hono<AppContext>()

/**
 * Minimal HTML confirmation page returned to the unsubscribe link click. Kept
 * self-contained (no app shell) because it's opened straight from an e-mail.
 */
function confirmationPage(message: string) {
  return html`<!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Palpitae</title>
      </head>
      <body style="margin: 0; font-family: sans-serif; background: #f3f4f6;">
        <div
          style="max-width: 480px; margin: 64px auto; padding: 32px; background: white; border-radius: 12px; text-align: center;"
        >
          <h1 style="font-size: 20px;">${message}</h1>
          <p style="color: #6b7280;">
            Você pode reativar os lembretes a qualquer momento nas configurações do Palpitae.
          </p>
          <a
            href="https://palpitae.com.br"
            style="display: inline-block; margin-top: 16px; color: #16a34a; font-weight: bold; text-decoration: none;"
            >Ir para o Palpitae</a
          >
        </div>
      </body>
    </html>`
}

/**
 * Renders an HTML confirmation page with a POST button. Used by GET /unsubscribe
 * so that e-mail scanners and prefetch proxies (Microsoft Safe Links, etc.) that
 * fire GET requests on every link in a delivered e-mail cannot silently unsubscribe
 * the recipient. Only the POST (submitted by an intentional click) mutates state.
 */
function unsubscribeFormPage(token: string) {
  return html`<!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Palpitae — Cancelar lembretes</title>
      </head>
      <body style="margin: 0; font-family: sans-serif; background: #f3f4f6;">
        <div
          style="max-width: 480px; margin: 64px auto; padding: 32px; background: white; border-radius: 12px; text-align: center;"
        >
          <h1 style="font-size: 20px;">Cancelar lembretes de palpite?</h1>
          <p style="color: #6b7280;">Você não receberá mais e-mails de lembrete do Palpitae.</p>
          <form
            method="POST"
            action="/notifications/unsubscribe?token=${token}"
            style="margin-top: 24px;"
          >
            <button
              type="submit"
              style="background: #dc2626; color: white; border: none; padding: 12px 24px; border-radius: 6px; font-size: 16px; cursor: pointer; font-weight: bold;"
            >
              Confirmar cancelamento
            </button>
          </form>
          <a
            href="https://palpitae.com.br"
            style="display: inline-block; margin-top: 16px; color: #6b7280; font-size: 14px;"
            >Voltar ao Palpitae</a
          >
        </div>
      </body>
    </html>`
}

/**
 * GET /notifications/unsubscribe?token=...
 * Public — opened from the e-mail footer link. Renders a confirmation form; does
 * NOT mutate state. E-mail scanners (Microsoft Safe Links, antivirus proxies) fire
 * GET on every link in a delivered e-mail — a mutating GET would unsubscribe users
 * without their knowledge. Only the POST below actually writes to the database.
 */
router.get('/unsubscribe', async (c) => {
  const token = c.req.query('token')
  if (!token) {
    return c.html(confirmationPage('Link inválido ou expirado.'), 400)
  }
  try {
    await verifyUnsubTokenForEnv(token, c.env)
  } catch {
    return c.html(confirmationPage('Link inválido ou expirado.'), 400)
  }
  return c.html(unsubscribeFormPage(token))
})

/**
 * POST /notifications/unsubscribe?token=...
 * Public — target of the List-Unsubscribe-Post one-click header (RFC 8058). The
 * mail client sends `List-Unsubscribe=One-Click` in the body; the token stays in
 * the URL. Returns 200 text, no page.
 */
router.post('/unsubscribe', async (c) => {
  const token = c.req.query('token')
  if (!token) return c.text('invalid token', 400)

  let userId: string
  try {
    userId = await verifyUnsubTokenForEnv(token, c.env)
  } catch {
    return c.text('invalid token', 400)
  }

  // Só registra o evento quando a linha muda — POST one-click repetido é no-op.
  await markEmailUnsubscribed(c.env.DB, c.env.AE, userId, 'link')

  return c.text('unsubscribed', 200)
})

/**
 * POST /notifications/mailjet-events
 *
 * Event API da Mailjet (unsub e spam). Autenticação Basic: a senha é o segredo
 * `MAILJET_WEBHOOK_SECRET` (usuário livre, ex. `mailjet`). Sem o segredo no
 * Worker a rota responde 404. Payload inválido e erros de aplicação respondem
 * 200 com log, para a Mailjet não reenviar em loop. Ver ADR-020.
 */
router.post('/mailjet-events', async (c) => {
  const auth = await mailjetWebhookAuthorized(
    c.req.header('Authorization'),
    c.env.MAILJET_WEBHOOK_SECRET,
  )
  if (auth === 'missing_config') return c.text('Not Found', 404)
  if (auth === 'unauthorized') return c.text('Unauthorized', 401)

  // Esta rota não usa o validateJson porque um 400 faria a Mailjet reenviar o
  // lote; JSON malformado ou payload fora do formato responde 200 com log.
  let payload: unknown
  try {
    payload = await c.req.json()
  } catch {
    console.error('[mailjet-events] payload inválido')
    return c.text('ok', 200)
  }

  const parsed = v.safeParse(mailjetPayloadSchema, payload)
  if (!parsed.success) {
    console.error('[mailjet-events] payload inválido')
    return c.text('ok', 200)
  }

  const { failed } = await applyMailjetUnsubscribeEvents(
    c.env.DB,
    c.env.AE,
    parsed.output,
  )
  // Falha interna (D1) num unsub/spam: 500 para a Mailjet reenviar o lote.
  if (failed > 0) return c.text('retry', 500)
  return c.text('ok', 200)
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

  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json({ round_reminders: row.email_unsubscribed_at == null })
})

/**
 * PATCH /notifications/preferences (auth)
 * Body: { round_reminders: boolean }. true → subscribed (NULL), false → opted out.
 *
 * Corpo malformado, `null`, lista ou valor solto responde 400 com
 * `round_reminders (boolean) é obrigatório`.
 */
router.patch(
  '/preferences',
  requireAuth,
  validateJson(patchPreferencesSchema, mapPatchPreferencesError, {
    invalidBodyError: PREFERENCES_ROUND_REMINDERS_MSG,
  }),
  async (c) => {
    const userId = c.get('userId')
    const { round_reminders: subscribe } = c.req.valid('json')
    if (subscribe) {
      const result = await c.env.DB.prepare(
        `UPDATE users SET email_unsubscribed_at = NULL WHERE id = ? AND email_unsubscribed_at IS NOT NULL`,
      )
        .bind(userId)
        .run()
      if (result.meta.changes > 0) {
        logEvent(c.env.AE, 'email_resubscribed', {
          blobs: [await hashUserId(userId), 'settings'],
        })
      }
    } else {
      await markEmailUnsubscribed(c.env.DB, c.env.AE, userId, 'settings')
    }

    return c.json({ round_reminders: subscribe })
  },
)

export { router as notificationsRouter }

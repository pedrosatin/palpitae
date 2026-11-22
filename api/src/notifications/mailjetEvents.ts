/**
 * Event API da Mailjet (unsub / spam): sincroniza o descadastro local quando o
 * destinatário sai pela lista da Mailjet (o provedor substitui o List-Unsubscribe
 * que enviamos). Ver ADR-020.
 */

import { normalizeEmail } from '../auth/google'
import { sameSecret } from '../security/limits'
import { markEmailUnsubscribed } from './optOut'

const CUSTOM_ID_RE = /^lembrete-diario\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/

const HANDLED_EVENTS = new Set(['unsub', 'spam'])

export type MailjetEvent = {
  event?: unknown
  email?: unknown
  CustomID?: unknown
  customID?: unknown
}

/** Extrai o userId do CustomID do lembrete, ou null se o formato não bater. */
export function userIdFromMailjetCustomId(customId: unknown): string | null {
  if (typeof customId !== 'string' || !customId) return null
  const match = CUSTOM_ID_RE.exec(customId)
  return match?.[1] ?? null
}

/**
 * Lê a senha do Authorization Basic. A Mailjet cadastra o callback como
 * `https://usuario:senha@host/...` e manda o header Basic.
 */
export function passwordFromBasicAuth(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Basic\s+(\S+)$/i.exec(header.trim())
  if (!match) return null
  try {
    const decoded = atob(match[1])
    const colon = decoded.indexOf(':')
    if (colon < 0) return null
    return decoded.slice(colon + 1)
  } catch {
    return null
  }
}

/**
 * Autentica o webhook. Sem `MAILJET_WEBHOOK_SECRET` → null (rota responde 404).
 * Senha errada ou ausente → false (401). Ok → true.
 */
export async function mailjetWebhookAuthorized(
  authorization: string | undefined,
  secret: string | undefined,
): Promise<'missing_config' | 'unauthorized' | 'ok'> {
  const expected = secret?.trim()
  if (!expected) return 'missing_config'
  const password = passwordFromBasicAuth(authorization)
  if (!password || !(await sameSecret(password, expected))) return 'unauthorized'
  return 'ok'
}

function eventCustomId(event: MailjetEvent): unknown {
  return event.CustomID ?? event.customID
}

async function resolveUserId(db: D1Database, event: MailjetEvent): Promise<string | null> {
  const fromCustom = userIdFromMailjetCustomId(eventCustomId(event))
  if (fromCustom) {
    const row = await db
      .prepare('SELECT id FROM users WHERE id = ?')
      .bind(fromCustom)
      .first<{ id: string }>()
    if (row) return row.id
  }

  if (typeof event.email !== 'string' || !event.email.trim()) return null
  const email = normalizeEmail(event.email)
  if (!email) return null
  const row = await db
    .prepare('SELECT id FROM users WHERE lower(email) = ?')
    .bind(email)
    .first<{ id: string }>()
  return row?.id ?? null
}

/**
 * Aplica unsub/spam. Outros tipos são ignorados. Falha de um evento não impede
 * os demais. Não lança: erros internos vão ao log sem dado pessoal e contam em
 * `failed`, para a rota responder 500 e a Mailjet reenviar (o efeito é idempotente).
 */
export async function applyMailjetUnsubscribeEvents(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  events: MailjetEvent[],
): Promise<{ handled: number; changed: number; failed: number }> {
  let handled = 0
  let changed = 0
  let failed = 0
  for (const event of events) {
    if (typeof event.event !== 'string' || !HANDLED_EVENTS.has(event.event)) continue
    handled++
    try {
      const userId = await resolveUserId(db, event)
      if (!userId) continue
      if (await markEmailUnsubscribed(db, ae, userId, 'mailjet')) changed++
    } catch (error) {
      failed++
      console.error('[mailjet-events] falha ao aplicar evento', error)
    }
  }
  return { handled, changed, failed }
}

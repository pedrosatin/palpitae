/**
 * Descadastra lembretes por e-mail. Mesmo efeito do link de cancelamento e de
 * Configurações: grava a data só na primeira vez e registra o evento.
 */

import { hashUserId, logEvent } from '../observability'

export type UnsubscribeSource = 'link' | 'settings' | 'mailjet'

/**
 * Marca o usuário como descadastrado. Idempotente: se já estiver fora, não
 * regrava a data nem registra outro evento. Devolve true quando a linha mudou.
 */
export async function markEmailUnsubscribed(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  userId: string,
  source: UnsubscribeSource,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE users SET email_unsubscribed_at = datetime('now')
       WHERE id = ? AND email_unsubscribed_at IS NULL`,
    )
    .bind(userId)
    .run()

  if (result.meta.changes > 0) {
    logEvent(ae, 'email_unsubscribed', {
      blobs: [await hashUserId(userId), source],
    })
    return true
  }
  return false
}

/**
 * Alerta automático de resultado atrasado (ticket 05).
 *
 * Canal: e-mail ao `ADMIN_EMAIL` via Resend (`RESEND_API_KEY`), o mesmo fornecedor
 * dos lembretes. Desligado por padrão: ligue com `RESULT_OVERDUE_ALERT=1` (ou
 * `true`). Cooldown em `ops_alert_state` (padrão 6 h, `RESULT_OVERDUE_ALERT_COOLDOWN_HOURS`).
 *
 * Roda no fim do poller, só quando o saldo de subrequests da invocação comporta
 * a contagem, a leitura/gravação do cooldown e o `fetch` do e-mail (até 4
 * chamadas). Sem saldo, sem e-mail e sem segredo novo: o painel e o evento AE
 * continuam sendo a fonte de verdade.
 */

import { sendEmail, EmailError } from '../notifications/email'
import { tryLogEvent, tryLogError, type EventType } from '../observability/events'
import type { Env } from '../types'
import {
  countOverdueResults,
  overdueResultHours,
  type OverdueResultSummary,
} from './resultOverdue'

/** Chave da linha em `ops_alert_state`. */
export const RESULT_OVERDUE_ALERT_KEY = 'result_overdue'

/** Cooldown padrão entre e-mails do mesmo alerta (horas). */
export const DEFAULT_OVERDUE_ALERT_COOLDOWN_HOURS = 6

/**
 * Subrequests máximos deste passo: 1 contagem + 1 leitura do cooldown + 1
 * escrita + 1 `fetch` do Resend.
 */
export const RESULT_OVERDUE_ALERT_CALLS = 4

export type ResultOverdueAlertEnv = Pick<
  Env,
  | 'ADMIN_EMAIL'
  | 'RESEND_API_KEY'
  | 'RESULT_OVERDUE_HOURS'
  | 'RESULT_OVERDUE_ALERT'
  | 'RESULT_OVERDUE_ALERT_COOLDOWN_HOURS'
  | 'FRONTEND_URL'
>

export type ResultOverdueAlertOutcome =
  | 'disabled'
  | 'misconfig'
  | 'skipped_budget'
  | 'clear'
  | 'suppressed'
  | 'sent'
  | 'send_failed'

const ALERT_EVENT: EventType = 'result_overdue_alert'

function truthyFlag(raw?: string | null): boolean {
  if (raw == null) return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

export function overdueAlertEnabled(raw?: string | null): boolean {
  return truthyFlag(raw)
}

export function overdueAlertCooldownHours(raw?: string | null): number {
  if (raw == null || raw.trim() === '') return DEFAULT_OVERDUE_ALERT_COOLDOWN_HOURS
  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) return DEFAULT_OVERDUE_ALERT_COOLDOWN_HOURS
  return n
}

function adminInbox(env: ResultOverdueAlertEnv): string | null {
  const email = env.ADMIN_EMAIL?.trim()
  return email ? email : null
}

function buildAlertEmail(
  summary: OverdueResultSummary,
  hours: number,
  frontendUrl: string | undefined,
): { subject: string; html: string; text: string } {
  const age =
    summary.oldest_minutes < 120
      ? `${summary.oldest_minutes} min`
      : `${Math.round(summary.oldest_minutes / 60)} h`
  const subject = `[Palpitae] ${summary.matches} resultado(s) atrasado(s)`
  const panel = frontendUrl
    ? `${frontendUrl.replace(/\/$/, '')}/admin/metricas`
    : 'https://palpitae.com.br/admin/metricas'
  const text =
    `${summary.matches} jogo(s) sem placar completo há mais de ${hours} h do início previsto ` +
    `(${summary.competitions} temporada(s); o mais antigo começou há ${age}). ` +
    `Adiados conhecidos ficam de fora. Painel: ${panel}`
  const html =
    `<p><strong>${summary.matches}</strong> jogo(s) sem placar completo há mais de ` +
    `<strong>${hours} h</strong> do início previsto ` +
    `(${summary.competitions} temporada(s); o mais antigo começou há ${age}).</p>` +
    `<p>Adiados conhecidos ficam de fora. ` +
    `<a href="${panel}">Abrir o painel de métricas</a>.</p>`
  return { subject, html, text }
}

/**
 * Avalia e, se cabível, envia o alerta. `callsLeft` é o saldo que ainda cabe na
 * invocação (já descontada a limpeza do cron). Sem saldo suficiente, não consulta
 * o D1 nem manda e-mail.
 */
export async function checkAndSendResultOverdueAlert(
  db: D1Database,
  env: ResultOverdueAlertEnv,
  ae: AnalyticsEngineDataset | undefined,
  nowMs: number,
  callsLeft: number,
): Promise<ResultOverdueAlertOutcome> {
  if (!overdueAlertEnabled(env.RESULT_OVERDUE_ALERT)) return 'disabled'

  const to = adminInbox(env)
  const apiKey = env.RESEND_API_KEY?.trim()
  if (!to || !apiKey) {
    tryLogEvent(ae, ALERT_EVENT, {
      blobs: ['misconfig', !to ? 'admin_email' : 'resend_api_key'],
      doubles: [0, 0],
    })
    return 'misconfig'
  }

  if (callsLeft < RESULT_OVERDUE_ALERT_CALLS) {
    tryLogEvent(ae, ALERT_EVENT, {
      blobs: ['skipped_budget'],
      doubles: [callsLeft, RESULT_OVERDUE_ALERT_CALLS],
    })
    return 'skipped_budget'
  }

  const hours = overdueResultHours(env.RESULT_OVERDUE_HOURS)
  let summary: OverdueResultSummary
  try {
    summary = await countOverdueResults(db, hours, nowMs)
  } catch (err) {
    tryLogError(ae, ALERT_EVENT, '[result-overdue-alert] Falha ao contar atrasados:', err, {
      blobs: ['count_failed'],
    })
    return 'send_failed'
  }

  if (summary.matches <= 0) {
    tryLogEvent(ae, ALERT_EVENT, {
      blobs: ['clear'],
      doubles: [0, 0],
    })
    return 'clear'
  }

  const cooldownHours = overdueAlertCooldownHours(env.RESULT_OVERDUE_ALERT_COOLDOWN_HOURS)
  const cooldownMs = cooldownHours * 60 * 60 * 1000

  let lastSent = 0
  try {
    const row = await db
      .prepare(`SELECT last_sent_at FROM ops_alert_state WHERE alert_key = ?`)
      .bind(RESULT_OVERDUE_ALERT_KEY)
      .first<{ last_sent_at: number }>()
    lastSent = Number(row?.last_sent_at ?? 0)
  } catch (err) {
    tryLogError(ae, ALERT_EVENT, '[result-overdue-alert] Falha ao ler cooldown:', err, {
      blobs: ['cooldown_read_failed'],
      doubles: [summary.matches, summary.oldest_minutes],
    })
    return 'send_failed'
  }

  if (lastSent > 0 && nowMs - lastSent < cooldownMs) {
    tryLogEvent(ae, ALERT_EVENT, {
      blobs: ['suppressed'],
      doubles: [summary.matches, summary.oldest_minutes],
    })
    return 'suppressed'
  }

  const mail = buildAlertEmail(summary, hours, env.FRONTEND_URL)
  try {
    await sendEmail(apiKey, {
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      // Mesma chave por janela de cooldown: o Resend não reenvia o mesmo corpo.
      idempotencyKey: `result-overdue-${Math.floor(nowMs / cooldownMs)}`,
    })
  } catch (err) {
    const detail = err instanceof EmailError ? `http_${err.status}` : 'send_error'
    tryLogError(ae, ALERT_EVENT, '[result-overdue-alert] Falha ao enviar e-mail:', err, {
      blobs: ['send_failed', detail],
      doubles: [summary.matches, summary.oldest_minutes],
    })
    return 'send_failed'
  }

  try {
    await db
      .prepare(
        `INSERT INTO ops_alert_state (alert_key, last_sent_at, last_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(alert_key) DO UPDATE SET
           last_sent_at = excluded.last_sent_at,
           last_count = excluded.last_count,
           updated_at = excluded.updated_at`,
      )
      .bind(RESULT_OVERDUE_ALERT_KEY, nowMs, summary.matches, nowMs)
      .run()
  } catch (err) {
    // O e-mail já saiu; falha ao gravar o cooldown só registra. O próximo tick
    // pode reenviar até a gravação voltar (a idempotency key do Resend mitiga).
    tryLogError(ae, ALERT_EVENT, '[result-overdue-alert] E-mail enviado, cooldown não gravou:', err, {
      blobs: ['cooldown_write_failed'],
      doubles: [summary.matches, summary.oldest_minutes],
    })
  }

  tryLogEvent(ae, ALERT_EVENT, {
    blobs: ['sent'],
    doubles: [summary.matches, summary.oldest_minutes],
  })
  return 'sent'
}

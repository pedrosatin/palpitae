/**
 * Alerta automático de resultado atrasado (ticket 05).
 *
 * Canal: e-mail ao `ADMIN_EMAIL` via Resend (`RESEND_API_KEY`), o mesmo fornecedor
 * dos lembretes. Desligado por padrão: ligue com `RESULT_OVERDUE_ALERT=1` (ou
 * `true`). Cooldown em `ops_alert_state` (padrão 6 h, `RESULT_OVERDUE_ALERT_COOLDOWN_HOURS`).
 *
 * Roda no fim do poller, só quando o saldo de subrequests da invocação comporta
 * a contagem, a reserva do cooldown e o `fetch` do e-mail (até
 * `RESULT_OVERDUE_ALERT_CALLS` chamadas). Sem saldo, registra `skipped_budget` e
 * encerra sem consultar o D1 nem enviar e-mail.
 *
 * Reserva condicional antes do envio: o UPSERT só grava se `last_sent_at` estiver
 * fora da janela de cooldown (ou a linha não existir). Só o tick que obtém
 * `meta.changes > 0` tenta o Resend. A reserva é a identidade da tentativa: a
 * chave de idempotência deriva só de `last_sent_at` gravado (`result-overdue-<ts>`),
 * e o corpo é montado uma vez por reserva.
 *
 * Resposta do envio em três classes:
 * - 2xx: `sent`, mantém a reserva.
 * - Falha definitiva (4xx exceto 409 e 429): libera a reserva para o próximo tick
 *   tentar com reserva e chave novas.
 * - Falha ambígua (timeout, rede, 5xx, qualquer 409, 429): mantém a reserva até o
 *   fim do cooldown, sem reenvio, e registra `send_uncertain`. Nesse caso o alerta
 *   pode ficar sem e-mail até o cooldown acabar; o painel continua mostrando os
 *   atrasados.
 */

import { sendEmail, EmailError } from '../notifications/email'
import { tryLogEvent, tryLogError, type EventType } from '../observability/events'
import type { Env } from '../types'
import { INVOCATION_CALL_LIMIT } from './callBudget'
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
 * Subrequests máximos deste passo no pior caso:
 * 1 contagem + 1 reserva + 1 `fetch` do Resend + 1 liberação da reserva.
 * Caminho de sucesso e falha ambígua gastam 3 (sem liberação).
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
  | 'send_uncertain'

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

/**
 * Corpo montado uma vez por reserva. Sem a idade do jogo: o texto acompanha a
 * contagem no instante da reserva e não muda em recuperação.
 */
function buildAlertEmail(
  summary: OverdueResultSummary,
  hours: number,
  frontendUrl: string | undefined,
): { subject: string; html: string; text: string } {
  const n = summary.matches
  const c = summary.competitions
  const resultado = n === 1 ? 'resultado atrasado' : 'resultados atrasados'
  const jogo = n === 1 ? 'jogo' : 'jogos'
  const temporada = c === 1 ? 'temporada' : 'temporadas'
  const subject = `[Palpitae] ${n} ${resultado}`
  const panel = frontendUrl
    ? `${frontendUrl.replace(/\/$/, '')}/admin/metricas`
    : 'https://palpitae.com.br/admin/metricas'
  const text =
    `${n} ${jogo} sem placar completo há mais de ${hours} h do início previsto ` +
    `(${c} ${temporada}). Adiados conhecidos ficam de fora. Painel: ${panel}`
  const html =
    `<p><strong>${n}</strong> ${jogo} sem placar completo há mais de ` +
    `<strong>${hours} h</strong> do início previsto ` +
    `(${c} ${temporada}).</p>` +
    `<p>Adiados conhecidos ficam de fora. ` +
    `<a href="${panel}">Abrir o painel de métricas</a>.</p>`
  return { subject, html, text }
}

/** Chave de idempotência: só o instante da reserva em `ops_alert_state`. */
export function overdueAlertIdempotencyKey(reservedAt: number): string {
  return `result-overdue-${reservedAt}`
}

/**
 * Saldo que o poller passa ao alerta: teto da invocação menos o já gasto e a
 * limpeza do `scheduled` (1 chamada) que roda na mesma invocação.
 */
export function overdueAlertCallsLeft(budgetUsed: number, cleanupCalls = 1): number {
  return INVOCATION_CALL_LIMIT - budgetUsed - cleanupCalls
}

/**
 * Classifica a falha do `sendEmail`.
 * Definitiva: Resend com certeza não enviou (4xx exceto 409 e 429).
 * Ambígua: timeout, rede, 5xx, qualquer 409, 429.
 */
export function classifySendFailure(err: unknown): 'definitive' | 'ambiguous' {
  if (!(err instanceof EmailError)) return 'ambiguous'
  const status = err.status
  if (status === 409 || status === 429) return 'ambiguous'
  if (status >= 400 && status < 500) return 'definitive'
  return 'ambiguous'
}

function sendFailureDetail(err: unknown): string {
  if (err instanceof EmailError) return `http_${err.status}`
  return 'send_error'
}

/**
 * Reserva a janela de cooldown. Só um tick obtém `changes > 0`: INSERT novo ou
 * UPDATE quando `last_sent_at` já passou do limiar. Um `last_sent_at` mais novo
 * (outro isolate) não é sobrescrito.
 */
async function reserveAlertWindow(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  nowMs: number,
  cooldownMs: number,
  matchCount: number,
): Promise<'reserved' | 'held' | 'failed'> {
  const threshold = nowMs - cooldownMs
  try {
    const result = await db
      .prepare(
        `INSERT INTO ops_alert_state (alert_key, last_sent_at, last_count, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(alert_key) DO UPDATE SET
           last_sent_at = excluded.last_sent_at,
           last_count = excluded.last_count,
           updated_at = excluded.updated_at
         WHERE ops_alert_state.last_sent_at < ?`,
      )
      .bind(RESULT_OVERDUE_ALERT_KEY, nowMs, matchCount, nowMs, threshold)
      .run()
    return (result.meta?.changes ?? 0) > 0 ? 'reserved' : 'held'
  } catch (err) {
    tryLogError(ae, ALERT_EVENT, '[result-overdue-alert] Falha ao reservar cooldown:', err, {
      blobs: ['cooldown_reserve_failed'],
      doubles: [matchCount, 0],
    })
    return 'failed'
  }
}

/**
 * Libera a reserva deste tick (`last_sent_at = reservedAt`) para o próximo tick
 * tentar de novo. Só mexe na linha se o valor ainda for o que este tick gravou,
 * para não apagar a reserva de um isolate mais novo.
 */
async function releaseAlertWindow(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  reservedAt: number,
): Promise<boolean> {
  try {
    await db
      .prepare(
        `UPDATE ops_alert_state
         SET last_sent_at = 0, updated_at = ?
         WHERE alert_key = ? AND last_sent_at = ?`,
      )
      .bind(reservedAt, RESULT_OVERDUE_ALERT_KEY, reservedAt)
      .run()
    return true
  } catch (err) {
    tryLogError(ae, ALERT_EVENT, '[result-overdue-alert] Falha ao liberar reserva:', err, {
      blobs: ['cooldown_release_failed'],
    })
    return false
  }
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

  const reservation = await reserveAlertWindow(db, ae, nowMs, cooldownMs, summary.matches)
  if (reservation === 'failed') {
    tryLogEvent(ae, ALERT_EVENT, {
      blobs: ['send_failed', 'cooldown_reserve_failed'],
      doubles: [summary.matches, summary.oldest_minutes],
    })
    return 'send_failed'
  }
  if (reservation === 'held') {
    tryLogEvent(ae, ALERT_EVENT, {
      blobs: ['suppressed'],
      doubles: [summary.matches, summary.oldest_minutes],
    })
    return 'suppressed'
  }

  const mail = buildAlertEmail(summary, hours, env.FRONTEND_URL)
  const idempotencyKey = overdueAlertIdempotencyKey(nowMs)

  try {
    await sendEmail(apiKey, {
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey,
    })
  } catch (err) {
    const detail = sendFailureDetail(err)
    if (classifySendFailure(err) === 'definitive') {
      tryLogError(ae, ALERT_EVENT, '[result-overdue-alert] Falha definitiva ao enviar e-mail:', err, {
        blobs: ['send_failed', detail],
        doubles: [summary.matches, summary.oldest_minutes],
      })
      await releaseAlertWindow(db, ae, nowMs)
      return 'send_failed'
    }

    // Ambígua: mantém a reserva. Sem reenvio até o cooldown; o painel segue com os atrasados.
    tryLogEvent(ae, ALERT_EVENT, {
      blobs: ['send_uncertain', detail],
      doubles: [summary.matches, summary.oldest_minutes],
    })
    return 'send_uncertain'
  }

  tryLogEvent(ae, ALERT_EVENT, {
    blobs: ['sent'],
    doubles: [summary.matches, summary.oldest_minutes],
  })
  return 'sent'
}

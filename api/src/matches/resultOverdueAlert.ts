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
 * `meta.changes > 0` tenta o Resend. Em falha definitiva do envio a reserva é
 * liberada para o próximo tick tentar de novo; sucesso e HTTP 409 (mesma chave
 * de idempotência) mantêm a reserva.
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
 * Subrequests máximos deste passo no pior caso:
 * 1 contagem + 1 reserva + 1 `fetch` do Resend + 1 liberação da reserva.
 * Caminho de sucesso gasta 3 (sem liberação).
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

/** Índice da janela de cooldown que contém `nowMs` (chave estável na janela). */
export function overdueAlertWindowIndex(nowMs: number, cooldownMs: number): number {
  return Math.floor(nowMs / cooldownMs)
}

/**
 * Corpo estável na janela: conta jogos e temporadas, sem a idade do jogo mais
 * antigo (que muda a cada tick e quebraria a chave de idempotência do Resend).
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

/** Chave de idempotência: janela + contagens (corpo e chave mudam juntos). */
export function overdueAlertIdempotencyKey(
  nowMs: number,
  cooldownMs: number,
  summary: Pick<OverdueResultSummary, 'matches' | 'competitions'>,
): string {
  const window = overdueAlertWindowIndex(nowMs, cooldownMs)
  return `result-overdue-${window}-${summary.matches}-${summary.competitions}`
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
 * Libera a reserva deste tick (`last_sent_at = nowMs`) para o próximo tick
 * tentar de novo. Só mexe na linha se o valor ainda for o que este tick gravou,
 * para não apagar a reserva de um isolate mais novo.
 */
async function releaseAlertWindow(
  db: D1Database,
  ae: AnalyticsEngineDataset | undefined,
  reservedAt: number,
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE ops_alert_state
         SET last_sent_at = 0, updated_at = ?
         WHERE alert_key = ? AND last_sent_at = ?`,
      )
      .bind(reservedAt, RESULT_OVERDUE_ALERT_KEY, reservedAt)
      .run()
  } catch (err) {
    tryLogError(ae, ALERT_EVENT, '[result-overdue-alert] Falha ao liberar reserva:', err, {
      blobs: ['cooldown_release_failed'],
    })
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
  const idempotencyKey = overdueAlertIdempotencyKey(nowMs, cooldownMs, summary)

  try {
    await sendEmail(apiKey, {
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      idempotencyKey,
    })
  } catch (err) {
    // Mesma chave + corpo já aceito: o Resend devolve 409. Trata como enviado e
    // mantém a reserva (não liberar).
    if (err instanceof EmailError && err.status === 409) {
      tryLogEvent(ae, ALERT_EVENT, {
        blobs: ['sent', 'idempotent_replay'],
        doubles: [summary.matches, summary.oldest_minutes],
      })
      return 'sent'
    }

    const detail = err instanceof EmailError ? `http_${err.status}` : 'send_error'
    tryLogError(ae, ALERT_EVENT, '[result-overdue-alert] Falha ao enviar e-mail:', err, {
      blobs: ['send_failed', detail],
      doubles: [summary.matches, summary.oldest_minutes],
    })
    // Falha definitiva ou ambígua (5xx, rede, timeout): libera a reserva para o
    // próximo tick tentar. Corpo e chave estáveis fazem o Resend deduplicar se o
    // primeiro envio tiver sido aceito sem resposta.
    await releaseAlertWindow(db, ae, nowMs)
    return 'send_failed'
  }

  tryLogEvent(ae, ALERT_EVENT, {
    blobs: ['sent'],
    doubles: [summary.matches, summary.oldest_minutes],
  })
  return 'sent'
}

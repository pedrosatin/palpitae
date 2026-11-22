/**
 * Observabilidade server-side — dual-write de eventos de negócio e de saúde.
 *
 * Escreve só no Analytics Engine (hot path, retenção ~3 meses, grátis). O cold path é
 * o cron diário de `export.ts`, que copia o dataset para o R2, onde os arquivos ficam
 * 13 meses. Ver `docs/observability.md` para a arquitetura completa.
 *
 * Modelo fixo do Analytics Engine: até 20 `blobs` (strings/dimensões), até 20
 * `doubles` (números/medidas), 1 `index` (chave de sampling). Convenção do projeto:
 *   - index    = event_type            (chave de sampling)
 *   - blob1    = event_type            (repetido p/ aparecer no SELECT sem decodar)
 *   - blob2..N = dimensões string      (group_id, round, user_hash, status, ...)
 *   - double1..N = medidas numéricas   (duration_ms, matches_checked, ...)
 *
 * REGRA LGPD: nunca passar PII crua (e-mail, nome) em blob. Usar `user_hash`.
 */

import { hexEncode } from '../auth/encoding'

export type EventType =
  | 'poller_run'
  | 'fixture_discovery_run'
  | 'football_api_error'
  | 'scheduled_unknown_cron'
  | 'scheduled_config_missing'
  | 'cloudflare_usage'
  | 'cloudflare_quota_alert'
  | 'cloudflare_usage_error'
  | 'match_results_fallback'
  | 'provider_http_attempt'
  | 'provider_work_run'
  | 'provider_access_blocked'
  | 'match_teams_changed'
  | 'competition_unconfigured'
  | 'sync_event_discarded'
  | 'match_missing_from_feed'
  | 'competition_status_error'
  | 'match_scoring_error'
  | 'match_unscored'
  | 'result_overdue_alert'
  | 'radar_sync_run'
  | 'radar_sync_error'
  | 'request_perf'
  | 'security_storage_error'
  | 'prediction_saved'
  | 'group_created'
  | 'group_joined'
  | 'join_request'
  | 'invite_opened'
  | 'member_removed'
  | 'group_renamed'
  | 'group_invite_rotated'
  | 'group_deleted'
  | 'login_success'
  | 'login_failure'
  | 'account_created'
  | 'logout_all'
  | 'oauth_error'
  | 'matches_cache'
  | 'email_reminder_sent'
  | 'email_reminder_failed'
  | 'cron_round_reminder'
  | 'cron_round_reminder_misconfig'
  | 'email_unsubscribed'
  | 'email_resubscribed'

export type EventDims = {
  blobs?: (string | null | undefined)[]
  doubles?: number[]
}

/**
 * Registra um erro de negócio/integração. Emite no console com a stack trace original,
 * e salva um evento no Analytics Engine com a mensagem extraída para monitoramento.
 */
export function logError(
  ae: AnalyticsEngineDataset | undefined,
  type: EventType,
  consoleMessage: string,
  error: unknown,
  dims: EventDims = {},
): void {
  console.error(consoleMessage, error)
  const message = error instanceof Error ? error.message : String(error)
  logEvent(ae, type, {
    blobs: [...(dims.blobs ?? []), message],
    doubles: dims.doubles,
  })
}

/**
 * `logError` que nunca lança: a rotina que registra a própria falha não pode ser
 * derrubada por uma escrita que falhou no Analytics Engine. O erro original
 * continua no console, e a falha da escrita também.
 */
export function tryLogError(
  ae: AnalyticsEngineDataset | undefined,
  type: EventType,
  consoleMessage: string,
  error: unknown,
  dims: EventDims = {},
): void {
  try {
    logError(ae, type, consoleMessage, error, dims)
  } catch (writeError) {
    console.error(`[observability] Falha ao registrar ${type}:`, writeError)
  }
}

/**
 * Escreve um evento no Analytics Engine. Escrita assíncrona — não adiciona latência
 * ao request. Sem binding (dev local / testes) vira no-op, então é seguro chamar de
 * qualquer lugar sem guardar o binding.
 */
export function logEvent(
  ae: AnalyticsEngineDataset | undefined,
  type: EventType,
  dims: EventDims = {},
): void {
  if (!ae) return
  ae.writeDataPoint({
    indexes: [type],
    blobs: [type, ...(dims.blobs ?? [])].map((b) => (b ?? '').slice(0, 256)),
    doubles: dims.doubles ?? [],
  })
}

/**
 * `logEvent` para fluxos que a medição não pode derrubar: uma falha ao gravar o
 * evento fica no log e o fluxo segue.
 */
export function tryLogEvent(
  ae: AnalyticsEngineDataset | undefined,
  type: EventType,
  dims: EventDims = {},
): void {
  try {
    logEvent(ae, type, dims)
  } catch (error) {
    console.error(`[observability] Falha ao registrar ${type}:`, error)
  }
}

/**
 * Pseudonimiza um user_id para uso em eventos (regra LGPD: nunca PII crua nem o id
 * cru, pra não reidentificar). SHA-256 truncado em 64 bits — estável por usuário
 * (permite contar usuários distintos via COUNT(DISTINCT)), não reversível na prática.
 */
export async function hashUserId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId))
  return hexEncode(new Uint8Array(digest, 0, 8))
}

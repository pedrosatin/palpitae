/**
 * Observabilidade server-side — dual-write de eventos de negócio e de saúde.
 *
 * Hoje só escreve no Analytics Engine (hot path, retenção ~3 meses, grátis). O cold
 * path (R2, retenção ilimitada) virá de um cron diário que exporta este dataset —
 * não muda nada aqui. Ver `docs/observability.md` para a arquitetura completa.
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

export type EventType =
  // Saúde do cron / API Football
  | 'poller_run'
  | 'football_api_error'
  // Negócio (server-side, nos routers)
  | 'prediction_saved'
  | 'group_created'
  | 'group_joined'
  | 'member_removed'
  | 'group_renamed'
  | 'login_success'
  | 'login_failure'
  | 'oauth_error'
  | 'matches_cache'

export type EventDims = {
  /** Dimensões string. Viram blob2, blob3, ... (blob1 é sempre o event_type). */
  blobs?: (string | null | undefined)[]
  /** Medidas numéricas. Viram double1, double2, ... */
  doubles?: number[]
}

/**
 * Escreve um evento no Analytics Engine. Escrita assíncrona — não adiciona latência
 * ao request. Sem binding (dev local / testes) vira no-op, então é seguro chamar de
 * qualquer lugar sem guardar o binding.
 */
export function logEvent(ae: AnalyticsEngineDataset | undefined, type: EventType, dims: EventDims = {}): void {
  if (!ae) return
  ae.writeDataPoint({
    indexes: [type],
    blobs: [type, ...(dims.blobs ?? [])].map((b) => b ?? ''),
    doubles: dims.doubles ?? [],
  })
}

/**
 * Pseudonimiza um user_id para uso em eventos (regra LGPD: nunca PII crua nem o id
 * cru, pra não reidentificar). SHA-256 truncado em 64 bits — estável por usuário
 * (permite contar usuários distintos via COUNT(DISTINCT)), não reversível na prática.
 */
export async function hashUserId(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(userId))
  const bytes = new Uint8Array(digest, 0, 8)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

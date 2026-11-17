import type { D1Database } from '@cloudflare/workers-types'
import { footballDataPauseMs, type FootballDataQuota } from './footballDataQuota'

/**
 * Orçamento compartilhado de chamadas à football-data.org (ADR-027).
 *
 * O teto de syncs em paralelo (`FD_MAX_CONCURRENT_REQUESTS`) limita o que roda
 * dentro de uma invocação; o provedor, porém, conta requests por minuto entre
 * execuções. Antes de cada tentativa, o cliente reserva uma vaga na janela de
 * um minuto em `provider_rate_state`, no D1: a reserva é um único UPDATE
 * condicional, e o D1 serializa escritas, então isolates e execuções
 * diferentes dividem o mesmo orçamento. Reserva recusada não consome vaga e
 * não chama o provedor: o chamador decide o que fazer (na fila durável, o item
 * fica pendente).
 *
 * Cobertos pelo orçamento: poller (janela ativa, resgate e varredura de
 * atrasados), descoberta diária, sync administrativo e os retries — todo
 * request à football-data passa por `reserveFootballDataSlot`. Cada tentativa
 * conta, inclusive a que falha.
 *
 * Exceções explícitas, fora do orçamento por serem processos externos sem
 * acesso ao D1 do Worker:
 * - o radar de competições (GitHub Actions, ESPN + Wikimedia, ADR-015), cuja
 *   coordenação é decisão do ticket 03 da resiliência;
 * - `api/scripts/test-results-api.ts`, script local de desenvolvimento.
 */

/** Orçamento por minuto: 80% do free tier documentado (10 req/min). */
export const FD_CALLS_PER_MINUTE = 8

/** Orçamento em vigor; só os testes o mudam (`setFootballDataRateLimitForTests`). */
let rateLimit = FD_CALLS_PER_MINUTE

/**
 * Só para testes: define o orçamento por minuto da janela. Fluxos que
 * sincronizam muitas competições no mesmo minuto num banco de teste sobem o
 * teto para exercitar o pipeline; os testes do orçamento o fixam.
 */
export function setFootballDataRateLimitForTests(rate: number): void {
  rateLimit = rate
}

const WINDOW_MS = 60_000

/**
 * A execução não conseguiu vaga no orçamento compartilhado: nenhuma chamada
 * partiu. Quem recusa fica com o trabalho pendente e retoma depois.
 */
export class FootballDataSlotBusyError extends Error {
  constructor() {
    super('football-data.org: sem vaga no orçamento compartilhado de chamadas')
    this.name = 'FootballDataSlotBusyError'
  }
}

/**
 * Reserva uma vaga na janela de um minuto. Falha com
 * `FootballDataSlotBusyError` quando a janela está cheia ou o provedor está
 * bloqueado por um 429 (`blocked_until`), e propaga a falha de D1: sem vaga
 * confirmada não há chamada descoordenada.
 */
export async function reserveFootballDataSlot(
  db: D1Database,
  now = Date.now(),
): Promise<void> {
  const windowId = Math.floor(now / WINDOW_MS)
  const result = await db
    .prepare(
      `UPDATE provider_rate_state
         SET window_started_at = ?1,
             window_calls = CASE WHEN window_started_at = ?1 THEN window_calls + 1 ELSE 1 END,
             updated_at = ?2
       WHERE provider = 'football-data'
         AND blocked_until <= ?2
         AND NOT (window_started_at = ?1 AND window_calls >= ?3)`,
    )
    .bind(windowId, now, rateLimit)
    .run()
  if ((result.meta?.changes ?? 0) === 0) throw new FootballDataSlotBusyError()
}

/**
 * Grava no orçamento compartilhado a pausa que uma resposta impôs: 429 ou cota
 * zerada com o reset informado (capado por `FD_QUOTA_MAX_PAUSE_MS`) ou, sem
 * reset válido, a espera conservadora. Os isolates já pausam sozinhos
 * (`noteFootballDataResponse`); aqui os outros isolates e execuções ficam
 * sabendo. A pausa nunca encurta uma em curso, e a falha de escrita fica no
 * log: o request já partiu, e a próxima resposta grava o estado.
 */
export async function noteFootballDataBlock(
  db: D1Database,
  status: number,
  quota: FootballDataQuota,
  now = Date.now(),
): Promise<void> {
  const pauseMs = footballDataPauseMs(status, quota)
  if (pauseMs <= 0) return
  try {
    await db
      .prepare(
        `UPDATE provider_rate_state
            SET blocked_until = MAX(blocked_until, ?1),
                last_remaining = ?2,
                last_reset_at = ?3,
                updated_at = ?4
          WHERE provider = 'football-data'`,
      )
      .bind(
        now + pauseMs,
        quota.remaining,
        quota.resetSeconds === null ? null : now + quota.resetSeconds * 1000,
        now,
      )
      .run()
  } catch (err) {
    console.error('[budget] Falha ao gravar o bloqueio da football-data:', err)
  }
}

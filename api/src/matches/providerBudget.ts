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
 * A ESPN usa a mesma razão (ADR-027, adendo do ticket 03): poller, sync
 * administrativo, fallback de resultados e dreno reservam vaga na linha `espn`
 * antes de cada request (`espnAccess.ts`). A descoberta diária só lê o estado de
 * acesso e registra as respostas de erro, sem reservar vaga por request. Além da
 * janela de um minuto, a linha guarda o controle de acesso: a sequência de 403, o
 * bloqueio entre tentativas e a suspensão da coleta.
 *
 * Exceções explícitas, fora do orçamento por serem processos externos sem
 * acesso ao D1 do Worker:
 * - o radar de competições (GitHub Actions, ESPN + Wikimedia, ADR-015): uma
 *   passada diária (`radar-sync.yml`) pelos slugs do recorte, sem binding do
 *   D1 durante a coleta. Não integrado, por decisão do ticket 03;
 * - `api/scripts/test-results-api.ts`, script local de desenvolvimento.
 */

/** Orçamento por minuto: 80% do free tier documentado (10 req/min). */
export const FD_CALLS_PER_MINUTE = 8

/**
 * Orçamento por minuto da ESPN. A API pública não documenta cota: o cliente já
 * espaça os inícios em 1,3 s (~46/min por isolate, ritmo sem 403 Akamai
 * observado). O orçamento compartilhado fica em 40/min, cerca de 87% disso: um
 * isolate sozinho quase não esbarra nele, e ele limita a soma quando duas
 * execuções se sobrepõem, o que o espaçamento por isolate não enxerga.
 */
export const ESPN_CALLS_PER_MINUTE = 40

/** Provedores com linha em `provider_rate_state`. */
export type BudgetedProvider = 'football-data' | 'espn'

/** Orçamento em vigor; só os testes o mudam (`setProviderRateLimitForTests`). */
const rateLimits: Record<BudgetedProvider, number> = {
  'football-data': FD_CALLS_PER_MINUTE,
  espn: ESPN_CALLS_PER_MINUTE,
}

/**
 * Só para testes: define o orçamento por minuto da janela de um provedor.
 * Fluxos que sincronizam muitas competições no mesmo minuto num banco de teste
 * sobem o teto para exercitar o pipeline; os testes do orçamento o fixam.
 */
export function setProviderRateLimitForTests(provider: BudgetedProvider, rate: number): void {
  rateLimits[provider] = rate
}

/** Como `setProviderRateLimitForTests`, para a football-data. */
export function setFootballDataRateLimitForTests(rate: number): void {
  rateLimits['football-data'] = rate
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

/** Espera sugerida a quem encontra a coleta suspensa: o dreno nem a tenta. */
export const SUSPENDED_RECHECK_MS = 6 * 60 * 60_000

/**
 * Resultado de uma reserva. Recusada, diz por quê e quando vale tentar de novo:
 * `window_full` (orçamento do minuto cheio), `blocked` (429, 403 ou cota zerada
 * até `blocked_until`) ou `suspended` (acesso proibido, só o operador retoma).
 */
export type SlotReservation =
  | { granted: true }
  | {
      granted: false
      reason: 'window_full' | 'blocked' | 'suspended'
      retryAt: number
    }

/** Estado de um provedor na razão, para o dreno e o painel. */
export type ProviderAccessState = {
  blockedUntil: number
  forbiddenStreak: number
  suspendedAt: number | null
  suspendedReason: string | null
}

export async function readProviderState(
  db: D1Database,
  provider: BudgetedProvider,
): Promise<ProviderAccessState | null> {
  const row = await db
    .prepare(
      `SELECT blocked_until, forbidden_streak, suspended_at, suspended_reason
         FROM provider_rate_state WHERE provider = ?`,
    )
    .bind(provider)
    .first<{
      blocked_until: number
      forbidden_streak: number
      suspended_at: number | null
      suspended_reason: string | null
    }>()
  if (!row) return null
  return {
    blockedUntil: row.blocked_until,
    forbiddenStreak: row.forbidden_streak,
    suspendedAt: row.suspended_at,
    suspendedReason: row.suspended_reason,
  }
}

async function tryReserve(
  db: D1Database,
  provider: BudgetedProvider,
  windowId: number,
  now: number,
): Promise<boolean> {
  const { results } = await db
    .prepare(
      `UPDATE provider_rate_state
         SET window_started_at = ?1,
             window_calls = CASE WHEN window_started_at = ?1 THEN window_calls + 1 ELSE 1 END,
             updated_at = ?2
       WHERE provider = ?4
         AND blocked_until <= ?2
         AND suspended_at IS NULL
         AND NOT (window_started_at = ?1 AND window_calls >= ?3)
       RETURNING provider`,
    )
    .bind(windowId, now, rateLimits[provider], provider)
    .all<{ provider: string }>()
  return results.length > 0
}

/**
 * Reserva uma vaga na janela de um minuto do provedor. Recusa, sem consumir
 * vaga, quando a janela está cheia, quando um 429/403 bloqueou o provedor até
 * `blocked_until` ou quando a coleta está suspensa. Propaga a falha de D1: sem
 * vaga confirmada não há chamada descoordenada. Linha ausente (migration não
 * aplicada) é criada na hora, para a coleta não parar em silêncio.
 */
export async function reserveProviderSlot(
  db: D1Database,
  provider: BudgetedProvider,
  now = Date.now(),
): Promise<SlotReservation> {
  const windowId = Math.floor(now / WINDOW_MS)
  if (await tryReserve(db, provider, windowId, now)) return { granted: true }

  let state = await readProviderState(db, provider)
  if (!state) {
    await db
      .prepare(`INSERT OR IGNORE INTO provider_rate_state (provider, credential) VALUES (?, ?)`)
      .bind(provider, 'default')
      .run()
    if (await tryReserve(db, provider, windowId, now)) return { granted: true }
    state = await readProviderState(db, provider)
  }
  if (state?.suspendedAt != null) {
    return { granted: false, reason: 'suspended', retryAt: now + SUSPENDED_RECHECK_MS }
  }
  if (state && state.blockedUntil > now) {
    return { granted: false, reason: 'blocked', retryAt: state.blockedUntil }
  }
  return { granted: false, reason: 'window_full', retryAt: (windowId + 1) * WINDOW_MS }
}

/**
 * Reserva uma vaga na janela de um minuto da football-data. Falha com
 * `FootballDataSlotBusyError` quando a janela está cheia ou o provedor está
 * bloqueado por um 429 (`blocked_until`), e propaga a falha de D1: sem vaga
 * confirmada não há chamada descoordenada. É um `UPDATE` só, concedido ou
 * recusado: o dreno paga cada chamada do saldo de subrequests, e quem só
 * precisa saber se coube não lê o estado para explicar a recusa (a ESPN, que
 * informa o prazo da retomada, usa `reserveProviderSlot`).
 */
export async function reserveFootballDataSlot(db: D1Database, now = Date.now()): Promise<void> {
  if (!(await tryReserve(db, 'football-data', Math.floor(now / WINDOW_MS), now))) {
    throw new FootballDataSlotBusyError()
  }
}

/**
 * Retoma um provedor que o controle de acesso bloqueou ou suspendeu: zera a
 * sequência de 403, o bloqueio e a suspensão, e traz para agora o prazo dos
 * itens pendentes dele (o que ficou esperando a suspensão, até 6 h, volta no
 * próximo dreno). Só o operador chama, depois de conferir os termos e a
 * autorização (`docs/observability.md`).
 */
export async function resumeProviderAccess(
  db: D1Database,
  provider: BudgetedProvider,
  now = Date.now(),
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE provider_rate_state
            SET forbidden_streak = 0, blocked_until = 0,
                suspended_at = NULL, suspended_reason = NULL, updated_at = ?2
          WHERE provider = ?1`,
      )
      .bind(provider, now),
    db
      .prepare(
        `UPDATE provider_work SET not_before = ?2, updated_at = ?2
          WHERE provider = ?1 AND status = 'pending' AND not_before > ?2`,
      )
      .bind(provider, now),
  ])
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

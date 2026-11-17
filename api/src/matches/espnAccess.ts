import type { D1Database } from '@cloudflare/workers-types'
import { logError } from '../observability/events'
import { EspnUnavailableError, type EspnBlock, type EspnGate } from '../providers/espn'
import { CallBudgetExhaustedError, type CallGate } from './callBudget'
import { reserveProviderSlot } from './providerBudget'

/**
 * Controle de acesso da ESPN (ADR-027, adendo do ticket 03).
 *
 * A API pública da ESPN não documenta cota nem termos de uso para este caso, e
 * o bloqueio conhecido é o 403 do Akamai em rajadas. O gate liga o cliente
 * HTTP ao orçamento compartilhado no D1 (`provider_rate_state`, linha `espn`)
 * e trata a resposta assim:
 *
 * - 2xx: o acesso funciona; a sequência de 403 zera.
 * - 429: pausa até o `Retry-After` que o fornecedor impôs, no mínimo a espera
 *   conservadora (e essa espera quando o cabeçalho falta ou é inválido), sem
 *   mexer na sequência de 403. Nada repete na hora. Um `Retry-After` absurdo
 *   (acima de 24 h) suspende a coleta para análise, como o 401 e o 451.
 * - 403: limita e espaça as tentativas. Cada 403 seguido sobe a sequência e
 *   adia a próxima tentativa (`ESPN_FORBIDDEN_BACKOFF_MS`); o quarto
 *   suspende a coleta. Um alerta (`provider_access_blocked`) sai a cada passo.
 * - 401 e 451: a resposta proíbe o acesso. A coleta é suspensa na hora.
 *
 * Suspensa, a coleta não volta sozinha: o operador confere os termos e a
 * autorização e a retoma (`resumeProviderAccess`; runbook em
 * `docs/observability.md`). Continuar a tentar um acesso proibido seria
 * desrespeitar a decisão do provedor, e o espaçamento só vale para o que é
 * limite de ritmo.
 */

/** Recusa do orçamento, bloqueio ou suspensão: não é falha do sync, nenhuma tentativa é gasta. */
export function isEspnRefusal(error: unknown): error is EspnUnavailableError {
  return error instanceof EspnUnavailableError
}

/** Espera depois do 1º, 2º e 3º 403 seguidos; o 4º suspende a coleta. */
export const ESPN_FORBIDDEN_BACKOFF_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000] as const

/** 403 seguidos que suspendem a coleta (o 4º). */
export const ESPN_FORBIDDEN_SUSPEND_AFTER = ESPN_FORBIDDEN_BACKOFF_MS.length + 1

/**
 * Pausa mínima de um 429, e a espera quando o `Retry-After` falta ou é inválido.
 * Um `Retry-After` válido maior que isso vale inteiro: o prazo é do fornecedor.
 */
export const ESPN_RATE_LIMIT_PAUSE_MS = 60_000

/**
 * Um `Retry-After` acima disto não é um prazo razoável: a coleta é suspensa para
 * análise (alerta) em vez de esperar dias em silêncio.
 */
export const ESPN_RATE_LIMIT_ABSURD_RETRY_AFTER_MS = 24 * 60 * 60_000

/**
 * Chamadas de uma tentativa à ESPN, quando o dreno as paga do saldo de
 * subrequests: reservar a vaga (1), o `fetch` (1) e registrar a resposta (1).
 */
export const ESPN_REQUEST_CALLS = 3

/** O que o alerta reporta, no formato posicional de `provider_access_blocked`. */
type BlockOutcome = EspnBlock & { status: number; streak: number }

function retryAfterMs(headers: Headers, now: number): number | null {
  const raw = headers.get('retry-after')?.trim() ?? ''
  if (/^\d+$/.test(raw)) return Number(raw) * 1000
  const at = Date.parse(raw)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

/** `Retry-After` que pede mais que o razoável: suspende em vez de esperar. */
function isAbsurdRetryAfter(retryAfter: number | null): boolean {
  return retryAfter !== null && retryAfter > ESPN_RATE_LIMIT_ABSURD_RETRY_AFTER_MS
}

type Forbidden403Row = {
  forbidden_streak: number
  blocked_until: number
  suspended_at: number | null
}

/**
 * Um único UPDATE: o D1 serializa escritas, então dois isolates que recebem o
 * 403 ao mesmo tempo contam um passo só. A resposta que chega com o bloqueio já
 * vigente (uma tentativa que saiu antes dele) não sobe a sequência nem o
 * adia. Todos os lados do `SET` leem a linha original.
 */
async function noteForbidden(db: D1Database, now: number): Promise<BlockOutcome> {
  const [first, second, third] = ESPN_FORBIDDEN_BACKOFF_MS
  const { results } = await db
    .prepare(
      `UPDATE provider_rate_state
          SET forbidden_streak = CASE WHEN blocked_until <= ?1 AND suspended_at IS NULL
                                      THEN forbidden_streak + 1 ELSE forbidden_streak END,
              suspended_at = CASE WHEN suspended_at IS NULL AND blocked_until <= ?1
                                       AND forbidden_streak + 1 >= ?2
                                  THEN ?1 ELSE suspended_at END,
              suspended_reason = CASE WHEN suspended_at IS NULL AND blocked_until <= ?1
                                           AND forbidden_streak + 1 >= ?2
                                      THEN 'http_403' ELSE suspended_reason END,
              blocked_until = CASE WHEN blocked_until > ?1 OR suspended_at IS NOT NULL
                                        OR forbidden_streak + 1 >= ?2
                                   THEN blocked_until
                                   ELSE ?1 + CASE forbidden_streak
                                               WHEN 0 THEN ?3 WHEN 1 THEN ?4 ELSE ?5 END
                              END,
              updated_at = ?1
        WHERE provider = 'espn'
        RETURNING forbidden_streak, blocked_until, suspended_at`,
    )
    .bind(now, ESPN_FORBIDDEN_SUSPEND_AFTER, first, second, third)
    .all<Forbidden403Row>()
  const row = results[0]
  if (!row) throw new Error('linha da ESPN ausente em provider_rate_state')
  return {
    status: 403,
    streak: row.forbidden_streak,
    reason: row.suspended_at === null ? 'blocked' : 'suspended',
    retryAt: row.blocked_until,
  }
}

/**
 * A resposta proíbe o acesso (401 e 451) ou pede uma espera que não é razoável
 * (429 com `Retry-After` absurdo): a coleta é suspensa na hora, com o motivo.
 */
async function suspendProhibited(
  db: D1Database,
  status: number,
  now: number,
  reason: string,
): Promise<BlockOutcome> {
  const { results } = await db
    .prepare(
      `UPDATE provider_rate_state
          SET suspended_at = COALESCE(suspended_at, ?1),
              suspended_reason = COALESCE(suspended_reason, ?2),
              updated_at = ?1
        WHERE provider = 'espn'
        RETURNING forbidden_streak, blocked_until`,
    )
    .bind(now, reason)
    .all<{ forbidden_streak: number; blocked_until: number }>()
  const row = results[0]
  return {
    status,
    streak: row?.forbidden_streak ?? 0,
    reason: 'suspended',
    retryAt: Math.max(row?.blocked_until ?? 0, now),
  }
}

/**
 * Bloqueio de um 429: o maior entre o `Retry-After` válido e a pausa mínima
 * conservadora, sem teto (só o absurdo suspende, antes de chegar aqui).
 */
async function pauseRateLimited(
  db: D1Database,
  retryAfterMs: number | null,
  now: number,
): Promise<BlockOutcome> {
  const until = now + Math.max(retryAfterMs ?? 0, ESPN_RATE_LIMIT_PAUSE_MS)
  const { results } = await db
    .prepare(
      `UPDATE provider_rate_state
          SET blocked_until = MAX(blocked_until, ?1), updated_at = ?2
        WHERE provider = 'espn'
        RETURNING blocked_until, forbidden_streak`,
    )
    .bind(until, now)
    .all<{ blocked_until: number; forbidden_streak: number }>()
  return {
    status: 429,
    streak: results[0]?.forbidden_streak ?? 0,
    reason: 'blocked',
    retryAt: results[0]?.blocked_until ?? until,
  }
}

/**
 * O acesso funcionou: a sequência de 403 zera. Atômico no D1 e sem depender do
 * que a reserva viu: dois isolates reservam antes de qualquer resposta, então a
 * sequência que a reserva carregava (0) pode já estar velha quando o sucesso
 * chega depois de um 403 concorrente. A última resposta, na ordem em que o D1 as
 * grava, vence: sucesso depois de 403 zera; 403 depois de sucesso conta 1. O
 * `WHERE` evita gravação quando não há sequência a zerar (o caso comum), e não
 * levanta o bloqueio que um 403 já impôs: ele espaça a coleta e vale até o fim.
 */
async function resetForbiddenStreak(db: D1Database, now: number): Promise<void> {
  await db
    .prepare(
      `UPDATE provider_rate_state SET forbidden_streak = 0, updated_at = ?1
        WHERE provider = 'espn' AND forbidden_streak != 0`,
    )
    .bind(now)
    .run()
}

/**
 * Registra a resposta no D1 e devolve o bloqueio que ela impôs, ou `null`.
 * Se a gravação falha, o request já partiu: devolve a estimativa local do
 * bloqueio e deixa a falha no log, como o orçamento da football-data.
 */
async function noteEspnResponse(
  db: D1Database,
  status: number,
  headers: Headers,
  now: number,
): Promise<BlockOutcome | null> {
  if (status >= 200 && status < 400) {
    await resetForbiddenStreak(db, now)
    return null
  }
  if (status === 429) {
    const retryAfter = retryAfterMs(headers, now)
    return isAbsurdRetryAfter(retryAfter)
      ? suspendProhibited(db, status, now, 'http_429_retry_after')
      : pauseRateLimited(db, retryAfter, now)
  }
  if (status === 403) return noteForbidden(db, now)
  if (status === 401 || status === 451) return suspendProhibited(db, status, now, `http_${status}`)
  return null
}

/** Estimativa quando o D1 não gravou: o bloqueio mais curto da regra do status. */
function localEstimate(status: number, headers: Headers, now: number): BlockOutcome | null {
  if (status === 429) {
    const retryAfter = retryAfterMs(headers, now)
    if (isAbsurdRetryAfter(retryAfter)) return { status, streak: 0, reason: 'suspended', retryAt: now }
    return {
      status,
      streak: 0,
      reason: 'blocked',
      retryAt: now + Math.max(retryAfter ?? 0, ESPN_RATE_LIMIT_PAUSE_MS),
    }
  }
  if (status === 403) {
    return { status, streak: 1, reason: 'blocked', retryAt: now + ESPN_FORBIDDEN_BACKOFF_MS[0] }
  }
  if (status === 401 || status === 451) {
    return { status, streak: 0, reason: 'suspended', retryAt: now }
  }
  return null
}

/**
 * Gate da ESPN sobre o D1: reserva a vaga no orçamento compartilhado e
 * registra o bloqueio de cada resposta. `ae` recebe o alerta
 * `provider_access_blocked` a cada 403 que espaça a coleta e na suspensão;
 * 429 já tem `provider_http_attempt`.
 *
 * Com `callGate` (o dreno, ADR-027), cada tentativa cabe no saldo de
 * subrequests da invocação: a vaga, o `fetch` e o registro da resposta saem
 * juntos ou nenhum sai, e o `fetch`, retry incluído, é cobrado antes de partir.
 * O registro da resposta precisa caber porque um 403 ou 429 que só ficasse no
 * isolate deixaria as outras execuções insistirem.
 */
export function createEspnGate(
  db: D1Database,
  ae?: AnalyticsEngineDataset,
  callGate?: CallGate,
): EspnGate {
  return {
    async reserve() {
      if (callGate && callGate.callsLeft() < ESPN_REQUEST_CALLS) {
        throw new CallBudgetExhaustedError()
      }
      const reservation = await reserveProviderSlot(db, 'espn', Date.now())
      if (!reservation.granted) {
        throw new EspnUnavailableError(reservation.reason, reservation.retryAt)
      }
      callGate?.chargeFetch()
    },
    async note(status, headers) {
      const now = Date.now()
      let outcome: BlockOutcome | null
      try {
        outcome = await noteEspnResponse(db, status, headers, now)
      } catch (err) {
        console.error('[espn] Falha ao gravar o estado de acesso da ESPN:', err)
        outcome = localEstimate(status, headers, now)
      }
      // O 429 comum já tem `provider_http_attempt`; a suspensão por Retry-After absurdo alerta.
      if (outcome && (outcome.status !== 429 || outcome.reason === 'suspended')) {
        alertAccessBlocked(ae, outcome, now)
      }
      return outcome && { reason: outcome.reason, retryAt: outcome.retryAt }
    },
  }
}

/** Alerta de acesso bloqueado ou suspenso, no log e no Analytics Engine. */
function alertAccessBlocked(
  ae: AnalyticsEngineDataset | undefined,
  outcome: BlockOutcome,
  now: number,
): void {
  const suspended = outcome.reason === 'suspended'
  const message = suspended
    ? outcome.status === 429
      ? `[espn] Retry-After acima de ${ESPN_RATE_LIMIT_ABSURD_RETRY_AFTER_MS / 3_600_000} h (HTTP 429): coleta SUSPENSA até o operador analisar e retomar.`
      : `[espn] Acesso proibido (HTTP ${outcome.status}): coleta SUSPENSA até o operador conferir os termos e retomar.`
    : `[espn] Acesso bloqueado (HTTP ${outcome.status}, ${outcome.streak}º seguido): nova tentativa a partir de ${new Date(outcome.retryAt).toISOString()}.`
  logError(ae, 'provider_access_blocked', message, new Error(`HTTP ${outcome.status}`), {
    // provider, status, estado
    blobs: ['espn', String(outcome.status), suspended ? 'suspended' : 'backoff'],
    // 403 seguidos, minutos até a nova tentativa
    doubles: [outcome.streak, Math.max(0, Math.round((outcome.retryAt - now) / 60_000))],
  })
}

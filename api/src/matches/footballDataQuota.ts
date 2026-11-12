/**
 * Orçamento do free tier football-data.org.
 *
 * A API limita a 10 requests/minuto (header `X-Requests-Available-Minute`).
 * Discovery (1×/dia, fora do pico) e poller (~30 min) compartilham esta cota.
 * `FD_MAX_CONCURRENT_REQUESTS` fica abaixo de 10 para deixar folga a retries e
 * sobreposição ocasional entre jobs no mesmo minuto. Um 429 ou a cota zerada
 * pausam as chamadas do isolate até o reset informado (`noteFootballDataResponse`).
 */

/** Limite documentado do free tier (requests por minuto). */
export const FD_FREE_REQUESTS_PER_MINUTE = 10

/**
 * Teto de syncs football-data em paralelo por ciclo (poller/discovery).
 * Estritamente menor que `FD_FREE_REQUESTS_PER_MINUTE`.
 */
export const FD_MAX_CONCURRENT_REQUESTS = 4

/**
 * Espera mínima antes do único retry de um HTTP 429. A espera real segue o reset
 * que a resposta informa (`noteFootballDataResponse`).
 */
export const FD_RETRY_BACKOFF_MS = 6_000

/** Tempo máximo de um request à football-data antes de abortar. */
export const FD_TIMEOUT_MS = 10_000

/**
 * Executa `worker` sobre `items` com no máximo `limit` promessas em voo.
 * Preserva a ordem dos resultados. `limit < 1` trata como 1.
 */
export async function runWithConcurrency<T, R>(
  limit: number,
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return []

  const concurrency = Math.max(1, Math.min(limit, items.length))
  const results = Array.from({ length: items.length }) as R[]
  let nextIndex = 0

  const runners = Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = nextIndex++
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
    }
  })

  await Promise.all(runners)
  return results
}

/**
 * Pausa quando o 429, ou a resposta com cota zerada, chega sem reset legível:
 * uma janela inteira do free tier.
 */
export const FD_QUOTA_DEFAULT_PAUSE_MS = 60_000

/**
 * Teto de uma pausa, mesmo que o cabeçalho peça mais. Um valor absurdo ou de
 * outra janela (a cota anônima zera em 86.400 s) não trava o serviço.
 */
export const FD_QUOTA_MAX_PAUSE_MS = 60 * 60_000

/**
 * Maior espera dentro de uma chamada. Cobre o reset de uma janela de um minuto;
 * acima disso a chamada falha sem request e o próximo ciclo tenta de novo.
 */
export const FD_QUOTA_MAX_WAIT_MS = 65_000

/** Cota informada numa resposta da football-data. */
export type FootballDataQuota = {
  /** Requests restantes na janela; `null` sem cabeçalho válido. */
  remaining: number | null
  /** Segundos até zerar o contador (o maior valor válido entre os cabeçalhos); `null` sem nenhum. */
  resetSeconds: number | null
}

/**
 * Grafias vistas para os mesmos dados. Resposta autenticada real (12/11/2026,
 * fixture em `__fixtures__/football-data-headers-200.json`):
 * `x-requests-available-minute`, `X-RequestCounter-Reset` e
 * `x-request_counter-reset`. A documentação cita `X-RequestsAvailable`; a
 * resposta anônima trouxe `X-Requests-Available`.
 */
const REMAINING_HEADERS = [
  'x-requests-available-minute',
  'x-requests-available',
  'x-requestsavailable',
]
const RESET_HEADERS = ['x-requestcounter-reset', 'x-request_counter-reset']

type HeaderReader = { get(name: string): string | null }

function nonNegativeInt(value: string | null): number | null {
  const trimmed = value?.trim() ?? ''
  return /^\d+$/.test(trimmed) ? Number(trimmed) : null
}

/** Data HTTP (IMF-fixdate), ex.: `Thu, 12 Nov 2026 12:02:13 GMT`. */
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/

/** `Retry-After` em segundos ou como data HTTP. `-5` não é data, é inválido. */
function retryAfterSeconds(value: string | null, now: number): number | null {
  const seconds = nonNegativeInt(value)
  const trimmed = value?.trim() ?? ''
  if (seconds !== null || !HTTP_DATE.test(trimmed)) return seconds
  const at = Date.parse(trimmed)
  return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000))
}

/** Lê a cota dos cabeçalhos. Ausente ou inválido vira `null`, nunca erro. */
export function readFootballDataQuota(
  headers: HeaderReader | undefined,
  now: number,
): FootballDataQuota {
  if (!headers) return { remaining: null, resetSeconds: null }
  const remaining = REMAINING_HEADERS.map((name) => nonNegativeInt(headers.get(name))).find(
    (value) => value !== null,
  )
  const resets = [
    ...RESET_HEADERS.map((name) => nonNegativeInt(headers.get(name))),
    retryAfterSeconds(headers.get('retry-after'), now),
  ].filter((value): value is number => value !== null)
  return {
    remaining: remaining ?? null,
    resetSeconds: resets.length > 0 ? Math.max(...resets) : null,
  }
}

/** A chamada não saiu: a pausa vai além de `FD_QUOTA_MAX_WAIT_MS`. */
export class FootballDataQuotaError extends Error {
  constructor(readonly retryAt: number) {
    super(
      `football-data.org: cota esgotada, nova tentativa a partir de ${new Date(retryAt).toISOString()}`,
    )
    this.name = 'FootballDataQuotaError'
  }
}

/**
 * Instante até o qual este isolate não chama a football-data. Vale só para o
 * isolate: outro isolate, o radar e scripts locais não enxergam esta pausa. A
 * coordenação entre eles é do backlog de resiliência (orçamento compartilhado).
 */
let pausedUntil = 0

export function footballDataPausedUntil(): number {
  return pausedUntil
}

/** Só para testes: simula um isolate novo. */
export function clearFootballDataPause(): void {
  pausedUntil = 0
}

/**
 * Pausa o isolate depois de um 429 ou de uma resposta com cota zerada, pelo
 * reset informado. Sem reset válido usa `FD_QUOTA_DEFAULT_PAUSE_MS`; o 429
 * nunca pausa menos que `FD_RETRY_BACKOFF_MS`; nada passa de
 * `FD_QUOTA_MAX_PAUSE_MS`. Uma pausa em curso nunca encurta.
 */
export function noteFootballDataResponse(
  status: number,
  quota: FootballDataQuota,
  now: number,
): void {
  if (status !== 429 && quota.remaining !== 0) return
  const resetMs =
    quota.resetSeconds === null ? FD_QUOTA_DEFAULT_PAUSE_MS : quota.resetSeconds * 1000
  const floorMs = status === 429 ? FD_RETRY_BACKOFF_MS : 0
  const pauseMs = Math.min(FD_QUOTA_MAX_PAUSE_MS, Math.max(floorMs, resetMs))
  pausedUntil = Math.max(pausedUntil, now + pauseMs)
}

/**
 * Espera a pausa do isolate antes de um request. Pausa maior que
 * `FD_QUOTA_MAX_WAIT_MS` falha na hora, sem request.
 */
export async function waitForFootballDataQuota(): Promise<void> {
  for (;;) {
    const waitMs = pausedUntil - Date.now()
    if (waitMs <= 0) return
    if (waitMs > FD_QUOTA_MAX_WAIT_MS) throw new FootballDataQuotaError(pausedUntil)
    await new Promise((resolve) => setTimeout(resolve, waitMs))
  }
}

import { logEvent } from './events'

/**
 * Telemetria por tentativa HTTP aos provedores de partidas (ESPN e
 * football-data.org). Cada `fetch` vira no máximo um `provider_http_attempt`,
 * inclusive o retry de 429/5xx. Layout posicional em `docs/observability.md`.
 *
 * Volume: toda falha (4xx/5xx e erro de rede/timeout, status `0`) é emitida;
 * sucessos entram numa amostra de `HTTP_SUCCESS_SAMPLE_RATE`. Cada evento leva
 * o próprio peso (`double2`) para o painel estimar o total sem fixar a taxa:
 * 1 para falha, `1 / taxa` para sucesso amostrado.
 *
 * Cota: na football-data, `double3` e `double4` levam as requests restantes e
 * os segundos até o reset que a resposta informou (`-1` sem cabeçalho válido).
 * Resposta com cota zerada sai sempre, como uma falha.
 *
 * Privacidade: só provedor, status, contexto, duração, cota e `competition_id`
 * (UUID interno). Nunca URL, query, slug, chave de API nem corpo da resposta.
 */

export type ProviderName = 'espn' | 'football-data'

/** Quem disparou a tentativa. */
export type ProviderHttpContext = 'poller' | 'discovery' | 'fallback' | 'sync'

export type ProviderHttpAttempt = {
  provider: ProviderName
  /** Status HTTP; `0` quando não houve resposta (rede, timeout, abort). */
  status: number
  durationMs: number
  /**
   * Cota que a resposta informou (só football-data). `null` = cabeçalho ausente
   * ou inválido; `undefined` = provedor sem cota informada (ESPN).
   */
  quotaRemaining?: number | null
  /** Segundos até zerar o contador da cota; mesma convenção de `quotaRemaining`. */
  quotaResetSeconds?: number | null
}

/** Chamado pelo cliente do provedor depois de cada tentativa. Nunca lança. */
export type ProviderHttpObserver = (attempt: ProviderHttpAttempt) => void

/** Fração dos sucessos (2xx/3xx) que vira evento. */
export const HTTP_SUCCESS_SAMPLE_RATE = 0.1

/** Falha = sem resposta (0) ou 4xx/5xx. */
export function isHttpFailure(status: number): boolean {
  return status === 0 || status >= 400
}

export type ProviderHttpScope = {
  context: ProviderHttpContext
  /** UUID da competição no D1, quando a chamada é de uma competição conhecida. */
  competitionId?: string
}

/**
 * Observer que escreve no Analytics Engine. Sem binding devolve `undefined`:
 * os clientes não medem nada em dev local, no radar (GitHub Actions) e nos
 * testes que não passam `ae`. `random` existe para os testes fixarem a amostra.
 */
export function createProviderHttpObserver(
  ae: AnalyticsEngineDataset | undefined,
  scope: ProviderHttpScope,
  random: () => number = Math.random,
): ProviderHttpObserver | undefined {
  if (!ae) return undefined

  return ({ provider, status, durationMs, quotaRemaining, quotaResetSeconds }) => {
    // Cota zerada sai sempre, com peso 1, e fica fora da amostra dos sucessos.
    const exact = isHttpFailure(status) || quotaRemaining === 0
    if (!exact && random() >= HTTP_SUCCESS_SAMPLE_RATE) return

    const doubles = [Math.max(0, Math.round(durationMs)), exact ? 1 : 1 / HTTP_SUCCESS_SAMPLE_RATE]
    if (quotaRemaining !== undefined || quotaResetSeconds !== undefined) {
      doubles.push(quotaRemaining ?? -1, quotaResetSeconds ?? -1)
    }

    try {
      logEvent(ae, 'provider_http_attempt', {
        blobs: [provider, scope.competitionId ?? '', String(status), scope.context],
        doubles,
      })
    } catch {
      // Telemetria nunca derruba nem altera o sync.
    }
  }
}

/** Avisa o observer sem deixar um erro dele escapar para o cliente do provedor. */
export function notifyHttpAttempt(
  observer: ProviderHttpObserver | undefined,
  attempt: ProviderHttpAttempt,
): void {
  if (!observer) return
  try {
    observer(attempt)
  } catch {
    // idem: observabilidade não muda o resultado do fetch.
  }
}

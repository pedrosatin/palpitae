/**
 * Alerta proporcional de falhas de login no painel admin.
 *
 * Limiares calibrados em 2026-11-02 com agregados do Analytics Engine
 * (SUM(_sample_interval), sessão admin em /admin/metricas), sem PII:
 *
 * | Janela | sucessos | falhas | tentativas | proporção |
 * | 7d     | 6        | 1      | 7          | 14%       |
 * | 30d    | 21       | 5      | 26         | 19%       |
 * | 90d    | 196      | 11     | 207        | 5%        |
 *
 * Semanas com volume ≥15 (ago/2026) ficaram em 0–8%. O baseline de 90d é ~5%.
 * MIN_ATTEMPTS=10 evita alerta por evento isolado na janela curta (ex.: 1/7).
 * RATE_THRESHOLD=0,15 (~3× o baseline e acima das semanas saudáveis) captura
 * o 30d elevado (~19%) sem acender no 90d saudável (~5%).
 *
 * Tentativa = login_success + login_failure. oauth_error fica fora da proporção
 * (etapa anterior ao callback com cookies) e continua em erros recentes.
 */

/** Mínimo de tentativas (sucesso + falha) na janela antes de alertar. */
export const LOGIN_FAILURE_MIN_ATTEMPTS = 10

/** Proporção falha/(sucesso+falha) a partir da qual o alerta acende. */
export const LOGIN_FAILURE_RATE_THRESHOLD = 0.15

export type LoginFailureAlertInput = {
  loginSuccess: number
  loginFailures: number
}

export type LoginFailureAlert = {
  failures: number
  attempts: number
  rate: number
  /** Rótulo curto para a faixa de status do painel. */
  label: string
}

export function evaluateLoginFailureAlert(
  input: LoginFailureAlertInput,
): LoginFailureAlert | null {
  const successes = Math.max(0, Number(input.loginSuccess) || 0)
  const failures = Math.max(0, Number(input.loginFailures) || 0)
  const attempts = successes + failures
  if (attempts < LOGIN_FAILURE_MIN_ATTEMPTS) return null
  if (failures === 0) return null
  const rate = failures / attempts
  if (rate < LOGIN_FAILURE_RATE_THRESHOLD) return null
  const pct = Math.round(rate * 100)
  return {
    failures,
    attempts,
    rate,
    label: `${failures} falha(s) de login (${pct}% de ${attempts})`,
  }
}

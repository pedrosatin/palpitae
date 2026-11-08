/**
 * Alerta proporcional de falhas de login no painel admin.
 *
 * Limiares calibrados em 2026-11-02 com agregados do Analytics Engine
 * (SUM(_sample_interval), sessão admin em /admin/metricas), sem PII:
 *
 * | Janela | sucessos | falhas | callbacks | proporção |
 * | 7d     | 6        | 1      | 7          | 14%       |
 * | 30d    | 21       | 5      | 26         | 19%       |
 * | 90d    | 196      | 11     | 207        | 5%        |
 *
 * Semanas com volume ≥15 (ago/2026) ficaram em 0–8%. O baseline de 90d é ~5%.
 * MIN_CALLBACKS=10 evita alerta por evento isolado na janela curta (ex.: 1/7).
 * RATE_THRESHOLD=0,15 (~3× o baseline e acima das semanas saudáveis) captura
 * o 30d elevado (~19%) sem acender no 90d saudável (~5%).
 *
 * Denominador = callbacks registrados com `login_success` ou `login_failure`.
 * Pontos cegos fora da proporção: `oauth_error` (Google recusou antes do
 * callback com cookies), abandono (usuário nunca voltou) e ausência de
 * callback. A proporção não cobre todas as tentativas de login e não afirma
 * sucesso do fluxo inteiro.
 *
 * A janela selecionada no painel (7/30/90d) é média lenta: rajadas curtas
 * podem diluir-se; em 7d o volume mínimo pode não ser atingido. O canal é o
 * próprio painel; não há alerta automático push nesta fatia.
 *
 * 15% / 10 é heurística sujeita a falso alerta e a degraus ao trocar a
 * janela. Com os dados da calibração o painel já acende em 30d. Conduta:
 * inspecionar a tabela por motivo e reavaliar; não tratar o limiar como
 * precisão estatística.
 *
 * Contagens vêm de SUM(_sample_interval) e podem ser fracionárias sob
 * sampling. O rótulo arredonda; se a média de sampling for >1 ou a contagem
 * for fracionária, o rótulo marca estimativa (≈).
 *
 * Ausência de `login_success` em `totals` é zero legítimo: a SQL do overview
 * só devolve event_types presentes no período (GROUP BY). Não confundir com
 * dado ausente nem inventar detecção de integridade.
 *
 * `state_mismatch` é motivo distinto (state do cookie ≠ state do callback).
 * Avaliar separadamente na tabela por motivo; a proporção agregada não cria
 * regra específica para ele.
 */

/** Mínimo de callbacks (login_success + login_failure) na janela antes de alertar. */
export const LOGIN_FAILURE_MIN_CALLBACKS = 10

/** Proporção falha/(sucesso+falha) a partir da qual o alerta acende (heurística). */
export const LOGIN_FAILURE_RATE_THRESHOLD = 0.15

export type LoginFailureAlertInput = {
  loginSuccess: number
  loginFailures: number
  /** Média de `_sample_interval` no período; >1 marca o rótulo como estimativa. */
  avgSampleInterval?: number
}

export type LoginFailureAlert = {
  failures: number
  /** Callbacks registrados: login_success + login_failure. */
  callbacks: number
  rate: number
  /** True quando sampling ou contagem fracionária tornam o rótulo estimativa. */
  estimated: boolean
  /** Rótulo curto para a faixa de status do painel. */
  label: string
}

export function evaluateLoginFailureAlert(input: LoginFailureAlertInput): LoginFailureAlert | null {
  const successes = Math.max(0, Number(input.loginSuccess) || 0)
  const failures = Math.max(0, Number(input.loginFailures) || 0)
  const callbacks = successes + failures
  if (callbacks < LOGIN_FAILURE_MIN_CALLBACKS) return null
  if (failures === 0) return null
  const rate = failures / callbacks
  if (rate < LOGIN_FAILURE_RATE_THRESHOLD) return null

  const avgSample = Number(input.avgSampleInterval)
  const samplingActive = Number.isFinite(avgSample) && avgSample > 1
  const fractional = !Number.isInteger(failures) || !Number.isInteger(successes)
  const estimated = samplingActive || fractional

  const displayFailures = Math.round(failures)
  const displayCallbacks = Math.round(callbacks)
  const pct = Math.round(rate * 100)
  const approx = estimated ? '≈' : ''

  return {
    failures,
    callbacks,
    rate,
    estimated,
    label: `${approx}${displayFailures} falha(s) de login (${pct}% de ${approx}${displayCallbacks})`,
  }
}

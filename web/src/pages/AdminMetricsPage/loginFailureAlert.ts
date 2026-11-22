
/** Mínimo de callbacks (login_success + login_failure) na janela antes de alertar. */
export const LOGIN_FAILURE_MIN_CALLBACKS = 10

/** Proporção falha/(sucesso+falha) a partir da qual o alerta acende (heurística). */
export const LOGIN_FAILURE_RATE_THRESHOLD = 0.15

export type LoginFailureAlertInput = {
  loginSuccess: number
  loginFailures: number
  avgSampleInterval?: number
}

export type LoginFailureAlert = {
  failures: number
  callbacks: number
  rate: number
  estimated: boolean
  label: string
}

export function evaluateLoginFailureAlert(
  input: LoginFailureAlertInput,
): LoginFailureAlert | null {
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

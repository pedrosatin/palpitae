import { describe, expect, it } from 'vitest'
import {
  evaluateLoginFailureAlert,
  LOGIN_FAILURE_MIN_ATTEMPTS,
  LOGIN_FAILURE_RATE_THRESHOLD,
} from './loginFailureAlert'

describe('evaluateLoginFailureAlert', () => {
  it('não alerta com zero falhas mesmo com volume alto', () => {
    expect(
      evaluateLoginFailureAlert({ loginSuccess: 50, loginFailures: 0 }),
    ).toBeNull()
  })

  it('não alerta por falha isolada abaixo do volume mínimo', () => {
    // Fronteira real 7d (2026-11-02): 6 sucessos + 1 falha → N=7 < 10
    expect(
      evaluateLoginFailureAlert({ loginSuccess: 6, loginFailures: 1 }),
    ).toBeNull()
    expect(
      evaluateLoginFailureAlert({
        loginSuccess: LOGIN_FAILURE_MIN_ATTEMPTS - 2,
        loginFailures: 1,
      }),
    ).toBeNull()
  })

  it('não alerta no volume mínimo se a proporção fica abaixo do limiar', () => {
    // Baseline 90d ~5%: 11 falhas em 207 tentativas
    expect(
      evaluateLoginFailureAlert({ loginSuccess: 196, loginFailures: 11 }),
    ).toBeNull()
    // 1/10 = 10% < 15%, com volume exatamente no mínimo
    expect(
      evaluateLoginFailureAlert({
        loginSuccess: LOGIN_FAILURE_MIN_ATTEMPTS - 1,
        loginFailures: 1,
      }),
    ).toBeNull()
  })

  it('alerta no 30d elevado (volume e proporção acima dos limiares)', () => {
    // Fronteira real 30d (2026-11-02): 21 sucessos + 5 falhas → 19%
    const alert = evaluateLoginFailureAlert({ loginSuccess: 21, loginFailures: 5 })
    expect(alert).not.toBeNull()
    expect(alert?.failures).toBe(5)
    expect(alert?.attempts).toBe(26)
    expect(alert?.rate).toBeCloseTo(5 / 26, 5)
    expect(alert?.label).toBe('5 falha(s) de login (19% de 26)')
  })

  it('alerta na fronteira exata do volume mínimo com proporção no limiar', () => {
    const attempts = LOGIN_FAILURE_MIN_ATTEMPTS
    const failures = Math.ceil(attempts * LOGIN_FAILURE_RATE_THRESHOLD)
    const successes = attempts - failures
    const alert = evaluateLoginFailureAlert({
      loginSuccess: successes,
      loginFailures: failures,
    })
    expect(alert).not.toBeNull()
    expect(alert?.attempts).toBe(attempts)
    expect(alert?.failures).toBe(failures)
  })

  it('trata contagens inválidas como zero e não alerta', () => {
    expect(
      evaluateLoginFailureAlert({
        loginSuccess: Number.NaN,
        loginFailures: Number.NaN,
      }),
    ).toBeNull()
    expect(
      evaluateLoginFailureAlert({ loginSuccess: -3, loginFailures: -1 }),
    ).toBeNull()
  })

  it('login bem-sucedido dominante com poucas falhas não acende', () => {
    expect(
      evaluateLoginFailureAlert({ loginSuccess: 40, loginFailures: 2 }),
    ).toBeNull()
  })
})

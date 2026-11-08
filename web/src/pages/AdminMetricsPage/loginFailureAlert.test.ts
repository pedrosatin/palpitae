import { describe, expect, it } from 'vitest'
import {
  evaluateLoginFailureAlert,
  LOGIN_FAILURE_MIN_CALLBACKS,
  LOGIN_FAILURE_RATE_THRESHOLD,
} from './loginFailureAlert'

describe('evaluateLoginFailureAlert', () => {
  it('não alerta com zero falhas mesmo com volume alto', () => {
    expect(evaluateLoginFailureAlert({ loginSuccess: 50, loginFailures: 0 })).toBeNull()
  })

  it('não alerta por falha isolada abaixo do volume mínimo', () => {
    // Fronteira real 7d (2026-11-02): 6 sucessos + 1 falha → N=7 < 10
    expect(evaluateLoginFailureAlert({ loginSuccess: 6, loginFailures: 1 })).toBeNull()
    expect(
      evaluateLoginFailureAlert({
        loginSuccess: LOGIN_FAILURE_MIN_CALLBACKS - 2,
        loginFailures: 1,
      }),
    ).toBeNull()
  })

  it('não alerta no volume mínimo se a proporção fica abaixo do limiar', () => {
    // Baseline 90d ~5%: 11 falhas em 207 callbacks
    expect(evaluateLoginFailureAlert({ loginSuccess: 196, loginFailures: 11 })).toBeNull()
    // 1/10 = 10% < 15%, com volume exatamente no mínimo
    expect(
      evaluateLoginFailureAlert({
        loginSuccess: LOGIN_FAILURE_MIN_CALLBACKS - 1,
        loginFailures: 1,
      }),
    ).toBeNull()
  })

  it('alerta no 30d elevado (volume e proporção acima dos limiares)', () => {
    // Fronteira real 30d (2026-11-02): 21 sucessos + 5 falhas → 19%
    const alert = evaluateLoginFailureAlert({ loginSuccess: 21, loginFailures: 5 })
    expect(alert).not.toBeNull()
    expect(alert?.failures).toBe(5)
    expect(alert?.callbacks).toBe(26)
    expect(alert?.rate).toBeCloseTo(5 / 26, 5)
    expect(alert?.estimated).toBe(false)
    expect(alert?.label).toBe('5 falha(s) de login (19% de 26)')
  })

  it('alerta na fronteira exata do volume mínimo com proporção no limiar', () => {
    const callbacks = LOGIN_FAILURE_MIN_CALLBACKS
    const failures = Math.ceil(callbacks * LOGIN_FAILURE_RATE_THRESHOLD)
    const successes = callbacks - failures
    const alert = evaluateLoginFailureAlert({
      loginSuccess: successes,
      loginFailures: failures,
    })
    expect(alert).not.toBeNull()
    expect(alert?.callbacks).toBe(callbacks)
    expect(alert?.failures).toBe(failures)
  })

  it('alerta na taxa exata de 15% com 20 callbacks (3/20)', () => {
    const alert = evaluateLoginFailureAlert({ loginSuccess: 17, loginFailures: 3 })
    expect(alert).not.toBeNull()
    expect(alert?.callbacks).toBe(20)
    expect(alert?.failures).toBe(3)
    expect(alert?.rate).toBeCloseTo(0.15, 10)
    expect(alert?.label).toBe('3 falha(s) de login (15% de 20)')
  })

  it('trata contagens inválidas como zero e não alerta', () => {
    expect(
      evaluateLoginFailureAlert({
        loginSuccess: Number.NaN,
        loginFailures: Number.NaN,
      }),
    ).toBeNull()
    expect(evaluateLoginFailureAlert({ loginSuccess: -3, loginFailures: -1 })).toBeNull()
  })

  it('login bem-sucedido dominante com poucas falhas não acende', () => {
    expect(evaluateLoginFailureAlert({ loginSuccess: 40, loginFailures: 2 })).toBeNull()
  })

  it('ausência de sucessos com falhas suficientes acende (zero legítimo)', () => {
    // totals sem login_success → 0; API só devolve event_types presentes.
    const alert = evaluateLoginFailureAlert({ loginSuccess: 0, loginFailures: 10 })
    expect(alert).not.toBeNull()
    expect(alert?.callbacks).toBe(10)
    expect(alert?.rate).toBe(1)
    expect(alert?.label).toBe('10 falha(s) de login (100% de 10)')
  })

  it('contagem fracionária de sampling: rótulo arredondado e marcado como estimativa', () => {
    // 2,4 / (12,6 + 2,4) = 2,4/15 = 16% ≥ 15%, N=15 ≥ 10
    const alert = evaluateLoginFailureAlert({
      loginSuccess: 12.6,
      loginFailures: 2.4,
    })
    expect(alert).not.toBeNull()
    expect(alert?.estimated).toBe(true)
    expect(alert?.failures).toBeCloseTo(2.4, 5)
    expect(alert?.callbacks).toBeCloseTo(15, 5)
    expect(alert?.label).toBe('≈2 falha(s) de login (16% de ≈15)')
  })

  it('sampling médio >1 marca estimativa mesmo com contagens inteiras', () => {
    const alert = evaluateLoginFailureAlert({
      loginSuccess: 17,
      loginFailures: 3,
      avgSampleInterval: 1.2,
    })
    expect(alert).not.toBeNull()
    expect(alert?.estimated).toBe(true)
    expect(alert?.label).toBe('≈3 falha(s) de login (15% de ≈20)')
  })

  it('sampling =1 com contagens inteiras não marca estimativa', () => {
    const alert = evaluateLoginFailureAlert({
      loginSuccess: 17,
      loginFailures: 3,
      avgSampleInterval: 1,
    })
    expect(alert?.estimated).toBe(false)
    expect(alert?.label).toBe('3 falha(s) de login (15% de 20)')
  })
})

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConfigEnv, UserConfig } from 'vite'
import viteConfig from '../vite.config'
import { buildEnvErrors } from './env'

const valid = { VITE_API_URL: '/api', VITE_AUTH_URL: 'https://api.palpitae.com.br' }

/** Resolve o `vite.config.ts` como o `vite build` de produção faz. */
function resolveConfig(env: ConfigEnv): UserConfig {
  return typeof viteConfig === 'function' ? (viteConfig(env) as UserConfig) : viteConfig
}

const productionBuild: ConfigEnv = { command: 'build', mode: 'production' }

describe('variáveis de ambiente do build de produção', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('build falha quando VITE_AUTH_URL é um caminho relativo', () => {
    vi.stubEnv('VITE_AUTH_URL', '/api')
    expect(() => resolveConfig(productionBuild)).toThrow(
      /VITE_AUTH_URL precisa ser uma URL absoluta http\(s\).*"\/api"/,
    )
  })

  it('build falha quando VITE_API_URL está vazia', () => {
    vi.stubEnv('VITE_API_URL', '')
    expect(() => resolveConfig(productionBuild)).toThrow(/VITE_API_URL não está definida/)
  })

  it('aceita os valores de .env.production', () => {
    expect(() => resolveConfig(productionBuild)).not.toThrow()
  })

  it('não valida no servidor de desenvolvimento nem nos testes', () => {
    vi.stubEnv('VITE_AUTH_URL', '/api')
    expect(() => resolveConfig({ command: 'serve', mode: 'development' })).not.toThrow()
  })
})

describe('buildEnvErrors', () => {
  it('aceita caminho relativo ou URL absoluta na API, com ou sem barra final', () => {
    expect(buildEnvErrors(valid)).toEqual([])
    expect(buildEnvErrors({ ...valid, VITE_API_URL: '/api/' })).toEqual([])
    expect(buildEnvErrors({ ...valid, VITE_API_URL: 'https://api.palpitae.com.br/' })).toEqual([])
  })

  it('aponta cada variável ausente', () => {
    expect(buildEnvErrors({})).toEqual([
      'VITE_API_URL não está definida.',
      'VITE_AUTH_URL não está definida.',
    ])
  })

  it.each([
    ['api', 'VITE_API_URL'],
    ['//api.palpitae.com.br', 'VITE_API_URL'],
    ['ftp://api.palpitae.com.br', 'VITE_API_URL'],
    ['https://api.palpitae.com.br?x=1', 'VITE_API_URL'],
    ['/api#x', 'VITE_API_URL'],
  ])('recusa VITE_API_URL=%s', (value, name) => {
    const errors = buildEnvErrors({ ...valid, VITE_API_URL: value })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(name)
    expect(errors[0]).toContain(JSON.stringify(value))
  })

  it.each(['/api', 'api.palpitae.com.br', 'https://', 'https://api.palpitae.com.br/#x'])(
    'recusa VITE_AUTH_URL=%s',
    (value) => {
      const errors = buildEnvErrors({ ...valid, VITE_AUTH_URL: value })
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('VITE_AUTH_URL precisa ser uma URL absoluta http(s)')
    },
  )
})

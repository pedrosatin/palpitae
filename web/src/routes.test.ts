import { describe, expect, it } from 'vitest'
import redirects from '../public/_redirects?raw'
import appSource from './App.tsx?raw'


function declaredRoutes(): string[] {
  const paths = [...appSource.matchAll(/path="([^"]+)"/g)].map((m) => m[1])
  return [...new Set(paths)].filter((p) => p !== '/' && p !== '*')
}

function rules(): string[] {
  return redirects
    .split('\n')
    .map((line: string) => line.trim())
    .filter((line: string) => line !== '' && !line.startsWith('#'))
}

function isCovered(route: string, sources: string[]): boolean {
  return sources.some((source) => {
    if (source === route) return true
    if (!source.endsWith('/*')) return false
    return route.startsWith(source.slice(0, -1))
  })
}

describe('rotas da SPA e _redirects do Pages', () => {
  it('toda rota do App tem regra de rewrite', () => {
    const sources = rules().map((rule) => rule.split(/\s+/)[0])
    const missing = declaredRoutes().filter((route) => !isCovered(route, sources))

    expect(missing, `sem regra em public/_redirects: ${missing.join(', ')}`).toEqual([])
  })

  it('as regras apontam para "/" com status 200 (rewrite, não redirect)', () => {
    for (const rule of rules().filter((r) => !r.startsWith('/api/'))) {
      expect(rule, `regra de SPA malformada: ${rule}`).toMatch(/^\S+\s+\/\s+200$/)
    }
  })
})

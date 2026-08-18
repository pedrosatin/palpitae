import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guarda de roteamento do Cloudflare Pages.
 *
 * O Pages serve arquivos estáticos: sem uma regra em `public/_redirects`, uma
 * URL de rota client-side acessada direto (ou recarregada) devolve o 404.html
 * de verdade — o React Router nem chega a rodar. Como o `_redirects` lista as
 * rotas **explicitamente**, adicionar uma `<Route>` sem a regra correspondente
 * é um erro silencioso: passa em todos os testes e só aparece em produção.
 *
 * Aconteceu com `/admin/oportunidades`. Este teste amarra os dois arquivos.
 */

const root = join(import.meta.dirname, '..')
const appSource = readFileSync(join(root, 'src/App.tsx'), 'utf8')
const redirects = readFileSync(join(root, 'public/_redirects'), 'utf8')

/** Rotas declaradas no App, fora as catch-all e a raiz (servida direto). */
function declaredRoutes(): string[] {
  const paths = [...appSource.matchAll(/path="([^"]+)"/g)].map((m) => m[1])
  return [...new Set(paths)].filter((p) => p !== '/' && p !== '*')
}

/** Origens das regras de rewrite/proxy declaradas no `_redirects`. */
function redirectSources(): string[] {
  return redirects
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => line.split(/\s+/)[0])
}

/**
 * Uma regra cobre a rota se for igual, ou se for um wildcard cujo prefixo
 * bate — `/grupos/*` cobre `/grupos/:groupId`.
 */
function isCovered(route: string, sources: string[]): boolean {
  return sources.some((source) => {
    if (source === route) return true
    if (!source.endsWith('/*')) return false
    return route.startsWith(source.slice(0, -1))
  })
}

describe('rotas da SPA e _redirects do Pages', () => {
  it('toda rota do App tem regra de rewrite', () => {
    const sources = redirectSources()
    const missing = declaredRoutes().filter((route) => !isCovered(route, sources))

    expect(missing, `sem regra em public/_redirects: ${missing.join(', ')}`).toEqual([])
  })

  it('as regras apontam para "/" com status 200 (rewrite, não redirect)', () => {
    // Apontar para /index.html faz o Pages detectar loop e desligar a regra
    // silenciosamente; um 301/302 trocaria a URL na barra do usuário.
    const spaRules = redirects
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('/api/'))

    for (const rule of spaRules) {
      expect(rule, `regra de SPA malformada: ${rule}`).toMatch(/^\S+\s+\/\s+200$/)
    }
  })
})

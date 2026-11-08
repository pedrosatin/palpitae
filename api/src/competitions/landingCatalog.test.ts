/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createSqliteD1 } from '../testing/sqliteD1'

// A landing (web/src/pages/LandingPage/competitionCatalog.ts) anuncia só o que
// o modal "Criar grupo" oferece a um usuário comum. Este teste lê os slugs de
// lá e confere, nas migrations aplicadas, que cada um existe e nasce público.
const CATALOG = new URL(
  '../../../web/src/pages/LandingPage/competitionCatalog.ts',
  import.meta.url,
)

// O Brasileirão Série A foi cadastrado direto no D1 de produção (a 0012 só marca
// o tipo), então não há seed para conferir. Nasce com o default 'public'.
const SEEDED_OUTSIDE_MIGRATIONS = new Set(['campeonato-brasileiro-serie-a-2026'])

describe('catálogo da landing', () => {
  const slugs = [...readFileSync(CATALOG, 'utf8').matchAll(/slug: '([^']+)'/g)].map((m) => m[1])

  it('lê ao menos um slug do catálogo', () => {
    expect(slugs.length).toBeGreaterThan(0)
  })

  it('só anuncia competições cadastradas com visibility public', () => {
    const { sqlite } = createSqliteD1()
    for (const slug of slugs) {
      const row = sqlite
        .prepare('SELECT visibility FROM competitions WHERE slug = ?')
        .get(slug) as { visibility: string } | undefined
      if (!row) {
        expect(SEEDED_OUTSIDE_MIGRATIONS.has(slug), `${slug} não existe nas migrations`).toBe(true)
        continue
      }
      expect(row.visibility, `${slug} não é público`).toBe('public')
    }
  })
})

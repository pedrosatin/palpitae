/**
 * Origem do cadastro: regras compartilhadas entre o callback do OAuth e o painel
 * de métricas. Ver "Origem do cadastro" em docs/observability.md.
 */

export const SIGNUP_ORIGINS = ['convite', 'guia', 'busca', 'direto', 'desconhecida'] as const
export type SignupOriginCategory = (typeof SIGNUP_ORIGINS)[number]

export interface SignupOrigin {
  category: SignupOriginCategory
  /** Slug de um guia publicado. Vazio fora de `guia` e no índice dos guias. */
  guideSlug: string
}

/** Guias publicados em `web/build/guides.ts`. O teste de contrato confere a lista. */
export const GUIDE_SLUGS: ReadonlySet<string> = new Set([
  'o-que-e-bolao-de-futebol',
  'como-organizar-um-bolao',
  'regras-e-pontuacao-de-bolao',
  'bolao-do-brasileirao',
  'bolao-copa-do-mundo',
  'bolao-de-empresa',
  'bolao-online-gratis',
  'planilha-de-bolao',
  'dicas-para-acertar-palpites',
])

const UNKNOWN_ORIGIN: SignupOrigin = { category: 'desconhecida', guideSlug: '' }

const GUIDE_TOKEN_RE = /^guia_([a-z0-9-]{1,100})(?:_header)?$/

/**
 * Valor vindo do cliente: `convite`, `busca`, `direto` ou o token de guia
 * (`guia_<slug>`, `guia_<slug>_header`, `guias_header`). É entrada não confiável,
 * então qualquer outra coisa, inclusive slug que não existe, vira `desconhecida`.
 */
export function parseSignupOrigin(raw: unknown): SignupOrigin {
  if (raw === 'convite' || raw === 'busca' || raw === 'direto') {
    return { category: raw, guideSlug: '' }
  }
  if (raw === 'guias_header') return { category: 'guia', guideSlug: '' }
  const slug = typeof raw === 'string' ? GUIDE_TOKEN_RE.exec(raw)?.[1] : undefined
  return slug && GUIDE_SLUGS.has(slug) ? { category: 'guia', guideSlug: slug } : UNKNOWN_ORIGIN
}

export interface SignupOriginTotals {
  origins: Record<SignupOriginCategory, number>
  /** Cadastros por guia. `slug` vazio é o índice dos guias. */
  guides: { slug: string; signups: number }[]
  totalEvents: number
}

type AeRow = Record<string, unknown>

/**
 * Soma as linhas da SQL API (`origin`, `guide_slug`, `signups`). Categoria fora da
 * lista vira `desconhecida` e slug fora da lista fica vazio, então texto de blob
 * nunca chega ao payload.
 */
export function summarizeSignupOrigins(rows: AeRow[]): SignupOriginTotals {
  const origins: SignupOriginTotals['origins'] = {
    convite: 0,
    guia: 0,
    busca: 0,
    direto: 0,
    desconhecida: 0,
  }
  const guides = new Map<string, number>()
  let totalEvents = 0
  for (const row of rows) {
    const count = Number(row.signups ?? 0)
    if (!Number.isFinite(count)) continue
    const category = SIGNUP_ORIGINS.find((origin) => origin === row.origin) ?? 'desconhecida'
    origins[category] += count
    totalEvents += count
    if (category === 'guia') {
      const slug = GUIDE_SLUGS.has(String(row.guide_slug)) ? String(row.guide_slug) : ''
      guides.set(slug, (guides.get(slug) ?? 0) + count)
    }
  }
  return {
    origins,
    totalEvents,
    guides: [...guides]
      .map(([slug, signups]) => ({ slug, signups }))
      .sort((a, b) => b.signups - a.signups || a.slug.localeCompare(b.slug)),
  }
}

/**
 * Contas criadas no D1 na mesma janela do painel. `datetime(created_at)` normaliza
 * o ISO com `Z` gravado pelo login antes de comparar com o formato do
 * `datetime('now')`; a comparação direta de texto erraria no dia do limite.
 */
export async function countSignupsInD1(db: D1Database, days: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS signups FROM users WHERE datetime(created_at) > datetime('now', ?)`,
    )
    .bind(`-${days} days`)
    .first<{ signups: number }>()
  return Number(row?.signups ?? 0)
}

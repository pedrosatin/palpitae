/**
 * Confere o catálogo da landing (`src/pages/LandingPage/competitionCatalog.ts`)
 * contra as competições em que um usuário comum consegue criar bolão, servidas
 * pela API em `GET /public/competitions`.
 *
 * Roda no workflow `deploy-web.yml`, depois do build. Falha (código 1) quando a
 * landing anuncia uma competição que a API não oferece: em piloto, encerrada ou
 * com o slug de outra temporada. Só avisa, sem falhar, quando:
 *
 * - há competição pública fora do catálogo (anunciar ou não é escolha de produto);
 * - a API não responde ou responde fora do formato, para uma queda da API não
 *   travar o deploy do web.
 *
 * Uso: `npm run catalog:verify` (de dentro de `web/`). `CATALOG_API_URL` troca a
 * API conferida, como `http://localhost:8787` com o Worker local.
 */

import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const DEFAULT_API_URL = 'https://api.palpitae.com.br'
const TIMEOUT_MS = 10_000

/** Slugs do catálogo, lidos do código-fonte para o script rodar sem compilar TypeScript. */
export function catalogSlugs(source) {
  return [...source.matchAll(/slug: '([^']+)'/g)].map((match) => match[1])
}

/**
 * Compara os slugs da landing com a lista da API.
 * `offered` é a lista `competitions` da resposta, com `slug` e `name`.
 */
export function compareCatalog(slugs, offered) {
  const offeredSlugs = new Set(offered.map((competition) => competition.slug))
  const announced = new Set(slugs)
  return {
    notOffered: slugs.filter((slug) => !offeredSlugs.has(slug)),
    notAnnounced: offered.filter((competition) => !announced.has(competition.slug)),
  }
}

/** Lista da API, ou null quando ela não responde ou responde fora do formato. */
async function fetchOffered(apiUrl, fetchImpl) {
  try {
    const res = await fetchImpl(`${apiUrl}/public/competitions`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    const body = await res.json()
    if (!Array.isArray(body?.competitions)) return { error: 'resposta sem `competitions`' }
    return { offered: body.competitions }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Faz a conferência e devolve o código de saída com as mensagens, sem imprimir.
 * Erros reprovam o build; avisos não. `checked` é falso quando a API não respondeu.
 */
export async function verifyCatalog({ source, apiUrl = DEFAULT_API_URL, fetchImpl = fetch }) {
  const slugs = catalogSlugs(source)
  if (slugs.length === 0) {
    return {
      code: 1,
      checked: false,
      errors: ['nenhum slug lido do catálogo da landing.'],
      warnings: [],
    }
  }

  const { offered, error } = await fetchOffered(apiUrl, fetchImpl)
  if (!offered) {
    return {
      code: 0,
      checked: false,
      errors: [],
      warnings: [
        `não deu para ler ${apiUrl}/public/competitions (${error}); catálogo não conferido.`,
      ],
    }
  }

  const { notOffered, notAnnounced } = compareCatalog(slugs, offered)
  return {
    code: notOffered.length > 0 ? 1 : 0,
    checked: true,
    errors: notOffered.map(
      (slug) =>
        `a landing anuncia ${slug}, que a API não oferece (piloto, encerrada ou de outra temporada). Atualize competitionCatalog.ts.`,
    ),
    warnings: notAnnounced.map(
      (competition) => `${competition.slug} (${competition.name}) é pública e não está na landing.`,
    ),
  }
}

/**
 * Linhas a imprimir, com o canal de cada uma. No GitHub Actions, o prefixo
 * `::warning::`/`::error::` vira anotação no resumo da execução.
 */
export function reportLines({ checked, code, errors, warnings }, apiUrl, github = false) {
  const tag = (kind) => (github ? `::${kind}::` : '')
  const lines = [
    ...warnings.map((text) => ({
      stream: 'warn',
      text: `${tag('warning')}catalog:verify: ${text}`,
    })),
    ...errors.map((text) => ({ stream: 'error', text: `${tag('error')}catalog:verify: ${text}` })),
  ]
  if (checked && code === 0) {
    lines.push({
      stream: 'log',
      text: `catalog:verify: catálogo da landing conferido contra ${apiUrl}.`,
    })
  }
  return lines
}

async function main() {
  const source = await readFile(
    new URL('../src/pages/LandingPage/competitionCatalog.ts', import.meta.url),
    'utf8',
  )
  const apiUrl = process.env.CATALOG_API_URL || DEFAULT_API_URL
  const result = await verifyCatalog({ source, apiUrl })
  for (const { stream, text } of reportLines(result, apiUrl, Boolean(process.env.GITHUB_ACTIONS))) {
    console[stream](text)
  }
  process.exit(result.code)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}

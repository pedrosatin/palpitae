/**
 * Confere o catálogo da landing (`src/pages/LandingPage/competitionCatalog.ts`)
 * contra as competições em que um usuário comum consegue criar bolão, servidas
 * pela API em `GET /public/competitions`.
 *
 * Roda no workflow `landing-catalog.yml`, fora do deploy do web. A lista vem de
 * produção, então só a mudança no próprio catálogo reprova: com
 * `CATALOG_STRICT=1` (PR que altera `competitionCatalog.ts`), o script falha
 * (código 1) quando:
 *
 * - a landing anuncia uma competição que a API não oferece: em piloto, encerrada
 *   ou com o slug de outra temporada;
 * - a API recusa a consulta (HTTP 403 ou 429), porque aí o catálogo novo não foi
 *   conferido.
 *
 * Sem `CATALOG_STRICT` (outros PRs, push e a execução diária), esses casos viram
 * aviso e o script sai com 0. Sempre só avisam: competição pública fora do
 * catálogo (anunciar ou não é escolha de produto) e API fora do ar, sem a rota
 * ou com resposta fora do formato.
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

/** Respostas de bloqueio ou limite: a consulta foi recusada, não falhou por acaso. */
const REFUSED_STATUS = new Set([403, 429])

/**
 * Lista da API, ou o motivo de não tê-la. `refused` marca o HTTP 403 ou 429, que
 * reprova o PR que altera o catálogo.
 */
async function fetchOffered(apiUrl, fetchImpl) {
  try {
    const res = await fetchImpl(`${apiUrl}/public/competitions`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return { error: `HTTP ${res.status}`, refused: REFUSED_STATUS.has(res.status) }
    const body = await res.json()
    if (!Array.isArray(body?.competitions)) return { error: 'resposta sem `competitions`' }
    return { offered: body.competitions }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** Problemas que reprovam só com `strict`; sem ele, saem como aviso. */
function blockingProblems(slugs, fetched, apiUrl) {
  if (slugs.length === 0) return ['nenhum slug lido do catálogo da landing.']
  if (fetched.refused) {
    return [
      `a API recusou a consulta a ${apiUrl}/public/competitions (${fetched.error}); catálogo não conferido.`,
    ]
  }
  if (!fetched.offered) return []
  return compareCatalog(slugs, fetched.offered).notOffered.map(
    (slug) =>
      `a landing anuncia ${slug}, que a API não oferece (piloto, encerrada ou de outra temporada). Atualize competitionCatalog.ts.`,
  )
}

/** Avisos que nunca reprovam. */
function softProblems(slugs, fetched, apiUrl) {
  if (slugs.length === 0 || fetched.refused) return []
  if (!fetched.offered) {
    return [
      `não deu para ler ${apiUrl}/public/competitions (${fetched.error}); catálogo não conferido.`,
    ]
  }
  return compareCatalog(slugs, fetched.offered).notAnnounced.map(
    (competition) => `${competition.slug} (${competition.name}) é pública e não está na landing.`,
  )
}

/**
 * Faz a conferência e devolve o código de saída com as mensagens, sem imprimir.
 * Com `strict`, os problemas de `blockingProblems` são erros e reprovam; sem ele,
 * viram aviso marcado como tal. `checked` diz se a lista da API foi comparada.
 */
export async function verifyCatalog({
  source,
  apiUrl = DEFAULT_API_URL,
  fetchImpl = fetch,
  strict = false,
}) {
  const slugs = catalogSlugs(source)
  const fetched = slugs.length > 0 ? await fetchOffered(apiUrl, fetchImpl) : {}
  const blocking = blockingProblems(slugs, fetched, apiUrl)
  const soft = softProblems(slugs, fetched, apiUrl)
  const checked = Boolean(fetched.offered)
  if (strict) {
    return { code: blocking.length > 0 ? 1 : 0, checked, errors: blocking, warnings: soft }
  }
  return {
    code: 0,
    checked,
    errors: [],
    warnings: [
      ...blocking.map((text) => `${text} (só aviso: esta execução não altera o catálogo)`),
      ...soft,
    ],
  }
}

/**
 * Linhas a imprimir, com o canal de cada uma. No GitHub Actions, o prefixo
 * `::warning::`/`::error::` vira anotação no resumo da execução.
 */
export function reportLines({ checked, errors, warnings }, apiUrl, github = false) {
  const tag = (kind) => (github ? `::${kind}::` : '')
  const lines = [
    ...warnings.map((text) => ({
      stream: 'warn',
      text: `${tag('warning')}catalog:verify: ${text}`,
    })),
    ...errors.map((text) => ({ stream: 'error', text: `${tag('error')}catalog:verify: ${text}` })),
  ]
  if (checked && lines.length === 0) {
    lines.push({
      stream: 'log',
      text: `catalog:verify: catálogo da landing conferido contra ${apiUrl}, sem divergência.`,
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
  const strict = process.env.CATALOG_STRICT === '1'
  const result = await verifyCatalog({ source, apiUrl, strict })
  for (const { stream, text } of reportLines(result, apiUrl, Boolean(process.env.GITHUB_ACTIONS))) {
    console[stream](text)
  }
  process.exit(result.code)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}

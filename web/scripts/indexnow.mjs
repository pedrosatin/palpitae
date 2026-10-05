/**
 * Avisa o IndexNow de que as URLs do site mudaram.
 *
 * Roda no workflow `deploy-web.yml`, logo depois do `wrangler pages deploy` de
 * produção. Lê o `sitemap.xml` publicado e envia todas as URLs dele num único
 * POST para https://api.indexnow.org/indexnow. O sitemap tem uma dezena de
 * URLs e o protocolo aceita até 10.000 por envio, então o script manda todas.
 *
 * O buscador valida a chave baixando `keyLocation`. Por isso o script espera o
 * arquivo da chave responder com o conteúdo certo antes do envio; no primeiro
 * deploy, ou se a propagação do Pages atrasar, o POST sem isso volta 403.
 *
 * Uso manual: `node scripts/indexnow.mjs` (de dentro de `web/`). O sitemap pode
 * ser trocado com `INDEXNOW_SITEMAP_URL`, útil para testar contra um preview.
 *
 * Qualquer falha termina com código 1. O passo do workflow usa
 * `continue-on-error`, então o deploy segue.
 */

import { pathToFileURL } from 'node:url'

export const HOST = 'palpitae.com.br'
/** Chave pública do IndexNow; servida em /<chave>.txt (web/public/). */
export const KEY = 'd0701f2765043abcc5ef030d52d1ec01'
export const KEY_LOCATION = `https://${HOST}/${KEY}.txt`
const ENDPOINT = 'https://api.indexnow.org/indexnow'
const SITEMAP_URL = process.env.INDEXNOW_SITEMAP_URL || `https://${HOST}/sitemap.xml`

const KEY_ATTEMPTS = 10
const KEY_RETRY_MS = 15_000

/** URLs do sitemap (`<loc>`), só as do próprio host, sem repetição. */
export function extractLocs(xml) {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
  return [...new Set(locs)].filter((url) => new URL(url).host === HOST)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitForKeyFile() {
  for (let attempt = 1; attempt <= KEY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(KEY_LOCATION, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
      if (res.ok && (await res.text()).trim() === KEY) return
      console.log(`IndexNow: chave ainda não publicada (HTTP ${res.status}), tentativa ${attempt}.`)
    } catch (error) {
      console.log(`IndexNow: falha ao ler a chave (${error.message}), tentativa ${attempt}.`)
    }
    if (attempt < KEY_ATTEMPTS) await sleep(KEY_RETRY_MS)
  }
  throw new Error(`arquivo da chave indisponível em ${KEY_LOCATION}`)
}

async function main() {
  await waitForKeyFile()

  const sitemap = await fetch(SITEMAP_URL, { cache: 'no-store', signal: AbortSignal.timeout(15_000) })
  if (!sitemap.ok) throw new Error(`sitemap respondeu HTTP ${sitemap.status}`)
  const urlList = extractLocs(await sitemap.text())
  if (urlList.length === 0) throw new Error('sitemap sem URLs')

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList }),
    signal: AbortSignal.timeout(15_000),
  })
  // 200 = aceito; 202 = aceito, validação da chave pendente.
  if (res.status !== 200 && res.status !== 202) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  }
  console.log(`IndexNow: ${urlList.length} URL(s) enviadas (HTTP ${res.status}).`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`IndexNow: ${error.message}`)
    process.exitCode = 1
  })
}

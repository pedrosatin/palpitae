/**
 * Injeta o HTML da landing, renderizado no build, dentro de `dist/index.html`.
 *
 * Roda depois dos dois `vite build`: o do cliente, que produz o `index.html`
 * com os links de script e estilo, e o de servidor (`--ssr src/entry-server.tsx`),
 * que produz o módulo capaz de renderizar a árvore React em texto.
 *
 * O `dist-ssr/` é descartado no fim: ele não deve ser publicado no Pages.
 */

import { readFile, rm, writeFile } from 'node:fs/promises'
import { render } from '../dist-ssr/entry-server.js'

const dist = new URL('../dist/', import.meta.url)
const page = new URL('index.html', dist)
const ssrDir = new URL('../dist-ssr/', import.meta.url)
const marker = '<div id="root"></div>'

let html = await readFile(page, 'utf8')

// Se o marcador mudar, o build precisa falhar em vez de publicar a casca vazia:
// um `index.html` sem a landing derruba o LCP de volta e ninguém perceberia.
if (!html.includes(marker)) {
  throw new Error(`Marcador ${marker} não encontrado em dist/index.html.`)
}

const body = render()

// Guarda-chuva contra um render vazio (ex.: alguém remove a landing da rota "/").
if (body.length < 1000) {
  throw new Error(`HTML pré-renderizado suspeito de vazio (${body.length} caracteres).`)
}

// O `data-prerender` é o sinal que `main.tsx` usa para escolher entre
// `hydrateRoot` e `createRoot`; sem ele o React descartaria o HTML e remontaria
// tudo, jogando fora o ganho de LCP.
html = html.replace(marker, `<div id="root" data-prerender="landing">${body}</div>`)

await writeFile(page, html)
await rm(ssrDir, { recursive: true, force: true })

// A contagem de palavras é a métrica que a auditoria de conteúdo do site usa
// (limiar de 200 palavras com mais de 1 caractere). Antes deste script ela era
// atendida por um bloco estático escrito à mão no index.html; agora vem do
// conteúdo real da página, então o número aparece no log do build.
const words = body
  .replace(/<[^>]*>/g, ' ')
  .replace(/&[a-z]+;|&#\d+;/gi, ' ')
  .trim()
  .split(/\s+/)
  .filter((word) => word.length > 1)

console.log(`prerender: landing embutida em dist/index.html (${words.length} palavras)`)

if (words.length < 200) {
  throw new Error(
    `HTML pré-renderizado com apenas ${words.length} palavras (mínimo 200 para a auditoria de conteúdo).`,
  )
}

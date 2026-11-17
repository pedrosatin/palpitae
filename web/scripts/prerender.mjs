/**
 * Injeta o HTML da landing, renderizado no build, dentro de `dist/index.html`,
 * e embute o CSS de entrada no `<head>`, no lugar do `<link rel="stylesheet">`
 * que o Vite injeta.
 *
 * Roda depois dos dois `vite build`: o do cliente, que produz o `index.html`
 * com os links de script e estilo, e o de servidor (`--ssr src/entry-server.tsx`),
 * que produz o módulo capaz de renderizar a árvore React em texto.
 *
 * O CSS externo bloqueia a primeira pintura: enquanto `assets/index-*.css`
 * baixa, o navegador não pinta nada, e a captura do hero (o LCP da landing)
 * só aparece depois dele. Embutido no HTML, o CSS chega junto com o documento
 * e o primeiro frame não espera requisição extra. Todo o CSS usado pela SPA
 * está carregada estáticamente nesse arquivo único, então nada fica faltando;
 * os chunks CSS das páginas lazy continuam carregados via JS, como hoje.
 *
 * O `dist-ssr/` é descartado no fim: ele não deve ser publicado no Pages.
 */

import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const dist = new URL('../dist/', import.meta.url)
const page = new URL('index.html', dist)
const ssrDir = new URL('../dist-ssr/', import.meta.url)
const marker = '<div id="root"></div>'

/**
 * Troca o `<link rel="stylesheet">` de entrada por um `<style>` com o mesmo
 * CSS. Devolve o HTML alterado; falha quando o link não existe, porque a
 * landing sem CSS embutido voltaria a bloquear a pintura sem ninguém notar.
 */
export function embutirCssDeEntrada(html, css) {
  if (!css.trim()) {
    throw new Error('CSS de entrada vazio; recusando embutir.')
  }
  if (/<\/style/i.test(css)) {
    throw new Error('CSS de entrada contém "</style"; recusando embutir.')
  }
  const link = /<link\s+rel="stylesheet"[^>]*>/i.exec(html)
  if (!link) {
    throw new Error('<link rel="stylesheet"> não encontrado em dist/index.html.')
  }
  return html.replace(link[0], `<style>${css}</style>`)
}

/** Lê o CSS de entrada (o chunk `index-*.css`) de `dist/assets`. */
export async function lerCssDeEntrada(dist) {
  const assets = await readdir(new URL('assets/', dist))
  const entry = assets.filter((file) => /^index-.+\.css$/.test(file))
  if (entry.length !== 1) {
    throw new Error(
      `esperava um único index-*.css em dist/assets, achei: ${entry.join(', ') || 'nenhum'}`,
    )
  }
  return readFile(new URL(`assets/${entry[0]}`, dist), 'utf8')
}

export async function main() {
  // Import dinâmico: o módulo só existe depois do build SSR, e as funções
  // exportadas acima precisam poder ser importadas por testes sem o build.
  const { render } = await import('../dist-ssr/entry-server.js')

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

  const css = await lerCssDeEntrada(dist)
  html = embutirCssDeEntrada(html, css)

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

  console.log(
    `prerender: CSS de entrada embutido no <head> (${(css.length / 1024).toFixed(1)} KiB)`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}

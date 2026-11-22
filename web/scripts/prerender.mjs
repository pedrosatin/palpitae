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
 * e o primeiro frame não espera requisição extra. Esse arquivo contém o CSS
 * de entrada da SPA; as páginas lazy continuam carregando seus próprios
 * chunks CSS via JS, como hoje.
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
  const { render } = await import('../dist-ssr/entry-server.js')

  let html = await readFile(page, 'utf8')

  if (!html.includes(marker)) {
    throw new Error(`Marcador ${marker} não encontrado em dist/index.html.`)
  }

  const body = render()

  if (body.length < 1000) {
    throw new Error(`HTML pré-renderizado suspeito de vazio (${body.length} caracteres).`)
  }

  html = html.replace(marker, `<div id="root" data-prerender="landing">${body}</div>`)

  const css = await lerCssDeEntrada(dist)
  html = embutirCssDeEntrada(html, css)

  await writeFile(page, html)
  await rm(ssrDir, { recursive: true, force: true })

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

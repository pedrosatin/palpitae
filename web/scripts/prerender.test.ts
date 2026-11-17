// @vitest-environment node
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { embutirCssDeEntrada, lerCssDeEntrada } from './prerender.mjs'

const HTML = `
<!doctype html>
<html><head>
  <style>html{background:#0d0d0d}</style>
  <link rel="stylesheet" crossorigin href="/assets/index-AbCdEf.css">
</head>
<body><div id="root"></div></body></html>
`

describe('embutirCssDeEntrada', () => {
  it('troca o <link rel="stylesheet"> por um <style> com o CSS de entrada', () => {
    const saida = embutirCssDeEntrada(HTML, '.hero{color:#0f0}')
    expect(saida).not.toContain('rel="stylesheet"')
    expect(saida).toContain('<style>.hero{color:#0f0}</style>')
    // O resto do <head> fica intacto.
    expect(saida).toContain('html{background:#0d0d0d}')
    expect(saida).toContain('<div id="root"></div>')
  })

  it('recusa CSS vazio', () => {
    expect(() => embutirCssDeEntrada(HTML, '   ')).toThrow(/vazio/)
  })

  it('recusa CSS que fecharia o <style> no meio', () => {
    expect(() => embutirCssDeEntrada(HTML, 'a::after{content:"</style>"}')).toThrow(/<\/style/)
  })

  it('falha quando o <link rel="stylesheet"> não está no HTML', () => {
    expect(() => embutirCssDeEntrada('<html><head></head></html>', 'a{}')).toThrow(
      /<link rel="stylesheet">/,
    )
  })
})

describe('lerCssDeEntrada', () => {
  it('lê o único index-*.css de dist/assets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prerender-'))
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets', 'index-BxKd3z.css'), '.root{color:#fff}')
    await writeFile(join(dir, 'assets', 'DashboardPage-Cx8h9.css'), '.page{}')

    const css = await lerCssDeEntrada(pathToFileURL(dir + '/'))
    expect(css).toBe('.root{color:#fff}')
  })

  it('falha quando não há exatamente um index-*.css', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'prerender-'))
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets', 'DashboardPage-Cx8h9.css'), '.page{}')

    await expect(lerCssDeEntrada(pathToFileURL(dir + '/'))).rejects.toThrow(/único index/)
  })
})

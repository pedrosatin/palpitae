// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  extractPolicy,
  injectedScriptOrigins,
  originAllowed,
  parsePolicy,
  scanHtml,
  sha256,
  verifyPolicy,
} from './csp-verify.mjs'

const INLINE = 'console.log(1)'
const STYLE = 'html{background:#000}'

function policy(extra = '') {
  return [
    "default-src 'self'",
    `script-src 'self' ${sha256(INLINE)} https://www.googletagmanager.com ${extra}`.trim(),
    `style-src 'self' ${sha256(STYLE)}`,
    'img-src https://*.googleusercontent.com',
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join('; ')
}

const page = (body: string) => ({
  path: 'index.html',
  content: `<html><head>${body}</head></html>`,
})

describe('csp-verify', () => {
  it('reads the policy of the /* rule from _headers, in either mode', () => {
    const file = [
      '# comentário',
      '/guias/*',
      "  Content-Security-Policy: default-src 'none'",
      '/*',
      '  X-Frame-Options: DENY',
      "  Content-Security-Policy-Report-Only: default-src 'self'",
    ].join('\n')
    expect(extractPolicy(file)).toEqual({
      header: 'Content-Security-Policy-Report-Only',
      value: "default-src 'self'",
    })
    expect(extractPolicy('/*\n  X-Frame-Options: DENY\n')).toBeNull()
  })

  it('accepts a build whose inline code is hashed and external scripts are allowed', () => {
    const files = [
      page(
        `<script>${INLINE}</script><style>${STYLE}</style>` +
          '<script type="application/ld+json">{"a":1}</script>' +
          '<script type="module" src="/assets/index.js"></script>',
      ),
      {
        path: 'assets/index.js',
        content: "s.src='https://www.googletagmanager.com/gtag/js?id='+x",
      },
    ]
    expect(verifyPolicy(policy(), files)).toEqual([])
  })

  it('fails when an inline script or style has no hash in the policy', () => {
    const errors = verifyPolicy(policy(), [
      page('<script>alert(2)</script><style>body{color:red}</style>'),
    ])
    expect(errors).toEqual([
      `index.html: script inline sem hash ${sha256('alert(2)')}`,
      `index.html: <style> inline sem hash ${sha256('body{color:red}')}`,
    ])
  })

  it('fails when an external or injected script comes from an origin outside script-src', () => {
    const errors = verifyPolicy(policy(), [
      page('<script defer src="https://cdn.example.com/x.js"></script>'),
      { path: 'assets/a.js', content: 'el.src = `https://evil.example/t.js`' },
    ])
    expect(errors).toEqual([
      'index.html: script externo fora de script-src: https://cdn.example.com/x.js',
      'assets/a.js: script injetado de origem fora de script-src: https://evil.example',
    ])
  })

  it('fails on inline style attributes and event handlers', () => {
    const errors = verifyPolicy(policy(), [
      page('<article style="padding:0"></article><img src="/a.png" onerror="x()">'),
    ])
    expect(errors).toEqual([
      'index.html: atributo inline "style" bloqueado pela política',
      'index.html: atributo inline "onerror" bloqueado pela política',
    ])
  })

  it('requires the hardening directives and rejects unsafe script sources', () => {
    const errors = verifyPolicy("default-src 'self'; script-src 'self' 'unsafe-eval'", [])
    expect(errors).toEqual([
      "diretiva obrigatória ausente: object-src 'none'",
      "diretiva obrigatória ausente: base-uri 'self'",
      "diretiva obrigatória ausente: frame-ancestors 'none'",
      "script-src não pode ter 'unsafe-eval'",
    ])
    expect(verifyPolicy(policy("'unsafe-inline'"), [])).toEqual([
      "script-src não pode ter 'unsafe-inline'",
    ])
  })

  it('matches self, exact hosts and wildcard subdomains', () => {
    const sources = parsePolicy(policy()).get('img-src')!
    expect(originAllowed('https://lh3.googleusercontent.com/a', sources, 'https://x.br')).toBe(true)
    expect(originAllowed('https://googleusercontent.com/a', sources, 'https://x.br')).toBe(false)
    expect(originAllowed('/a.png', ["'self'"], 'https://x.br')).toBe(true)
    expect(originAllowed('/a.png', [], 'https://x.br')).toBe(false)
    expect(
      originAllowed(
        'http://www.googletagmanager.com/x',
        ['https://www.googletagmanager.com'],
        'https://x.br',
      ),
    ).toBe(false)
  })

  it('separates executable scripts from data blocks', () => {
    const scan = scanHtml(
      '<script type="application/ld+json">{}</script><script>a()</script><script type="module">b()</script>',
    )
    expect(scan.inlineScripts).toEqual(['a()', 'b()'])
    expect(injectedScriptOrigins("x.src='https://a.example/x.js'; y.src=`/local.js`")).toEqual([
      'https://a.example',
    ])
  })

  it('keeps the committed policy in sync with the inline scripts of index.html', () => {
    const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const committed = extractPolicy(headers)
    expect(committed?.header).toBe('Content-Security-Policy-Report-Only')
    const errors = verifyPolicy(committed!.value, [{ path: 'index.html', content: html }])
    // O Vite reescreve o <style> inline no build; esse hash só o csp:verify confere.
    expect(errors.filter((error) => !error.includes('<style>'))).toEqual([])
  })
})

/**
 * Confere a Content-Security-Policy de `dist/_headers` contra o build.
 *
 * Roda no workflow `deploy-web.yml`, depois do `npm run build` e antes do
 * `wrangler pages deploy`. Falha (código 1) quando:
 *
 * - um `<script>` inline do build não tem o hash sha256 em `script-src`;
 * - um `<style>` inline não tem o hash em `style-src`;
 * - um `<script src>` ou um script injetado por código (`.src = 'https://…'`)
 *   aponta para uma origem fora de `script-src`;
 * - o HTML tem atributo `style="…"` ou handler `on…="…"` (a política não libera
 *   `'unsafe-inline'` nem `'unsafe-hashes'`);
 * - faltam as diretivas obrigatórias (`object-src 'none'`, `base-uri 'self'`,
 *   `frame-ancestors 'none'`) ou a política libera `'unsafe-eval'`/`'unsafe-inline'`
 *   em `script-src`;
 * - o valor passa de 2000 caracteres, limite de linha do `_headers` do Pages.
 *
 * Blocos `<script type="application/ld+json">` são dados, não rodam, e ficam
 * fora da conferência. Quando um hash falta, a mensagem traz o valor certo para
 * colar em `web/public/_headers`.
 *
 * Uso: `npm run csp:verify` (de dentro de `web/`, com o build pronto).
 */

import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const CSP_HEADERS = ['Content-Security-Policy', 'Content-Security-Policy-Report-Only']
export const MAX_HEADER_LENGTH = 2000

/** Tipos de `<script>` que o navegador executa. Os demais são blocos de dados. */
const EXECUTABLE_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module'])

export function sha256(content) {
  return `'sha256-${createHash('sha256').update(content, 'utf8').digest('base64')}'`
}

/**
 * Lê a CSP da regra `/*` de um arquivo `_headers` do Cloudflare Pages.
 * Devolve o nome do header usado e o valor.
 */
export function extractPolicy(headersFile) {
  let inGlobalRule = false
  for (const raw of headersFile.split('\n')) {
    const line = raw.trimEnd()
    if (!line || line.trimStart().startsWith('#')) continue
    if (!/^\s/.test(line)) {
      inGlobalRule = line.trim() === '/*'
      continue
    }
    if (!inGlobalRule) continue
    const separator = line.indexOf(':')
    const name = line.slice(0, separator).trim()
    if (CSP_HEADERS.some((header) => header.toLowerCase() === name.toLowerCase())) {
      return { header: name, value: line.slice(separator + 1).trim() }
    }
  }
  return null
}

/** `default-src 'self'; img-src a b` → Map { 'default-src' => ["'self'"], … } */
export function parsePolicy(value) {
  const directives = new Map()
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/)
    if (name) directives.set(name.toLowerCase(), sources)
  }
  return directives
}

function sourcesFor(directives, name) {
  return directives.get(name) ?? directives.get('default-src') ?? []
}

/** A origem absoluta `url` é aceita pela lista de fontes (`'self'`, host ou `*.host`)? */
export function originAllowed(url, sources, selfOrigin) {
  let target
  try {
    target = new URL(url, selfOrigin)
  } catch {
    return false
  }
  if (target.origin === selfOrigin) return sources.includes("'self'")
  return sources.some((source) => {
    if (source.startsWith("'")) return false
    const match = /^(https?:\/\/)?(\*\.)?([^/:]+)(:\d+)?/.exec(source)
    if (!match) return false
    const [, scheme, wildcard, host] = match
    if (scheme && `${target.protocol}//` !== scheme) return false
    if (!scheme && target.protocol !== 'https:') return false
    return wildcard ? target.hostname.endsWith(`.${host}`) : target.hostname === host
  })
}

/** Scripts, estilos e atributos inline de um HTML. */
export function scanHtml(html) {
  const inlineScripts = []
  const externalScripts = []
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = match[1]
    const src = /\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)
    const type = (/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1] ?? '').toLowerCase()
    if (src) externalScripts.push(src[1])
    else if (EXECUTABLE_TYPES.has(type)) inlineScripts.push(match[2])
  }
  const inlineStyles = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1])
  // Sem os conteúdos de <script>/<style>, para não confundir código com atributo.
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const inlineAttributes = [...markup.matchAll(/<[a-z][^>]*?\s(style|on[a-z]+)\s*=/gi)].map((m) =>
    m[1].toLowerCase(),
  )
  return { inlineScripts, externalScripts, inlineStyles, inlineAttributes }
}

/** URLs absolutas atribuídas a `.src` em código (scripts injetados em runtime). */
export function injectedScriptOrigins(code) {
  return [...code.matchAll(/\.src\s*=\s*[`'"](https?:\/\/[^/`'"$]+)/g)].map((m) => m[1])
}

/**
 * Confere a política contra os arquivos do build.
 * `files` é uma lista de `{ path, content }` (HTML e JS).
 */
export function verifyPolicy(value, files, selfOrigin = 'https://palpitae.com.br') {
  const errors = []
  const directives = parsePolicy(value)
  const scriptSrc = sourcesFor(directives, 'script-src')
  const styleSrc = sourcesFor(directives, 'style-src')

  if (value.length > MAX_HEADER_LENGTH) {
    errors.push(
      `política com ${value.length} caracteres (limite do _headers: ${MAX_HEADER_LENGTH})`,
    )
  }
  const required = [
    ['object-src', "'none'"],
    ['base-uri', "'self'"],
    ['frame-ancestors', "'none'"],
  ]
  for (const [name, source] of required) {
    const sources = directives.get(name)
    if (!sources || sources.length !== 1 || sources[0] !== source) {
      errors.push(`diretiva obrigatória ausente: ${name} ${source}`)
    }
  }
  for (const forbidden of ["'unsafe-eval'", "'unsafe-inline'"]) {
    if (scriptSrc.includes(forbidden)) errors.push(`script-src não pode ter ${forbidden}`)
  }

  for (const { path, content } of files) {
    if (path.endsWith('.html')) {
      const scan = scanHtml(content)
      for (const script of scan.inlineScripts) {
        const hash = sha256(script)
        if (!scriptSrc.includes(hash)) errors.push(`${path}: script inline sem hash ${hash}`)
      }
      for (const style of scan.inlineStyles) {
        const hash = sha256(style)
        if (!styleSrc.includes(hash)) errors.push(`${path}: <style> inline sem hash ${hash}`)
      }
      for (const src of scan.externalScripts) {
        if (!originAllowed(src, scriptSrc, selfOrigin)) {
          errors.push(`${path}: script externo fora de script-src: ${src}`)
        }
      }
      for (const attribute of scan.inlineAttributes) {
        errors.push(`${path}: atributo inline "${attribute}" bloqueado pela política`)
      }
    }
    if (path.endsWith('.html') || path.endsWith('.js')) {
      for (const origin of injectedScriptOrigins(content)) {
        if (!originAllowed(origin, scriptSrc, selfOrigin)) {
          errors.push(`${path}: script injetado de origem fora de script-src: ${origin}`)
        }
      }
    }
  }
  return errors
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && /\.(html|js)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}

async function main() {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url))
  const headersFile = await readFile(join(dist, '_headers'), 'utf8').catch(() => null)
  if (headersFile === null) {
    console.error('csp:verify: dist/_headers não encontrado. Rode `npm run build` antes.')
    process.exit(1)
  }
  const policy = extractPolicy(headersFile)
  if (!policy) {
    console.error('csp:verify: nenhuma Content-Security-Policy na regra /* de dist/_headers.')
    process.exit(1)
  }
  const files = await Promise.all(
    (await listFiles(dist)).map(async (file) => ({
      path: relative(dist, file),
      content: await readFile(file, 'utf8'),
    })),
  )
  const errors = verifyPolicy(policy.value, files)
  if (errors.length > 0) {
    console.error(`csp:verify: ${errors.length} problema(s) em ${policy.header}:`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
  }
  const html = files.filter((file) => file.path.endsWith('.html')).length
  console.log(
    `csp:verify: ${policy.header} cobre ${html} páginas HTML e ${files.length - html} scripts.`,
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}

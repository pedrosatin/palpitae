/**
 * Ratchet de comentários: conta comentários baníveis por arquivo e compara
 * com um baseline versionado. Falha se algum arquivo passa do baseline ou se
 * um arquivo novo traz comentários. `--update` regrava o baseline (só para baixo
 * quando o baseline já existe; na primeira corrida cria o arquivo).
 *
 * Exceções (não contam):
 * - shebang
 * - cabeçalho de licença (bloco no topo com Copyright/SPDX/License)
 * - diretivas de ferramenta (`// @ts-*`, `eslint-disable`, `oxlint-disable`,
 *   `prettier-ignore`, `/// <reference …>`)
 * - JSDoc de contrato de API pública (bloco `/**` imediatamente antes de um
 *   `export`, ou com tags `@param`/`@returns`/`@throws`/`@deprecated`/`@see`)
 *
 * Uso, a partir da raiz:
 *   node scripts/comments-check.mjs
 *   node scripts/comments-check.mjs --update
 *   node scripts/comments-check.mjs --dump /tmp/comments.json
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_PATH = join(ROOT, 'comments-baseline.json')

const CODE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.css',
  '.sql',
  '.jsonc',
  '.toml',
])

const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  'graphify-out',
  'coverage',
  '.git',
  'playwright-report',
  'test-results',
  '.wrangler',
  'dev-dist',
])

const TOOL_DIRECTIVE =
  /^\s*(?:\/\/|\/\*|#|--)\s*(?:@ts-|eslint-disable|oxlint-disable|prettier-ignore|biome-ignore|istanbul\s+ignore|c8\s+ignore|v8\s+ignore|@vitest-environment)/i

const TRIPLE_SLASH_REF = /^\s*\/\/\/\s*<reference\b/

const LICENSE_MARK =
  /\b(?:copyright|spdx-license|licensed under|apache license|mit license|mozilla public license)\b/i

const PUBLIC_JSDOC_TAG = /@(?:param|returns?|throws|deprecated|see|template|example|typedef|property|satisfies)\b/

/**
 * @typedef {{ file: string, line: number, endLine: number, kind: 'line'|'block'|'hash'|'sql', text: string, exception: string|null }} Comment
 */

function extname(name) {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i).toLowerCase()
}

/**
 * Lista arquivos versionados sob `api/` e `web/` com as extensões de código.
 * Prefere `git ls-files` para respeitar o que entra no PR.
 * @returns {string[]}
 */
export function listScopedFiles() {
  const tracked = execFileSync('git', ['ls-files', '-z', 'api', 'web'], {
    cwd: ROOT,
    encoding: 'buffer',
  })
    .toString('utf8')
    .split('\0')
    .filter(Boolean)

  const files = tracked.filter((rel) => {
    const ext = extname(rel)
    if (!CODE_EXT.has(ext)) return false
    for (const skip of SKIP_DIR) {
      if (rel === skip || rel.startsWith(skip + '/') || rel.includes('/' + skip + '/')) return false
    }
    return true
  })

  for (const extra of ['wrangler.jsonc', 'wrangler.toml', 'vite.config.ts', 'vite.config.mjs']) {
    const full = join(ROOT, extra)
    if (existsSync(full) && !files.includes(extra)) files.push(extra)
  }

  return files.sort()
}

/**
 * Extrai comentários de um arquivo TS/JS/CSS-like com lexer que respeita
 * strings, template literals e regex literais o bastante para não contar
 * `//` dentro de strings.
 * @param {string} source
 * @param {string} rel
 * @returns {Comment[]}
 */
export function extractJsFamilyComments(source, rel) {
  /** @type {Comment[]} */
  const comments = []
  let i = 0
  const n = source.length
  let line = 1

  const advance = () => {
    if (source[i] === '\n') line++
    i++
  }

  const peek = (k = 0) => source[i + k]

  const startsRegex = (before) => {
    // Heurística: após tokens que admitem regex literal
    const t = before.replace(/\s+$/u, '')
    if (t.length === 0) return true
    const c = t[t.length - 1]
    return /[({[=,;:!?:&|~^%*/<>+-]/.test(c) || /\b(?:return|case|throw|new|typeof|void|delete|await|yield|in|of)$/.test(t)
  }

  while (i < n) {
    const c = peek()
    const c2 = peek(1)

    // shebang only at file start
    if (i === 0 && c === '#' && c2 === '!') {
      while (i < n && peek() !== '\n') advance()
      continue
    }

    // line comment
    if (c === '/' && c2 === '/') {
      const startLine = line
      const start = i
      i += 2
      while (i < n && peek() !== '\n') i++
      const text = source.slice(start, i)
      comments.push({
        file: rel,
        line: startLine,
        endLine: startLine,
        kind: 'line',
        text,
        exception: null,
      })
      continue
    }

    // block comment
    if (c === '/' && c2 === '*') {
      const startLine = line
      const start = i
      i += 2
      while (i < n && !(peek() === '*' && peek(1) === '/')) {
        advance()
      }
      if (i < n) {
        i += 2 // */
      }
      const endLine = line
      const text = source.slice(start, i)
      comments.push({
        file: rel,
        line: startLine,
        endLine,
        kind: 'block',
        text,
        exception: null,
      })
      continue
    }

    // string '
    if (c === "'" || c === '"') {
      const q = c
      advance()
      while (i < n) {
        if (peek() === '\\') {
          advance()
          if (i < n) advance()
          continue
        }
        if (peek() === q) {
          advance()
          break
        }
        if (peek() === '\n') break // unterminated
        advance()
      }
      continue
    }

    // template literal
    if (c === '`') {
      advance()
      while (i < n) {
        if (peek() === '\\') {
          advance()
          if (i < n) advance()
          continue
        }
        if (peek() === '`') {
          advance()
          break
        }
        if (peek() === '$' && peek(1) === '{') {
          // skip until matching }; naive depth for nested templates is enough for comment hunt
          i += 2
          let depth = 1
          while (i < n && depth > 0) {
            if (peek() === '/' && peek(1) === '/') {
              while (i < n && peek() !== '\n') advance()
              continue
            }
            if (peek() === '/' && peek(1) === '*') {
              i += 2
              while (i < n && !(peek() === '*' && peek(1) === '/')) advance()
              if (i < n) i += 2
              continue
            }
            if (peek() === "'" || peek() === '"') {
              const q = peek()
              advance()
              while (i < n) {
                if (peek() === '\\') {
                  advance()
                  if (i < n) advance()
                  continue
                }
                if (peek() === q) {
                  advance()
                  break
                }
                advance()
              }
              continue
            }
            if (peek() === '`') {
              // nested template — recurse by consuming until close then continue
              advance()
              // fall through simple: treat nested as opaque until we see unbalanced braces poorly;
              // for comment counting, nested templates with comments are rare; skip to next `
              while (i < n && peek() !== '`') {
                if (peek() === '\\') {
                  advance()
                  if (i < n) advance()
                  continue
                }
                advance()
              }
              if (i < n) advance()
              continue
            }
            if (peek() === '{') depth++
            else if (peek() === '}') depth--
            advance()
          }
          continue
        }
        advance()
      }
      continue
    }

    // regex literal
    if (c === '/') {
      const before = source.slice(Math.max(0, i - 80), i)
      if (startsRegex(before)) {
        advance()
        while (i < n) {
          if (peek() === '\\') {
            advance()
            if (i < n) advance()
            continue
          }
          if (peek() === '[') {
            advance()
            while (i < n && peek() !== ']') {
              if (peek() === '\\') {
                advance()
                if (i < n) advance()
                continue
              }
              advance()
            }
            if (i < n) advance()
            continue
          }
          if (peek() === '/') {
            advance()
            while (i < n && /[a-z]/i.test(peek())) advance()
            break
          }
          if (peek() === '\n') break
          advance()
        }
        continue
      }
    }

    advance()
  }

  return comments
}

/**
 * @param {string} source
 * @param {string} rel
 * @returns {Comment[]}
 */
export function extractSqlComments(source, rel) {
  /** @type {Comment[]} */
  const comments = []
  const lines = source.split('\n')
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    // strip string literals roughly then find --
    let inStr = null
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inStr) {
        if (c === inStr) inStr = null
        continue
      }
      if (c === "'" || c === '"') {
        inStr = c
        continue
      }
      if (c === '-' && line[i + 1] === '-') {
        comments.push({
          file: rel,
          line: li + 1,
          endLine: li + 1,
          kind: 'sql',
          text: line.slice(i),
          exception: null,
        })
        break
      }
    }
  }
  // block /* */ in SQL
  let i = 0
  let line = 1
  while (i < source.length) {
    if (source[i] === '\n') {
      line++
      i++
      continue
    }
    if (source[i] === '/' && source[i + 1] === '*') {
      const startLine = line
      const start = i
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++
        i++
      }
      if (i < source.length) i += 2
      comments.push({
        file: rel,
        line: startLine,
        endLine: line,
        kind: 'block',
        text: source.slice(start, i),
        exception: null,
      })
      continue
    }
    i++
  }
  return comments
}

/**
 * @param {string} source
 * @param {string} rel
 * @returns {Comment[]}
 */
export function extractTomlHashComments(source, rel) {
  /** @type {Comment[]} */
  const comments = []
  const lines = source.split('\n')
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    let inStr = null
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inStr) {
        if (c === '\\' && inStr !== "'''" && inStr !== '"""') {
          i++
          continue
        }
        if (c === inStr) inStr = null
        continue
      }
      if (c === "'" || c === '"') {
        inStr = c
        continue
      }
      if (c === '#') {
        comments.push({
          file: rel,
          line: li + 1,
          endLine: li + 1,
          kind: 'hash',
          text: line.slice(i),
          exception: null,
        })
        break
      }
    }
  }
  return comments
}

/**
 * @param {string} source
 * @param {Comment} comment
 * @returns {string|null}
 */
export function classifyException(source, comment) {
  const trimmed = comment.text.trim()

  if (comment.line === 1 && trimmed.startsWith('#!')) return 'shebang'

  if (TRIPLE_SLASH_REF.test(comment.text)) return 'triple-slash-reference'

  if (TOOL_DIRECTIVE.test(comment.text)) return 'tool-directive'

  // license header: first block comment near top
  if (comment.kind === 'block' && comment.line <= 3 && LICENSE_MARK.test(comment.text)) {
    return 'license-header'
  }

  // public API JSDoc
  if (comment.kind === 'block' && comment.text.trimStart().startsWith('/**')) {
    if (PUBLIC_JSDOC_TAG.test(comment.text)) return 'public-jsdoc'
    // immediately followed (only whitespace) by export
    const after = source.slice(
      (() => {
        // find end index of this comment in source by scanning — use line-based approx
        const lines = source.split('\n')
        let idx = 0
        for (let L = 1; L < comment.line; L++) idx += lines[L - 1].length + 1
        const slice = source.slice(idx)
        const end = slice.indexOf('*/')
        return end >= 0 ? idx + end + 2 : idx
      })(),
    )
    if (/^\s*export\b/.test(after)) return 'public-jsdoc'
  }

  return null
}

/**
 * @param {string} rel
 * @returns {Comment[]}
 */
export function extractFileComments(rel) {
  const full = join(ROOT, rel)
  const source = readFileSync(full, 'utf8')
  const ext = extname(rel)
  /** @type {Comment[]} */
  let raw
  if (ext === '.sql') raw = extractSqlComments(source, rel)
  else if (ext === '.toml') raw = extractTomlHashComments(source, rel)
  else raw = extractJsFamilyComments(source, rel)

  // dedupe overlapping sql line + block scans for same span is rare; keep all unique by line+text
  const seen = new Set()
  const out = []
  for (const c of raw) {
    const key = `${c.line}:${c.endLine}:${c.text}`
    if (seen.has(key)) continue
    seen.add(key)
    c.exception = classifyException(source, c)
    out.push(c)
  }
  return out
}

/**
 * Contagem banível: cada linha coberta por um comentário sem exceção.
 * @param {Comment[]} comments
 * @returns {number}
 */
export function banableLineCount(comments) {
  let n = 0
  for (const c of comments) {
    if (c.exception) continue
    n += c.endLine - c.line + 1
  }
  return n
}

/**
 * @returns {{ byFile: Record<string, number>, comments: Comment[], exceptions: Record<string, number> }}
 */
export function scanAll() {
  const files = listScopedFiles()
  /** @type {Record<string, number>} */
  const byFile = {}
  /** @type {Comment[]} */
  const comments = []
  /** @type {Record<string, number>} */
  const exceptions = {}

  for (const rel of files) {
    const fileComments = extractFileComments(rel)
    comments.push(...fileComments)
    const banable = banableLineCount(fileComments)
    if (banable > 0) byFile[rel] = banable
    for (const c of fileComments) {
      if (c.exception) exceptions[c.exception] = (exceptions[c.exception] ?? 0) + 1
    }
  }
  return { byFile, comments, exceptions }
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return null
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
}

/**
 * @param {Record<string, number>} byFile
 */
function writeBaseline(byFile) {
  const sorted = Object.fromEntries(Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b)))
  const payload = {
    generatedAt: new Date().toISOString(),
    totalBanableLines: Object.values(sorted).reduce((a, b) => a + b, 0),
    files: sorted,
  }
  writeFileSync(BASELINE_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf8')
  return payload
}

function main(argv) {
  const update = argv.includes('--update')
  const dumpIdx = argv.indexOf('--dump')
  const dumpPath = dumpIdx >= 0 ? argv[dumpIdx + 1] : null

  const { byFile, comments, exceptions } = scanAll()

  if (dumpPath) {
    mkdirSync(dirname(dumpPath), { recursive: true })
    writeFileSync(
      dumpPath,
      JSON.stringify(
        {
          exceptions,
          totalBanableLines: Object.values(byFile).reduce((a, b) => a + b, 0),
          byFile,
          comments: comments.map((c) => ({
            file: c.file,
            line: c.line,
            endLine: c.endLine,
            kind: c.kind,
            exception: c.exception,
            text: c.text.length > 500 ? c.text.slice(0, 500) + '…' : c.text,
          })),
        },
        null,
        2,
      ) + '\n',
    )
    console.log(`dump → ${dumpPath} (${comments.length} comments, ${Object.keys(byFile).length} files with banable)`)
    if (!update && !argv.includes('--check')) return 0
  }

  if (update) {
    const prev = loadBaseline()
    if (prev?.files) {
      /** @type {string[]} */
      const raised = []
      for (const [file, count] of Object.entries(byFile)) {
        const old = prev.files[file] ?? 0
        if (count > old) raised.push(`${file}: ${old} → ${count}`)
      }
      // --update always writes current (ratchet down). Warn if something went up
      // relative to previous baseline so the operator notices a regression slipped in.
      if (raised.length) {
        console.warn('aviso: --update grava contagens maiores que o baseline anterior:')
        for (const r of raised) console.warn('  ' + r)
      }
      // Enforce ratchet-down: never increase a file's allowance on --update
      const ratcheted = { ...byFile }
      for (const [file, old] of Object.entries(prev.files)) {
        if (ratcheted[file] == null) continue
        if (ratcheted[file] > old) ratcheted[file] = old
      }
      // drop zeros
      for (const [file, count] of Object.entries(ratcheted)) {
        if (count <= 0) delete ratcheted[file]
      }
      const payload = writeBaseline(ratcheted)
      console.log(
        `baseline atualizado: ${payload.totalBanableLines} linhas baníveis em ${Object.keys(payload.files).length} arquivos → ${relative(ROOT, BASELINE_PATH)}`,
      )
    } else {
      const payload = writeBaseline(byFile)
      console.log(
        `baseline criado: ${payload.totalBanableLines} linhas baníveis em ${Object.keys(payload.files).length} arquivos → ${relative(ROOT, BASELINE_PATH)}`,
      )
    }
    console.log('exceções mantidas:', exceptions)
    return 0
  }

  const baseline = loadBaseline()
  if (!baseline?.files) {
    console.error(
      `comments-check: baseline ausente em ${relative(ROOT, BASELINE_PATH)}. Rode com --update para criar.`,
    )
    return 1
  }

  /** @type {string[]} */
  const failures = []
  for (const [file, count] of Object.entries(byFile)) {
    const allowed = baseline.files[file]
    if (allowed == null) {
      failures.push(`arquivo novo com comentários: ${file} (${count} linhas)`)
      continue
    }
    if (count > allowed) {
      failures.push(`${file}: ${count} > baseline ${allowed}`)
    }
  }

  if (failures.length) {
    console.error('comments-check: falhou (ratchet)')
    for (const f of failures) console.error('  ' + f)
    console.error('Para baixar o baseline depois de apagar comentários: node scripts/comments-check.mjs --update')
    return 1
  }

  const total = Object.values(byFile).reduce((a, b) => a + b, 0)
  const baseTotal = baseline.totalBanableLines ?? Object.values(baseline.files).reduce((a, b) => a + b, 0)
  console.log(
    `comments-check: ok (${total} linhas baníveis ≤ baseline ${baseTotal}; ${Object.keys(byFile).length} arquivos)`,
  )
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}

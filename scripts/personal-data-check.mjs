/**
 * Barra dados pessoais e códigos de convite em arquivos de dados e em `docs/`.
 *
 * O repositório é público e já vazou nome, e-mail, UUID e palpites de
 * participantes, mais um código de convite. Este script roda no CI de PR e de
 * push à `main` (`.github/workflows/dados-pessoais.yml`) e falha (código 1)
 * quando um arquivo varrido traz:
 *
 * - e-mail fora da allowlist de domínios fictícios;
 * - código de convite no formato de `generateInviteCode` (`XXXX-XXXX`);
 * - UUID que não seja sintético nem esteja numa exceção documentada.
 *
 * Arquivos varridos: tudo em `docs/`, `*.sql`, `*.json` de dados (menos
 * `package*.json`, `tsconfig*.json` e as configs do oxlint e do oxfmt) e tudo
 * em `__fixtures__/` ou `fixtures/`.
 *
 * A mensagem aponta arquivo, linha e tipo do achado. O valor encontrado nunca
 * é impresso, porque o log do CI de um repositório público também é público.
 *
 * Uso, a partir da raiz:
 *   node scripts/personal-data-check.mjs --base <ref>   varre os arquivos alterados desde <ref>
 *   node scripts/personal-data-check.mjs --all          varre todos os arquivos versionados
 *   node scripts/personal-data-check.mjs                igual a `--base origin/main`
 *
 * `--base` compara com o ancestral comum de `<ref>` e do `HEAD`, incluindo mudanças ainda
 * não commitadas. Quando `<ref>` não existe ou não se liga ao `HEAD`, o script varre
 * tudo. Isso cobre push de branch nova, `before` zerado e force-push.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Domínios que podem aparecer em exemplos. Vale também para subdomínios. */
export const ALLOWED_EMAIL_DOMAINS = ['example.com', 'example.test', 'palpitae.com.br']

/** JSON que é configuração de ferramenta, não dado. */
const CONFIG_JSON = /^(package(-lock)?|tsconfig(\..+)?|\.oxlintrc|\.oxfmtrc)\.json$/

/**
 * UUIDs públicos de catálogo, sem ligação com pessoa: a competição do bolão
 * migrado (`docs/bolao-migration`) e o jogo do roteiro de reparo em
 * `docs/operations/reparo-adiado-espn-2026-11.md`.
 */
const PUBLIC_UUIDS = new Set([
  '06baa1de-01c3-4e71-ac6e-a850fa690ec1',
  '8361f3a5-263b-489f-92f2-b597bb7a2775',
])

/**
 * Seed de times e jogos do bolão migrado, com UUIDs sorteados que não
 * identificam ninguém. A regra de UUID não vale nele. As de e-mail e de convite
 * valem. As migrações de `api/migrations/` usam UUIDs sintéticos e seguem a regra.
 */
const UUID_EXEMPT_PATHS = [/^docs\/bolao-migration\/sql\/01b-seed-teams-matches\.sql$/]

/** Trecho que antecede um UUID de recurso público de terceiro (logo da ESPN). */
const UUID_EXEMPT_PREFIX = /espncdn\.com\/guid\/$/

// Mesmo alfabeto de `generateInviteCode` em api/src/groups/router.ts: letras
// maiúsculas sem I e O, dígitos sem 0 e 1, em dois blocos de 4 com hífen.
const INVITE_CODE = /(?<![A-Za-z0-9-])([A-HJ-NP-Z2-9]{4})-([A-HJ-NP-Z2-9]{4})(?![A-Za-z0-9-])/g
// Código dentro de um link `/convite/<código>` ou de `invite_code=<código>`: a API e a
// página de convite normalizam para maiúsculas, então a caixa baixa também vale.
const INVITE_CODE_IN_CONTEXT =
  /(?:\/convite\/|invite_code["']?\s*[:=]\s*["']?)([A-HJ-NP-Z2-9]{4})-([A-HJ-NP-Z2-9]{4})(?![A-Za-z0-9-])/gi
// O `@` também aparece como `%40` em URL e como `\u0040` em JSON escapado.
const EMAIL = /[A-Za-z0-9._%+-]+(?:@|%40|\\u0040)([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/**
 * UUID sintético: grupos 2 e 3 zerados na versão 4 (`-0000-4000-8000-`) e os
 * 4 primeiros dígitos do último grupo zerados. É o formato das fixtures e dos
 * ids de competição das migrações. Um UUID v4 sorteado cai aqui com
 * probabilidade desprezível.
 */
const SYNTHETIC_UUID = /^[0-9a-f]{8}-0000-4000-8000-0000[0-9a-f]{8}$/i

const FINDING_LABELS = {
  email: 'e-mail fora da allowlist de domínios fictícios',
  invite: 'código de convite no formato XXXX-XXXX',
  uuid: 'UUID que não é sintético',
}

/** Arquivo que a checagem varre, pelo caminho relativo à raiz com `/`. */
export function isScannedPath(path) {
  if (path.startsWith('docs/')) return true
  if (/(^|\/)(__fixtures__|fixtures)\//.test(path)) return true
  if (path.endsWith('.sql')) return true
  return path.endsWith('.json') && !CONFIG_JSON.test(basename(path))
}

function isAllowedEmailDomain(domain) {
  const lower = domain.toLowerCase()
  return ALLOWED_EMAIL_DOMAINS.some((allowed) => lower === allowed || lower.endsWith(`.${allowed}`))
}

/**
 * Bloco repetido de um só caractere (`XXXX-XXXX`) é a notação do formato, não
 * um código. Um código sorteado fica assim com probabilidade desprezível.
 */
function isInviteNotation(match) {
  return [match[1], match[2]].every((block) => new Set(block).size === 1)
}

function isAllowedUuid(path, line, match) {
  const value = match[0].toLowerCase()
  if (SYNTHETIC_UUID.test(value) || PUBLIC_UUIDS.has(value)) return true
  if (UUID_EXEMPT_PATHS.some((pattern) => pattern.test(path))) return true
  return UUID_EXEMPT_PREFIX.test(line.slice(0, match.index))
}

/**
 * Procura os três tipos de achado em um arquivo. Devolve `{ path, line, kind }`,
 * sem o valor encontrado.
 */
export function scanText(path, text) {
  const findings = []
  text.split('\n').forEach((line, index) => {
    const found = (kind) => findings.push({ path, line: index + 1, kind })
    for (const match of line.matchAll(EMAIL)) {
      if (!isAllowedEmailDomain(match[1])) found('email')
    }
    const inContext = new Set()
    for (const match of line.matchAll(INVITE_CODE_IN_CONTEXT)) {
      inContext.add(match.index + match[0].length - 9)
      if (!isInviteNotation(match)) found('invite')
    }
    for (const match of line.matchAll(INVITE_CODE)) {
      if (!inContext.has(match.index) && !isInviteNotation(match)) found('invite')
    }
    for (const match of line.matchAll(UUID)) {
      if (!isAllowedUuid(path, line, match)) found('uuid')
    }
  })
  return findings
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** Saída de `git <comando> -z <args>` em lista, sem escapar nomes com acento. */
function gitLines(command, args) {
  return git([command, '-z', ...args])
    .split('\0')
    .filter(Boolean)
}

/** Ancestral comum entre `ref` e `HEAD`, ou `null` quando `ref` não existe ou não se liga ao `HEAD`. */
function mergeBase(ref) {
  try {
    return git(['merge-base', ref, 'HEAD']).trim() || null
  } catch {
    return null
  }
}

/**
 * Arquivos a varrer. Com `base`, os adicionados, copiados, modificados ou
 * renomeados desde ela. Sem `base`, ou com `base` inexistente, todos os
 * versionados.
 */
export function listFiles({ base } = {}) {
  const ancestor = base ? mergeBase(base) : null
  if (ancestor) return gitLines('diff', ['--name-only', '--diff-filter=ACMR', ancestor, '--'])
  return gitLines('ls-files', [])
}

/** Varre os arquivos e devolve os achados. Arquivo ilegível ou binário é ignorado. */
export function scanFiles(paths) {
  const findings = []
  let scanned = 0
  for (const path of paths.filter(isScannedPath)) {
    let text
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue
    }
    if (text.includes('\0')) continue
    scanned += 1
    findings.push(...scanText(path, text))
  }
  return { scanned, findings }
}

export function parseArgs(argv) {
  const args = { all: false, base: 'origin/main' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--all') args.all = true
    else if (argv[i] === '--base') {
      const value = argv[i + 1]
      if (!value || value.startsWith('-')) throw new Error('--base pede uma referência do git')
      args.base = value
      i += 1
    } else throw new Error(`Argumento desconhecido: ${argv[i]}`)
  }
  return args
}

export function run(argv, log = console.log) {
  const args = parseArgs(argv)
  const base = args.all ? undefined : args.base
  if (base && !mergeBase(base)) log(`Base ${base} indisponível. Todos os arquivos serão varridos.`)
  const { scanned, findings } = scanFiles(listFiles({ base }))
  for (const finding of findings) {
    log(`${finding.path}:${finding.line}: ${FINDING_LABELS[finding.kind]}`)
  }
  if (findings.length > 0) {
    log(
      `\n${findings.length} achado(s) em ${scanned} arquivo(s) varrido(s). ` +
        'Troque por exemplo fictício (@example.test, <INVITE_CODE>, UUID sintético).',
    )
    return 1
  }
  log(`Nenhum dado pessoal em ${scanned} arquivo(s) varrido(s).`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = run(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 2
  }
}

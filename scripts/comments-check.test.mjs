import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  banableLineCount,
  classifyException,
  extractJsFamilyComments,
  extractSqlComments,
  extractTomlHashComments,
} from './comments-check.mjs'

describe('comments-check extractor', () => {
  it('ignora // dentro de strings e conta line comments', () => {
    const src = `const u = "http://x";\n// real\nconst a = 1; // trail\n`
    const comments = extractJsFamilyComments(src, 'x.ts')
    assert.equal(comments.length, 2)
    assert.match(comments[0].text, /\/\/ real/)
    assert.match(comments[1].text, /\/\/ trail/)
  })

  it('marca diretiva de ferramenta e reference como exceção', () => {
    const src = `// @ts-expect-error intentional\n/// <reference types="node" />\n// plain\n`
    const comments = extractJsFamilyComments(src, 'x.ts')
    for (const c of comments) c.exception = classifyException(src, c)
    assert.equal(comments[0].exception, 'tool-directive')
    assert.equal(comments[1].exception, 'triple-slash-reference')
    assert.equal(comments[2].exception, null)
    assert.equal(banableLineCount(comments), 1)
  })

  it('marca JSDoc público antes de export', () => {
    const src = `/** Contrato do helper. */\nexport function f() {}\n/** só interno */\nfunction g() {}\n`
    const comments = extractJsFamilyComments(src, 'x.ts')
    for (const c of comments) c.exception = classifyException(src, c)
    assert.equal(comments[0].exception, 'public-jsdoc')
    assert.equal(comments[1].exception, null)
  })

  it('extrai -- em SQL fora de string', () => {
    const src = `SELECT '-- not';\n-- real\n`
    const comments = extractSqlComments(src, 'x.sql')
    assert.equal(comments.length, 1)
    assert.match(comments[0].text, /-- real/)
  })

  it('extrai # em toml', () => {
    const src = `name = "a#b"\n# cfg\n`
    const comments = extractTomlHashComments(src, 'x.toml')
    assert.equal(comments.length, 1)
    assert.match(comments[0].text, /# cfg/)
  })
})

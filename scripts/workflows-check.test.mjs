import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const WORKFLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')

const workflows = readdirSync(WORKFLOWS_DIR)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(WORKFLOWS_DIR, name), 'utf8') }))

// Só as linhas `uses:` de steps; ações e workflows locais (`./...`) ficam de fora.
const usesExternos = (text) =>
  text
    .split('\n')
    .map((linha, i) => ({ linha, numero: i + 1 }))
    .map(({ linha, numero }) => ({ match: linha.match(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/), numero }))
    .filter(({ match }) => match && !match[1].startsWith('./'))
    .map(({ match, numero }) => ({ ref: match[1], resto: match[2], numero }))

describe('workflows do GitHub Actions', () => {
  it('encontra os workflows', () => {
    assert.ok(workflows.length > 0)
  })

  for (const { name, text } of workflows) {
    it(`${name}: toda action externa aponta para SHA de 40 hex com a versão em comentário`, () => {
      for (const { ref, resto, numero } of usesExternos(text)) {
        assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${name}:${numero} usa ${ref}`)
        assert.match(resto, /^\s+#\s*v?\d/, `${name}:${numero} sem a versão em comentário`)
      }
    })
  }

  it('deploy-api.yml não cancela um deploy em andamento', () => {
    const text = workflows.find((w) => w.name === 'deploy-api.yml')?.text ?? ''
    assert.match(text, /^concurrency:[\s\S]*?^\s+cancel-in-progress: false\s*$/m)
    assert.doesNotMatch(text, /cancel-in-progress:\s*true/)
  })
})

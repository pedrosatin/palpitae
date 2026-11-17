import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const WORKFLOWS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')

const workflows = readdirSync(WORKFLOWS_DIR)
  .filter((name) => /\.ya?ml$/.test(name))
  .map((name) => ({ name, text: readFileSync(join(WORKFLOWS_DIR, name), 'utf8') }))

// Toda chave `uses`, com ou sem aspas e também em mapeamento inline (`{ uses: ... }`).
// Ação ou workflow local (`./...`) e imagem `docker://` ficam de fora.
const USES = /["']?\buses["']?\s*:\s*["']?([^\s"'}#]+)["']?([^\n]*)/g
const usesExternos = (text) =>
  text
    .split('\n')
    .flatMap((linha, i) =>
      [...linha.matchAll(USES)]
        .filter(([, ref]) => !ref.startsWith('./') && !ref.startsWith('docker://'))
        .map(([, ref, resto]) => ({ ref, resto, numero: i + 1 })),
    )

describe('workflows do GitHub Actions', () => {
  it('encontra os workflows', () => {
    assert.ok(workflows.length > 0)
  })

  it('reconhece chave entre aspas e mapeamento inline, sem passar em falso', () => {
    const amostra = [
      '- "uses": actions/checkout@v7',
      "- 'uses': actions/checkout@v7",
      '- { uses: actions/checkout@v7 }',
      '- uses: "actions/checkout@v7" # v7',
      '- uses: ./local',
      '- uses: docker://alpine:3',
    ].join('\n')
    assert.deepEqual(
      usesExternos(amostra).map(({ ref }) => ref),
      ['actions/checkout@v7', 'actions/checkout@v7', 'actions/checkout@v7', 'actions/checkout@v7'],
    )
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

  it('deploy-web.yml publica o dist do job de teste, só no push da main', () => {
    const text = workflows.find((w) => w.name === 'deploy-web.yml')?.text ?? ''
    const inicioDeploy = text.indexOf('\n  deploy:')
    assert.ok(inicioDeploy > 0, 'job deploy não encontrado')
    const teste = text.slice(0, inicioDeploy)
    const deploy = text.slice(inicioDeploy)

    // O sitemap usa git log: o build que vai para produção precisa do histórico inteiro.
    assert.match(teste, /fetch-depth: 0/)
    // O upload vem depois do csp:verify e só no push.
    // Procura o step que roda o comando, não o comentário do topo do arquivo.
    const csp = teste.search(/^\s+run: npm run csp:verify\s*$/m)
    assert.ok(csp > 0, 'step do csp:verify não encontrado no job de teste')
    assert.ok(csp < teste.indexOf('actions/upload-artifact@'))
    assert.match(teste, /if: github\.event_name == 'push'\n\s+uses: actions\/upload-artifact@/)
    assert.match(teste, /include-hidden-files: true/)

    const nome = teste.match(/upload-artifact@[\s\S]*?name: (\S+)/)?.[1]
    assert.equal(deploy.match(/download-artifact@[\s\S]*?name: (\S+)/)?.[1], nome)
    assert.match(deploy, /^ {4}if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'$/m)
    assert.doesNotMatch(deploy, /npm ci\s*$|npm run build|run-id:|github-token:/m)
  })
})

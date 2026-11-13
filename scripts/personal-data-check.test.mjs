import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { isScannedPath, scanText } from './personal-data-check.mjs'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'personal-data-check.mjs')

// Valores inventados para os testes. Nenhum é e-mail, UUID ou código reais.
const REAL_EMAIL = 'fulano@dominio-externo.test'
const FAKE_EMAIL = 'fulano@example.test'
const INVITE = 'ABCD-EFGH'
const RANDOM_UUID = '3f2b8c1e-5d4a-4b7e-9c10-a1b2c3d4e5f6'
const SYNTHETIC_UUID = '00000001-0000-4000-8000-000000000001'

const kinds = (path, text) => scanText(path, text).map((finding) => finding.kind)

describe('scanText', () => {
  it('reprova e-mail com o @ escrito como %40 ou \\u0040', () => {
    assert.deepEqual(kinds('docs/nota.md', 'mailto:fulano%40dominio-externo.test'), ['email'])
    assert.deepEqual(kinds('docs/nota.md', '"fulano\\u0040dominio-externo.test"'), ['email'])
    assert.deepEqual(kinds('docs/nota.md', 'fulano%40example.test'), [])
  })

  it('reprova e-mail fora da allowlist', () => {
    assert.deepEqual(kinds('docs/nota.md', `contato: ${REAL_EMAIL}`), ['email'])
  })

  it('aceita @example.test, example.com, palpitae.com.br e subdomínios, em qualquer caixa', () => {
    const text = [
      FAKE_EMAIL,
      'a@example.com',
      'b@Example.COM',
      'lembretes@palpitae.com.br',
      'c@mail.example.test',
    ].join('\n')
    assert.deepEqual(kinds('docs/nota.md', text), [])
  })

  it('não confunde domínio parecido com a allowlist', () => {
    assert.deepEqual(kinds('docs/nota.md', 'x@notexample.com'), ['email'])
    assert.deepEqual(kinds('docs/nota.md', 'x@example.com.evil.net'), ['email'])
  })

  it('reprova código de convite no formato XXXX-XXXX', () => {
    assert.deepEqual(kinds('docs/nota.md', `convite ${INVITE}`), ['invite'])
    assert.deepEqual(kinds('docs/nota.md', `?invite_code=${INVITE}&x=1`), ['invite'])
  })

  it('reprova código de convite em link ou em invite_code, em qualquer caixa', () => {
    const lower = INVITE.toLowerCase()
    const mixed = `${INVITE.slice(0, 2)}${lower.slice(2, 6)}${INVITE.slice(6)}`
    assert.deepEqual(kinds('docs/nota.md', `https://palpitae.com.br/convite/${lower}`), ['invite'])
    assert.deepEqual(kinds('docs/nota.md', `?invite_code=${mixed}&x=1`), ['invite'])
    assert.deepEqual(kinds('docs/nota.md', `"invite_code": "${lower}"`), ['invite'])
    assert.deepEqual(kinds('docs/nota.md', `/convite/<INVITE_CODE> e invite_code=XXXX-XXXX`), [])
  })

  it('aceita o placeholder <INVITE_CODE> e a notação XXXX-XXXX', () => {
    assert.deepEqual(kinds('docs/nota.md', 'convite <INVITE_CODE>'), [])
    assert.deepEqual(kinds('docs/nota.md', 'no formato XXXX-XXXX'), [])
  })

  it('ignora texto parecido que não cabe no alfabeto do código', () => {
    // I, O, 0 e 1 não existem no alfabeto de generateInviteCode.
    assert.deepEqual(kinds('docs/nota.md', 'COIN-ZERO e ABCD-EFGHJ e abcd-efgh'), [])
  })

  it('reprova UUID sorteado e aceita UUID sintético', () => {
    assert.deepEqual(kinds('docs/nota.md', `usuário ${RANDOM_UUID}`), ['uuid'])
    assert.deepEqual(kinds('docs/nota.md', `usuário ${SYNTHETIC_UUID}`), [])
  })

  it('aceita UUID de catálogo só no seed de times e jogos, e reprova em migração e em docs soltos', () => {
    assert.deepEqual(kinds('api/migrations/0099_x.sql', `('${RANDOM_UUID}')`), ['uuid'])
    assert.deepEqual(kinds('api/migrations/0099_x.sql', `('${SYNTHETIC_UUID}')`), [])
    assert.deepEqual(
      kinds('docs/bolao-migration/sql/01b-seed-teams-matches.sql', `('${RANDOM_UUID}')`),
      [],
    )
    assert.deepEqual(kinds('docs/bolao-migration/sql/03-import.sql', `('${RANDOM_UUID}')`), [
      'uuid',
    ])
  })

  it('aceita o UUID de logo da ESPN em fixture e reprova UUID solto', () => {
    const logo = `"href": "https://a.espncdn.com/guid/${RANDOM_UUID}/logos/x.png"`
    assert.deepEqual(kinds('api/src/x/__fixtures__/a.json', logo), [])
    assert.deepEqual(kinds('api/src/x/__fixtures__/a.json', `"id": "${RANDOM_UUID}"`), ['uuid'])
  })

  it('aponta a linha e nunca devolve o valor encontrado', () => {
    const findings = scanText('docs/nota.md', `ok\n${REAL_EMAIL} ${INVITE} ${RANDOM_UUID}`)
    assert.deepEqual(
      findings.map(({ line, kind }) => [line, kind]),
      [
        [2, 'email'],
        [2, 'invite'],
        [2, 'uuid'],
      ],
    )
    for (const finding of findings) {
      assert.deepEqual(Object.keys(finding).sort(), ['kind', 'line', 'path'])
    }
  })
})

describe('isScannedPath', () => {
  it('varre docs, SQL, JSON de dados e fixtures', () => {
    for (const path of [
      'docs/security.md',
      'docs/bolao-migration/sql/02-create-group.sql',
      'api/migrations/0001_initial_schema.sql',
      'api/src/providers/__fixtures__/espn.json',
      'web/tests/fixtures/dados.ts',
      'docs/bolao-migration/bolao-predictions-export.example.json',
    ]) {
      assert.equal(isScannedPath(path), true, path)
    }
  })

  it('ignora código e JSON de configuração', () => {
    for (const path of [
      'api/src/index.ts',
      'README.md',
      'package.json',
      'web/package-lock.json',
      'api/tsconfig.scripts.json',
      '.oxlintrc.json',
    ]) {
      assert.equal(isScannedPath(path), false, path)
    }
  })
})

/**
 * Ambiente sem as variáveis `GIT_*` do processo pai (rodando dentro de um hook, elas
 * apontariam para o repositório real) e sem a configuração global do git.
 */
function isolatedEnv() {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')),
  )
  return { ...env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
}

describe('CLI em um repositório de teste', () => {
  let repo
  let base

  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Teste',
        '-c',
        'user.email=teste@example.test',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: repo, encoding: 'utf8', env: isolatedEnv() },
    ).trim()

  const commitFile = (path, content) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), content)
    git('add', path)
    git('commit', '-q', '-m', `muda ${path}`)
  }

  const check = (...args) =>
    spawnSync('node', [SCRIPT, ...args], { cwd: repo, encoding: 'utf8', env: isolatedEnv() })

  before(() => {
    repo = mkdtempSync(join(tmpdir(), 'palpitae-dados-'))
    git('init', '-q', '-b', 'main')
    commitFile('docs/antigo.md', `vazamento antigo: ${REAL_EMAIL}\n`)
    base = git('rev-parse', 'HEAD')
  })

  after(() => rmSync(repo, { recursive: true, force: true }))

  it('reprova e-mail real em docs/ e aponta arquivo e linha sem imprimir o valor', () => {
    commitFile('docs/novo.md', `# Nota\ncontato: ${REAL_EMAIL}\n`)
    const result = check('--base', base)
    assert.equal(result.status, 1)
    assert.match(result.stdout, /docs\/novo\.md:2: e-mail fora da allowlist/)
    assert.doesNotMatch(result.stdout + result.stderr, /dominio-externo/)
  })

  it('só varre os arquivos alterados desde a base', () => {
    const result = check('--base', base)
    assert.doesNotMatch(result.stdout, /docs\/antigo\.md/)
  })

  it('aceita @example.test e o placeholder <INVITE_CODE>', () => {
    const ok = git('rev-parse', 'HEAD')
    commitFile('docs/exemplo.md', `contato: ${FAKE_EMAIL}\nconvite: <INVITE_CODE>\n`)
    const result = check('--base', ok)
    assert.equal(result.status, 0, result.stdout)
  })

  it('reprova código de convite em SQL sem imprimir o código', () => {
    const ok = git('rev-parse', 'HEAD')
    commitFile('docs/convite.sql', `-- convite ${INVITE}\n`)
    const result = check('--base', ok)
    assert.equal(result.status, 1)
    assert.match(result.stdout, /docs\/convite\.sql:1: código de convite/)
    assert.doesNotMatch(result.stdout, new RegExp(INVITE))
  })

  it('varre tudo com --all e quando a base não existe', () => {
    for (const args of [['--all'], ['--base', '0'.repeat(40)]]) {
      const result = check(...args)
      assert.equal(result.status, 1)
      assert.match(result.stdout, /docs\/antigo\.md:1/)
    }
  })

  it('recusa argumento desconhecido e --base sem valor', () => {
    assert.equal(check('--foo').status, 2)
    assert.equal(check('--base').status, 2)
    assert.equal(check('--base', '--all').status, 2)
  })
})

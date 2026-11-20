import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows')

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

// Linhas de comentário saem antes das buscas: o texto delas cita comandos que
// os steps já não rodam. O comentário de versão depois do `uses:` fica.
const semComentarios = (text) =>
  text
    .split('\n')
    .filter((linha) => !/^\s*#/.test(linha))
    .join('\n')

// Blocos dos jobs, pelo nome: cada chave com dois espaços depois de `jobs:`.
const jobsDe = (text) => {
  const jobs = new Map()
  const corpo = semComentarios(text).split(/^jobs:\s*$/m)[1] ?? ''
  let atual = null
  for (const linha of corpo.split('\n')) {
    const chave = linha.match(/^ {2}([\w-]+):\s*$/)?.[1]
    if (chave) jobs.set((atual = chave), '')
    else if (atual) jobs.set(atual, `${jobs.get(atual)}${linha}\n`)
  }
  return jobs
}

// `needs` em lista inline (`[a, b]`), em lista de itens ou com um nome só.
const needsDe = (bloco) => {
  const inline = bloco.match(/^ {4}needs:\s*\[([^\]]*)\]/m)?.[1]
  if (inline !== undefined) return inline.split(',').map((n) => n.trim()).filter(Boolean)
  const lista = bloco.match(/^ {4}needs:\s*\n((?: {6}- .+\n)+)/m)?.[1]
  if (lista) return lista.split('\n').filter(Boolean).map((l) => l.replace(/^\s*-\s*/, '').trim())
  const unico = bloco.match(/^ {4}needs:\s*([\w-]+)\s*$/m)?.[1]
  return unico ? [unico] : []
}

// Paths de um gatilho (`pull_request` ou `push`) do bloco `on:`.
const pathsDe = (text, evento) => {
  const on = text.match(/^on:\s*\n((?:[ #].*\n|\n)+)/m)?.[1] ?? ''
  const gatilho = on.match(new RegExp(`^ {2}${evento}:\\s*\\n((?: {4,}.+\\n)+)`, 'm'))?.[1] ?? ''
  // Lista em linha: paths: ['web/**', '.github/workflows/deploy-web.yml']
  const inline = gatilho.match(/^ {4}paths:\s*\[(.*)\]\s*$/m)?.[1]
  if (inline !== undefined) {
    return inline.split(',').map((p) => p.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  }
  const paths = gatilho.match(/^ {4}paths:\s*\n((?: {6}- .+\n)+)/m)?.[1] ?? ''
  return paths
    .split('\n')
    .filter(Boolean)
    .map((l) => l.replace(/^\s*-\s*/, '').trim().replace(/^['"]|['"]$/g, ''))
}

// Eventos do bloco `on:` (chaves com dois espaços), sem os comentários.
const eventosDe = (text) => {
  const on = semComentarios(text).match(/^on:\s*\n((?:[ ].*\n|\n)+)/m)?.[1] ?? ''
  return [...on.matchAll(/^ {2}([\w-]+):/gm)].map(([, evento]) => evento)
}

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

  it('deploy-api.yml testa, migra e publica num job só, com os secrets só nos dois últimos steps', () => {
    const text = workflows.find((w) => w.name === 'deploy-api.yml')?.text ?? ''
    const jobs = jobsDe(text)
    assert.equal(jobs.size, 1, `esperava um job só, achei: ${[...jobs.keys()].join(', ')}`)
    const bloco = [...jobs.values()][0]

    // Os secrets não entram no escopo do job: o npm ci e os testes rodam sem eles.
    assert.doesNotMatch(bloco.split(/^ {4}steps:/m)[0], /secrets\.|^ {4}env:/m, 'secret ou env no nível do job')
    assert.doesNotMatch(semComentarios(text).split(/^jobs:/m)[0], /secrets\./, 'secret fora do job')

    const passos = bloco.split(/^ {4}steps:\n/m)[1].split(/\n(?= {6}- )/)
    const indice = (comando) => passos.findIndex((p) => p.includes(comando))
    const instala = indice('run: npm ci')
    const tipos = indice('run: npm run typecheck')
    const testes = indice('run: npm test')
    const migra = indice('wrangler d1 migrations apply')
    const publica = indice('run: npm run deploy')
    assert.ok(
      instala >= 0 && instala < tipos && tipos < testes && testes < migra && migra < publica,
      `ordem esperada: npm ci, typecheck, testes, migrations, publicação (índices ${[instala, tipos, testes, migra, publica]})`,
    )
    assert.equal(passos.filter((p) => p.includes('run: npm ci')).length, 1, 'mais de uma instalação')

    // O gate depende só da ordem: nenhum step pode seguir depois de uma falha.
    const semSkip = semComentarios(bloco)
    assert.doesNotMatch(semSkip, /continue-on-error:/, 'continue-on-error deixa testes vermelhos chegarem ao deploy')
    assert.doesNotMatch(semSkip, /\bif:.*\b(always|failure|cancelled)\(/, 'if com always(), failure() ou cancelled() roda depois de uma falha')

    // Todo secret fica no env do step de migration ou de publicação, e os dois têm o par.
    passos.forEach((passo, i) => {
      const secrets = passo.match(/secrets\.\w+/g) ?? []
      if (i === migra || i === publica) {
        assert.deepEqual([...new Set(secrets)].sort(), ['secrets.CLOUDFLARE_ACCOUNT_ID', 'secrets.CLOUDFLARE_API_TOKEN'], `step ${i} sem os secrets da Cloudflare`)
        assert.match(passo, /^ {8}env:\n(?: {10}\w+: .+\n?)+/m, `step ${i} sem env próprio`)
      } else {
        assert.deepEqual(secrets, [], `step ${i} expõe secret fora da migration e da publicação`)
      }
    })
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

  it('ci.yml não verifica a web e o check depende de todos os jobs do CI', () => {
    const text = workflows.find((w) => w.name === 'ci.yml')?.text ?? ''
    const jobs = jobsDe(text)
    assert.ok(jobs.has('check'), 'job check não encontrado')
    assert.ok(!jobs.has('web'), 'ci.yml voltou a ter o job web')

    // A web é verificada no Deploy Web: nenhum step do CI instala, checa ou
    // testa a web, nem pelos scripts da raiz que a incluem.
    for (const [nome, bloco] of jobs) {
      assert.doesNotMatch(
        bloco,
        /working-directory:\s*web\b|--prefix[ =]web\b|web\/package-lock\.json|test-changed\.sh|npm run (check|type-check|test:web)\b/,
        `job ${nome} do ci.yml roda verificação da web`,
      )
      // Na raiz, `npm test` e `npm run typecheck` também passam pela web.
      if (!/working-directory:/.test(bloco)) {
        assert.doesNotMatch(bloco, /npm (test|run (test|typecheck))\s*$/m, `job ${nome} roda a verificação da raiz`)
      }
    }

    const needs = needsDe(jobs.get('check'))
    assert.ok(!needs.includes('web'), 'o check ainda depende de um job web')
    const outros = [...jobs.keys()].filter((nome) => nome !== 'check')
    assert.deepEqual([...needs].sort(), outros.sort(), 'o check deve esperar todos os outros jobs')
  })

  it('deploy-web.yml roda a seleção de testes só em pull_request e a suíte inteira no resto', () => {
    const text = workflows.find((w) => w.name === 'deploy-web.yml')?.text ?? ''
    const teste = jobsDe(text).get('test') ?? ''

    // No PR: web, vetores de ouro e o próprio workflow. No push: só web e workflow
    // (mudança só em test-vectors/ não dispara deploy).
    const pathsPr = pathsDe(text, 'pull_request')
    for (const path of ['web/**', 'test-vectors/**', '.github/workflows/deploy-web.yml']) {
      assert.ok(pathsPr.includes(path), `pull_request sem o path ${path}`)
    }
    const pathsPush = pathsDe(text, 'push')
    for (const path of ['web/**', '.github/workflows/deploy-web.yml']) {
      assert.ok(pathsPush.includes(path), `push sem o path ${path}`)
    }
    assert.ok(!pathsPush.includes('test-vectors/**'), 'push não deve filtrar test-vectors/**')


    // Type check antes dos testes, e a seleção só dentro do ramo de pull_request.
    assert.match(teste, /^\s+run: npm run type-check\s*$/m)
    // O step é achado pelo comando, não pelo nome nem pela ordem das chaves.
    const passos = teste.split(/\n(?= {6}- )/)
    const passo = passos.find((p) => p.includes('scripts/test-changed.sh')) ?? ''
    assert.match(passo, /EVENT_NAME: \$\{\{ github\.event_name \}\}/)
    const ramoPr = passo.search(/if \[ "\$EVENT_NAME" = pull_request \]/)
    const selecao = passo.indexOf('bash scripts/test-changed.sh HEAD^1')
    const senao = passo.search(/^\s+else\s*$/m)
    const completa = passo.search(/^\s+npm test\s*$/m)
    assert.ok(ramoPr >= 0 && ramoPr < selecao && selecao < senao && senao < completa, 'a seleção precisa ficar só no ramo de pull_request, com npm test no else')

    // O disparo manual verifica a web sem cancelar um deploy: grupo de concurrency próprio.
    assert.match(text, /^ {2}workflow_dispatch:/m)
    assert.match(text.match(/^concurrency:\s*\n {2}group: (.+)$/m)?.[1] ?? '', /workflow_dispatch/)
    assert.equal(semComentarios(text).match(/test-changed\.sh/g)?.length, 1, 'test-changed.sh fora do step de testes')
  })

  it('vite.config.ts roda a suíte web inteira quando a seleção ou o workflow mudam', () => {
    const config = readFileSync(join(ROOT, 'web', 'vite.config.ts'), 'utf8')
    const lista = config.match(/forceRerunTriggers: \[([\s\S]*?)\]/)?.[1] ?? ''
    const triggers = [...lista.matchAll(/'([^']+)'/g)].map(([, path]) => path)
    assert.ok(triggers.includes('scripts/test-changed.sh'), 'falta scripts/test-changed.sh')
    assert.ok(triggers.includes('../.github/workflows/deploy-web.yml'), 'falta deploy-web.yml')
    // Vetores ficam de fora: test-changed.sh já inclui testes com readFileSync/import.meta.url.
    assert.ok(!triggers.includes('../test-vectors/mata-mata.json'), 'test-vectors não deve estar em forceRerunTriggers')
    // Um gatilho fora de web/ precisa existir: arquivo renomeado deixa de valer em silêncio.
    for (const path of triggers.filter((p) => p.startsWith('../'))) {
      assert.ok(existsSync(join(ROOT, 'web', path)), `gatilho ${path} não existe`)
    }
  })

  it('landing-catalog.yml não roda no push; fica no PR da web e no cron', () => {
    const text = workflows.find((w) => w.name === 'landing-catalog.yml')?.text ?? ''
    const eventos = eventosDe(text)
    assert.ok(!eventos.includes('push'), 'landing-catalog.yml voltou a disparar no push')
    for (const evento of ['pull_request', 'schedule']) {
      assert.ok(eventos.includes(evento), `landing-catalog.yml sem o gatilho ${evento}`)
    }
    assert.ok(pathsDe(text, 'pull_request').includes('web/**'), 'o PR não filtra mais por web/**')
  })

  it('e2e-web.yml roda no PR da web, fora do push, com o filtro de paths', () => {
    const text = workflows.find((w) => w.name === 'e2e-web.yml')?.text ?? ''
    const eventos = eventosDe(text)
    assert.ok(eventos.includes('pull_request'), 'e2e-web.yml sem o gatilho pull_request')
    assert.ok(!eventos.includes('push'), 'e2e-web.yml não deve rodar no push')
    const paths = pathsDe(text, 'pull_request')
    for (const path of ['web/**', 'package-lock.json', '.github/workflows/e2e-web.yml']) {
      assert.ok(paths.includes(path), `pull_request sem o path ${path}`)
    }
  })

  it('e2e-web.yml instala só o chromium-headless-shell e deixa o gtag real fora do PR', () => {
    const text = workflows.find((w) => w.name === 'e2e-web.yml')?.text ?? ''
    const jobs = jobsDe(text)
    assert.ok(jobs.size > 0, 'nenhum job encontrado em e2e-web.yml')
    const instalacoes = semComentarios(text).match(/^.*playwright install\b.*$/gm) ?? []
    assert.ok(instalacoes.length > 0, 'e2e-web.yml não instala o navegador')
    for (const linha of instalacoes) {
      assert.match(
        linha,
        /--only-shell chromium\s*$/,
        `instalação sem --only-shell: ${linha.trim()}`,
      )
    }

    // O job que roda no PR não recebe o id do GA, então o teste do gtag real se
    // pula sozinho; o job desse teste nunca roda no PR.
    for (const [nome, bloco] of jobs) {
      const condicao = bloco.match(/^ {4}if: (.+)$/m)?.[1] ?? ''
      const rodaNoPr = !/github\.event_name != 'pull_request'/.test(condicao)
      if (rodaNoPr) {
        assert.doesNotMatch(bloco, /REAL_GTAG_ID/, `job ${nome} roda no PR com REAL_GTAG_ID`)
      } else {
        const mensagem = `job ${nome} sem pular na falta de REAL_GTAG_ID`
        assert.match(condicao, /vars\.REAL_GTAG_ID != ''/, mensagem)
      }
    }
  })

  it('o check do ci.yml não depende do E2E da web', () => {
    const ci = workflows.find((w) => w.name === 'ci.yml')?.text ?? ''
    const e2e = workflows.find((w) => w.name === 'e2e-web.yml')?.text ?? ''
    const jobsCi = jobsDe(ci)
    const needs = needsDe(jobsCi.get('check') ?? '')
    for (const nome of jobsDe(e2e).keys()) {
      assert.ok(!needs.includes(nome), `o check do ci.yml depende do job ${nome}`)
    }
    // O E2E não volta para dentro do CI por outro nome de job.
    assert.doesNotMatch(semComentarios(ci), /playwright|test:e2e/, 'ci.yml roda o E2E da web')
  })

  it('radar-sync.yml tem teto de tempo em todo job', () => {
    const text = workflows.find((w) => w.name === 'radar-sync.yml')?.text ?? ''
    const jobs = jobsDe(text)
    assert.ok(jobs.size > 0, 'nenhum job encontrado em radar-sync.yml')
    for (const [nome, bloco] of jobs) {
      const minutos = Number(bloco.match(/^ {4}timeout-minutes:\s*(\d+)\s*$/m)?.[1])
      assert.ok(minutos > 0 && minutos <= 30, `job ${nome} sem timeout-minutes razoável`)
    }
  })
})

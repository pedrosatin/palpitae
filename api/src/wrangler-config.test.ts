/// <reference types="vite/client" />
/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import deployWorkflow from '../../.github/workflows/deploy-api.yml?raw'
import deployWebWorkflow from '../../.github/workflows/deploy-web.yml?raw'
import packageJsonFile from '../package.json'
import wranglerToml from '../wrangler.toml?raw'
import { FIXTURE_DISCOVERY_CRON, RESULT_POLLER_CRON, SCHEDULED_CRONS } from './crons'

const REPO_ROOT = new URL('../../', import.meta.url)

/**
 * Instruções que o operador copia e roda dentro de api/. Sem `--config`, o
 * wrangler procura wrangler.json e wrangler.jsonc em todos os diretórios acima
 * antes de aceitar um wrangler.toml, e o wrangler.jsonc da raiz (projeto do
 * Pages) vence o api/wrangler.toml.
 */
const OPERATOR_DOCS = [
  'README.md',
  'docs/security.md',
  'api/wrangler.toml',
  ...readdirSync(new URL('docs/operations/', REPO_ROOT))
    .filter((file) => file.endsWith('.md'))
    .map((file) => `docs/operations/${file}`),
]

/** Subcomandos que leem a configuração do Worker. `pages` e `login` não leem. */
const WORKER_COMMAND = /\bwrangler\s+(secret|d1|r2|kv|deploy|dev|tail|versions|rollback|types)\b/
const API_CONFIG = /--config[ =]\S*wrangler\.toml/

/**
 * Linhas com comando wrangler do Worker sem a config da API. Junta antes as
 * linhas terminadas em `\`, para aceitar o `--config` na linha seguinte.
 */
function commandsWithoutApiConfig(text: string): { line: number; command: string }[] {
  const commands: { line: number; command: string }[] = []
  let pending: { line: number; command: string } | null = null
  text.split('\n').forEach((raw, index) => {
    const continues = raw.trimEnd().endsWith('\\')
    const part = continues ? raw.trimEnd().slice(0, -1).trimEnd() : raw
    pending = pending
      ? { line: pending.line, command: `${pending.command} ${part.trim()}` }
      : { line: index + 1, command: part }
    if (!continues) {
      commands.push(pending)
      pending = null
    }
  })
  if (pending) commands.push(pending)
  return commands
    .filter(({ command }) => WORKER_COMMAND.test(command) && !API_CONFIG.test(command))
    .map(({ line, command }) => ({ line, command: command.trim() }))
}

type PackageJson = {
  scripts?: Record<string, string>
  devDependencies?: Record<string, string>
}

function isAtLeastVersion(version: string, minimum: [number, number, number]) {
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) {
    throw new Error(`Invalid version: ${version}`)
  }

  const parsed = match.slice(1).map(Number) as [number, number, number]

  for (let index = 0; index < minimum.length; index += 1) {
    if (parsed[index] > minimum[index]) {
      return true
    }

    if (parsed[index] < minimum[index]) {
      return false
    }
  }

  return true
}

describe('wrangler api config', () => {
  it('pins the api wrangler config for dev and deploy', () => {
    const packageJson = packageJsonFile as PackageJson

    expect(packageJson.scripts?.dev).toContain('--config ./wrangler.toml')
    expect(packageJson.scripts?.dev).toContain('--port 8787')
    expect(packageJson.scripts?.deploy).toContain('--config ./wrangler.toml')
  })

  it('uses a wrangler version that is known to serve the api routes locally', () => {
    const packageJson = packageJsonFile as PackageJson
    const wranglerVersion = packageJson.devDependencies?.wrangler

    expect(wranglerVersion).toBeDefined()
    expect(isAtLeastVersion(wranglerVersion!, [4, 100, 0])).toBe(true)
  })

  it('pins the api wrangler config for remote migrations in ci', () => {
    expect(deployWorkflow).toContain(
      'npx wrangler d1 migrations apply palpitae --remote --config ./wrangler.toml',
    )
  })

  it.each([
    ['npx wrangler secret put JWT_SECRET --config ./wrangler.toml'],
    ['npx wrangler secret put JWT_SECRET --config=./wrangler.toml'],
    ['npx wrangler d1 execute palpitae --config api/wrangler.toml --command "SELECT 1"'],
    [
      'npx wrangler d1 execute palpitae --local \\\n  --config ./wrangler.toml \\\n  --command "SELECT 1"',
    ],
    ['npx wrangler pages secret put PROXY_SHARED_SECRET --project-name palpitae-web'],
    ['npx wrangler login'],
  ])('aceita %j', (text) => {
    expect(commandsWithoutApiConfig(text)).toEqual([])
  })

  it('aponta o comando do Worker sem a config da API, na linha em que ele começa', () => {
    expect(
      commandsWithoutApiConfig(
        [
          'cd api',
          'npx wrangler d1 execute palpitae --local \\',
          '  --command "SELECT 1"',
          'npx wrangler secret put JWT_SECRET --config ./wrangler.jsonc',
        ].join('\n'),
      ),
    ).toEqual([
      { line: 2, command: 'npx wrangler d1 execute palpitae --local --command "SELECT 1"' },
      { line: 4, command: 'npx wrangler secret put JWT_SECRET --config ./wrangler.jsonc' },
    ])
  })

  it('documenta todo comando wrangler do Worker com --config ./wrangler.toml', () => {
    const missing = OPERATOR_DOCS.flatMap((path) =>
      commandsWithoutApiConfig(readFileSync(new URL(path, REPO_ROOT), 'utf8')).map(
        ({ line, command }) => `${path}:${line}: ${command}`,
      ),
    )

    expect(missing).toEqual([])
  })

  it('declara no wrangler.toml os mesmos crons que o handler scheduled conhece', () => {
    const declared = wranglerToml.match(/^crons = (\[.*\])$/m)?.[1]

    expect(declared).toBeDefined()
    expect((JSON.parse(declared!) as string[]).sort()).toEqual([...SCHEDULED_CRONS].sort())
  })

  it('declara o FRONTEND_WORKER_ZONE com o projeto que o deploy do front publica', () => {
    const project = deployWebWorkflow.match(/wrangler pages deploy\b.*--project-name=(\S+)/)?.[1]

    expect(project).toBeDefined()
    expect(wranglerToml).toMatch(
      new RegExp(`^FRONTEND_WORKER_ZONE = "${project}\\.pages\\.dev"$`, 'm'),
    )
  })

  it('desliga o workers.dev e as previews, para a API ter um único host público', () => {
    // As duas chaves valem só no nível raiz. Um [env.*] precisaria repetir as duas.
    expect(wranglerToml).not.toMatch(/^\[env\./m)
    expect(wranglerToml).toMatch(/^workers_dev = false$/m)
    expect(wranglerToml).toMatch(/^preview_urls = false$/m)
  })

  it('roda a descoberta diária num minuto diferente dos ticks do poller', () => {
    const minutes = (cron: string) => cron.split(' ')[0].split(',')

    expect(minutes(RESULT_POLLER_CRON)).toEqual(['0', '30'])
    expect(minutes(RESULT_POLLER_CRON)).not.toContain(minutes(FIXTURE_DISCOVERY_CRON)[0])
  })
})

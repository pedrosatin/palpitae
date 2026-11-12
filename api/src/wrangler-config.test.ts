/// <reference types="vite/client" />
/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import deployWorkflow from '../../.github/workflows/deploy-api.yml?raw'
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

  it('documenta todo comando wrangler do Worker com --config ./wrangler.toml', () => {
    const missing = OPERATOR_DOCS.flatMap((path) =>
      readFileSync(new URL(path, REPO_ROOT), 'utf8')
        .split('\n')
        .map((line, index) => ({ line, where: `${path}:${index + 1}` }))
        .filter(
          ({ line }) => WORKER_COMMAND.test(line) && !line.includes('--config ./wrangler.toml'),
        )
        .map(({ where, line }) => `${where}: ${line.trim()}`),
    )

    expect(missing).toEqual([])
  })

  it('declara no wrangler.toml os mesmos crons que o handler scheduled conhece', () => {
    const declared = wranglerToml.match(/^crons = (\[.*\])$/m)?.[1]

    expect(declared).toBeDefined()
    expect((JSON.parse(declared!) as string[]).sort()).toEqual([...SCHEDULED_CRONS].sort())
  })

  it('roda a descoberta diária num minuto diferente dos ticks do poller', () => {
    const minutes = (cron: string) => cron.split(' ')[0].split(',')

    expect(minutes(RESULT_POLLER_CRON)).toEqual(['0', '30'])
    expect(minutes(RESULT_POLLER_CRON)).not.toContain(minutes(FIXTURE_DISCOVERY_CRON)[0])
  })
})

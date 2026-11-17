/// <reference types="vite/client" />
/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import deployWorkflow from '../../.github/workflows/deploy-api.yml?raw'
import deployWebWorkflow from '../../.github/workflows/deploy-web.yml?raw'
import packageJsonFile from '../package.json'
import wranglerToml from '../wrangler.toml?raw'
import {
  CLOUDFLARE_FREE_CRON_LIMIT,
  CRONS_USED_BY_OTHER_WORKERS,
  DAILY_EXPORT_CRON,
  FIXTURE_DISCOVERY_CRON,
  MAX_API_CRON_TRIGGERS,
  POLLER_AND_DRAIN_CRON,
  PROVIDER_WORK_DRAIN_MINUTES,
  RESULT_POLLER_MINUTES,
  ROUND_REMINDER_CRON,
  SCHEDULED_CRONS,
} from './crons'

const REPO_ROOT = new URL('../../', import.meta.url)

/**
 * Instruções que o operador copia e roda dentro de api/. Sem `--config`, o
 * wrangler procura wrangler.json e wrangler.jsonc em todos os diretórios acima
 * antes de aceitar um wrangler.toml. O wrangler.jsonc que ficava na raiz saiu
 * em 14/11/2026, e a regra continua para que um arquivo recriado não desvie
 * os comandos.
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
    // Impede que um [env.*] futuro sobrescreva workers_dev ou preview_urls.
    expect(wranglerToml).not.toMatch(/^\[env\./m)
    expect(wranglerToml).toMatch(/^workers_dev = false$/m)
    expect(wranglerToml).toMatch(/^preview_urls = false$/m)
  })

  const declaredCrons = () => {
    const declared = wranglerToml.match(/^crons = (\[.*\])$/m)?.[1]
    expect(declared).toBeDefined()
    return JSON.parse(declared!) as string[]
  }
  const minutes = (cron: string) => cron.split(' ')[0].split(',').map(Number)

  it('declara exatamente os 4 crons esperados, sem nenhum desconhecido', () => {
    expect([...declaredCrons()].sort()).toEqual(
      [
        POLLER_AND_DRAIN_CRON,
        DAILY_EXPORT_CRON,
        ROUND_REMINDER_CRON,
        FIXTURE_DISCOVERY_CRON,
      ].sort(),
    )
    expect(POLLER_AND_DRAIN_CRON).toBe('0,5,10,20,25,30,35,40,50,55 * * * *')
    expect(DAILY_EXPORT_CRON).toBe('5 0 * * *')
    expect(ROUND_REMINDER_CRON).toBe('0 10 * * *')
    expect(FIXTURE_DISCOVERY_CRON).toBe('15 6 * * *')
  })

  it('não passa do limite de cron triggers do plano Free da Cloudflare (erro 10072)', () => {
    // O plano Free permite 5 triggers por CONTA e a conta já usa 1 em outro Worker:
    // sobram 4 para esta API. Com 5 o Deploy API falha com
    // "This account has reached the Workers Free limit of 5 cron triggers per
    // account [code: 10072]" (PR #769, run 44009052934). Para agendar algo novo,
    // use um minuto novo do trigger fundido em vez de um cron novo.
    expect(CLOUDFLARE_FREE_CRON_LIMIT).toBe(5)
    expect(CRONS_USED_BY_OTHER_WORKERS).toBe(1)
    expect(MAX_API_CRON_TRIGGERS).toBe(4)
    expect(declaredCrons()).toHaveLength(4)
    expect(declaredCrons().length + CRONS_USED_BY_OTHER_WORKERS).toBeLessThanOrEqual(
      CLOUDFLARE_FREE_CRON_LIMIT,
    )
    expect(SCHEDULED_CRONS).toHaveLength(MAX_API_CRON_TRIGGERS)
    expect(new Set(declaredCrons()).size).toBe(declaredCrons().length)
  })

  it('o trigger fundido é a união ordenada dos minutos do poller e do dreno', () => {
    const union = [...RESULT_POLLER_MINUTES, ...PROVIDER_WORK_DRAIN_MINUTES].sort((a, b) => a - b)

    expect(minutes(POLLER_AND_DRAIN_CRON)).toEqual(union)
    expect(POLLER_AND_DRAIN_CRON.split(' ').slice(1)).toEqual(['*', '*', '*', '*'])
  })

  it('o poller roda nos minutos 0 e 30 e o dreno nunca nesses minutos', () => {
    expect([...RESULT_POLLER_MINUTES]).toEqual([0, 30])
    for (const minute of PROVIDER_WORK_DRAIN_MINUTES) {
      expect(RESULT_POLLER_MINUTES).not.toContain(minute)
    }
  })

  it('o dreno roda a cada 5 a 10 min e não ocupa o minuto 15 da descoberta', () => {
    const drain = [...PROVIDER_WORK_DRAIN_MINUTES]
    const gaps = drain.map((minute, i) => (drain[(i + 1) % drain.length] - minute + 60) % 60)

    expect(Math.max(...gaps)).toBeLessThanOrEqual(10)
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(5)
    expect(minutes(POLLER_AND_DRAIN_CRON)).not.toContain(minutes(FIXTURE_DISCOVERY_CRON)[0])
  })

  it('o crons.ts não guarda mais o cron separado do dreno', async () => {
    const crons = (await import('./crons')) as Record<string, unknown>

    expect(crons.PROVIDER_WORK_DRAIN_CRON).toBeUndefined()
    expect(crons.RESULT_POLLER_CRON).toBeUndefined()
    expect(wranglerToml).not.toContain('5,10,20,25,35,40,50,55 * * * *')
    expect(wranglerToml).not.toContain('"0,30 * * * *"')
  })
})

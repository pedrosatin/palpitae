/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest'
import deployWorkflow from '../../.github/workflows/deploy-api.yml?raw'
import packageJsonFile from '../package.json'
import wranglerToml from '../wrangler.toml?raw'
import { FIXTURE_DISCOVERY_CRON, RESULT_POLLER_CRON, SCHEDULED_CRONS } from './crons'

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

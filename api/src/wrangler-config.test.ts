/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest'
import deployWorkflow from '../../.github/workflows/deploy-api.yml?raw'
import packageJsonFile from '../package.json'

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
})

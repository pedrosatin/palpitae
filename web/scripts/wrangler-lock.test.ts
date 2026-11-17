// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pruneLock, resolveInLock } from './wrangler-lock.mjs'

const entry = (version: string, extra: Record<string, unknown> = {}) => ({
  version,
  resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
  integrity: `sha512-${version}`,
  ...extra,
})

const LOCK = {
  name: 'app',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: {
    '': { name: 'app', version: '1.0.0', devDependencies: { wrangler: '^4.0.0', vite: '^8.0.0' } },
    'node_modules/wrangler': entry('4.1.0', {
      dependencies: { esbuild: '0.28.1', miniflare: '5.0.0' },
      optionalDependencies: { fsevents: '2.3.3' },
      peerDependencies: { '@cloudflare/workers-types': '^5.0.0' },
      peerDependenciesMeta: { '@cloudflare/workers-types': { optional: true } },
    }),
    'node_modules/esbuild': entry('0.28.1'),
    'node_modules/miniflare': entry('5.0.0', { dependencies: { undici: '7.0.0' } }),
    'node_modules/miniflare/node_modules/undici': entry('7.0.0'),
    'node_modules/undici': entry('6.0.0'),
    'node_modules/@cloudflare/workers-types': entry('5.0.0'),
    'node_modules/vite': entry('8.0.0', { dependencies: { esbuild: '0.28.1' } }),
  },
}

const PKG = { name: 'app', version: '1.0.0', overrides: { undici: '^7.0.0' } }

describe('resolveInLock', () => {
  it('prefere o node_modules aninhado ao da raiz', () => {
    expect(resolveInLock(LOCK.packages, 'node_modules/miniflare', 'undici')).toBe(
      'node_modules/miniflare/node_modules/undici',
    )
    expect(resolveInLock(LOCK.packages, 'node_modules/wrangler', 'esbuild')).toBe(
      'node_modules/esbuild',
    )
    expect(resolveInLock(LOCK.packages, '', 'react')).toBeUndefined()
  })
})

describe('pruneLock', () => {
  const { pkg, lock } = pruneLock(LOCK, PKG)

  it('guarda o wrangler e a árvore dele com as entradas originais', () => {
    expect(Object.keys(lock.packages).sort()).toEqual([
      '',
      'node_modules/esbuild',
      'node_modules/miniflare',
      'node_modules/miniflare/node_modules/undici',
      'node_modules/wrangler',
    ])
    expect(lock.packages['node_modules/miniflare']).toBe(LOCK.packages['node_modules/miniflare'])
  })

  it('deixa de fora o resto do projeto, peers opcionais e opcionais ausentes', () => {
    expect(lock.packages).not.toHaveProperty('node_modules/vite')
    expect(lock.packages).not.toHaveProperty('node_modules/undici')
    expect(lock.packages).not.toHaveProperty('node_modules/@cloudflare/workers-types')
  })

  it('fixa o wrangler na versão do lockfile e mantém os overrides', () => {
    expect(pkg.devDependencies).toEqual({ wrangler: '4.1.0' })
    expect(lock.packages['']).toEqual({
      name: 'app-wrangler',
      version: '1.0.0',
      devDependencies: { wrangler: '4.1.0' },
    })
    expect(pkg.overrides).toEqual(PKG.overrides)
  })

  it('falha quando uma dependência obrigatória falta no lockfile', () => {
    const broken = structuredClone(LOCK) as typeof LOCK & { packages: Record<string, unknown> }
    delete broken.packages['node_modules/esbuild']
    expect(() => pruneLock(broken, PKG)).toThrow(/esbuild/)
  })
})

describe('lockfile da web', () => {
  const realLock = JSON.parse(
    readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'),
  )
  const realPkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const { pkg, lock } = pruneLock(realLock, realPkg)

  it('instala o wrangler do lockfile sem React, Vite nem Vitest', () => {
    expect(pkg.devDependencies.wrangler).toBe(realLock.packages['node_modules/wrangler'].version)
    for (const name of ['react', 'react-dom', 'vite', 'vitest', 'jsdom', 'typescript']) {
      expect(lock.packages).not.toHaveProperty(`node_modules/${name}`)
    }
    for (const [path, value] of Object.entries(lock.packages)) {
      if (path) expect(value).toBe(realLock.packages[path])
    }
  })
})

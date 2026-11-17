/**
 * Recorta do `package-lock.json` da web só o Wrangler e as dependências dele.
 *
 * O job de deploy do `deploy-web.yml` publica o `dist` que o job de teste
 * construiu e precisa apenas do Wrangler. Um `npm ci` da web instalaria também
 * React, Vite, Vitest e jsdom. Este script grava, num diretório à parte, um
 * `package.json` com o Wrangler na versão do lockfile e um `package-lock.json`
 * com as mesmas entradas (versão, `resolved` e `integrity`) da árvore dele. O
 * `npm ci` nesse diretório instala exatamente o que o lockfile da web fixa.
 *
 * O diretório fica fora de `web/` para não sujar a árvore do git, que o
 * `wrangler pages deploy` lê para registrar o commit do deploy.
 *
 * Uso: `node scripts/wrangler-lock.mjs <diretório-de-saída>` (de dentro de `web/`).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const PACKAGE = 'wrangler'

/**
 * Caminho no lockfile do pacote `name` visto a partir de `from` (`''` é a
 * raiz), pela mesma regra do Node: primeiro o `node_modules` aninhado, depois
 * os dos ancestrais. `undefined` quando o lockfile não tem o pacote.
 */
export function resolveInLock(packages, from, name) {
  let base = from
  for (;;) {
    const candidate = `${base ? `${base}/` : ''}node_modules/${name}`
    if (packages[candidate]) return candidate
    if (!base) return undefined
    const cut = base.lastIndexOf('/node_modules/')
    base = cut === -1 ? '' : base.slice(0, cut)
  }
}

/** Lockfile e package.json mínimos com `PACKAGE` e a árvore dele. */
export function pruneLock(lock, pkg, name = PACKAGE) {
  const packages = lock.packages
  const start = resolveInLock(packages, '', name)
  if (!start) throw new Error(`${name} não está no lockfile`)

  const keep = new Set()
  const queue = [start]
  while (queue.length > 0) {
    const path = queue.pop()
    if (keep.has(path)) continue
    keep.add(path)
    const entry = packages[path]
    const optionalPeers = entry.peerDependenciesMeta ?? {}
    const deps = [
      ...Object.keys(entry.dependencies ?? {}),
      ...Object.keys(entry.optionalDependencies ?? {}),
      ...Object.keys(entry.peerDependencies ?? {}).filter((dep) => !optionalPeers[dep]?.optional),
    ]
    for (const dep of deps) {
      const found = resolveInLock(packages, path, dep)
      if (found) queue.push(found)
      else if (entry.dependencies?.[dep])
        throw new Error(`${path} depende de ${dep}, ausente no lockfile`)
    }
  }

  const version = packages[start].version
  const root = {
    name: `${pkg.name}-${name}`,
    version: pkg.version,
    devDependencies: { [name]: version },
  }
  const minimalPkg = { ...root, private: true }
  if (pkg.overrides) minimalPkg.overrides = pkg.overrides
  const pruned = {}
  for (const path of [...keep].sort()) pruned[path] = packages[path]
  return {
    pkg: minimalPkg,
    lock: {
      name: root.name,
      version: root.version,
      lockfileVersion: lock.lockfileVersion,
      requires: true,
      packages: { '': root, ...pruned },
    },
  }
}

async function main() {
  const out = process.argv[2]
  if (!out) throw new Error('uso: node scripts/wrangler-lock.mjs <diretório-de-saída>')
  const webRoot = fileURLToPath(new URL('..', import.meta.url))
  const lock = JSON.parse(await readFile(join(webRoot, 'package-lock.json'), 'utf8'))
  const pkg = JSON.parse(await readFile(join(webRoot, 'package.json'), 'utf8'))
  const result = pruneLock(lock, pkg)
  await mkdir(out, { recursive: true })
  await writeFile(join(out, 'package.json'), `${JSON.stringify(result.pkg, null, 2)}\n`)
  await writeFile(join(out, 'package-lock.json'), `${JSON.stringify(result.lock, null, 2)}\n`)
  const count = Object.keys(result.lock.packages).length - 1
  console.log(
    `${PACKAGE} ${result.pkg.devDependencies[PACKAGE]}: ${count} entradas do lockfile em ${out}`,
  )
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

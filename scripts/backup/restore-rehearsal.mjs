#!/usr/bin/env node
/**
 * Isolated restore rehearsal (local sink):
 *   download/copy ciphertext + manifest + sealed meta → decrypt → import →
 *   compare sealed row counts (and optional synthetic expectations).
 *
 * Never targets production D1. Prefer `restore.mjs` for R2 downloads.
 */

import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalSink } from './lib/sink-local.mjs'
import { restoreIsolated } from './restore.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '../..')

function usage(code = 0) {
  process.stdout.write(`Usage: node scripts/backup/restore-rehearsal.mjs [options]

Options:
  --sink-dir=PATH           Local object root
  --ciphertext-key=KEY      Object key of the .sql.gz.age file
  --identity=PATH           age identity file (private; outside the repo)
  --expect=synthetic|sealed|none   Verification profile (default: sealed)
  --report=PATH             Write JSON report
  --help
`)
  process.exit(code)
}

function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {
    sinkDir: resolve(process.cwd(), '.scratch-local/backup-sink'),
    expect: 'sealed',
  }
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg.startsWith('--sink-dir=')) out.sinkDir = resolve(arg.slice(11))
    else if (arg.startsWith('--ciphertext-key=')) out.ciphertextKey = arg.slice(17)
    else if (arg.startsWith('--identity=')) out.identity = resolve(arg.slice(11))
    else if (arg.startsWith('--expect=')) out.expect = arg.slice(9)
    else if (arg.startsWith('--report=')) out.report = resolve(arg.slice(9))
    else throw new Error(`unknown argument: ${arg}`)
  }
  return out
}

function assertIdentityOutsideRepo(identityPath) {
  const abs = resolve(identityPath)
  if (abs === REPO_ROOT || abs.startsWith(REPO_ROOT + '/')) {
    throw new Error(
      `refusing identity inside the repository (${abs}). Keep the private key outside the checkout.`,
    )
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) usage(0)
  if (!args.ciphertextKey) throw new Error('--ciphertext-key is required')
  if (!args.identity) throw new Error('--identity is required')
  assertIdentityOutsideRepo(String(args.identity))

  const sink = createLocalSink(String(args.sinkDir))
  const report = await restoreIsolated({
    sink,
    ciphertextKey: String(args.ciphertextKey),
    identityPath: String(args.identity),
    expect: String(args.expect),
  })

  if (args.report) {
    await writeFile(String(args.report), `${JSON.stringify(report, null, 2)}\n`, {
      mode: 0o600,
    })
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ok) process.exit(2)
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`)
  process.exit(1)
})

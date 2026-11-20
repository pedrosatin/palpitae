import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip, createGunzip } from 'node:zlib'
import {
  buildManifest,
  sha256File,
} from './integrity.mjs'
import { buildObjectPaths } from './naming.mjs'
import { assertAllowedRecipient, recipientsFingerprints } from './recipients.mjs'
import { buildSealedMeta, sealedMetaBody } from './sealed-meta.mjs'
import { buildPublicCounts, publicCountsBody, SNAPSHOT_LIMITS } from './counts-baseline.mjs'

/**
 * Resolve age / age-keygen binaries.
 * Prefer PATH; fall back to PALPITAE_AGE_BIN / PALPITAE_AGE_KEYGEN_BIN.
 */
export function resolveAgeBins() {
  return {
    age: process.env.PALPITAE_AGE_BIN || 'age',
    ageKeygen: process.env.PALPITAE_AGE_KEYGEN_BIN || 'age-keygen',
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ inputPath?: string, outputPath?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function runCommand(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...opts.env },
    })
    /** @type {Buffer[]} */
    const stdout = []
    /** @type {Buffer[]} */
    const stderr = []
    child.stdout.on('data', (c) => stdout.push(c))
    child.stderr.on('data', (c) => stderr.push(c))

    let inputEnded = Promise.resolve()
    if (opts.inputPath) {
      inputEnded = pipeline(createReadStream(opts.inputPath), child.stdin).catch((err) => {
        child.kill('SIGTERM')
        throw err
      })
    } else {
      child.stdin.end()
    }

    child.on('error', (err) => {
      reject(
        new Error(
          `failed to spawn ${command}: ${err.message}. Install age or set PALPITAE_AGE_BIN.`,
        ),
      )
    })

    child.on('close', async (code) => {
      try {
        await inputEnded
      } catch (err) {
        reject(err)
        return
      }
      const out = Buffer.concat(stdout)
      const errBuf = Buffer.concat(stderr)
      if (code !== 0) {
        reject(
          new Error(
            `${command} ${args.join(' ')} exited ${code}: ${errBuf.toString('utf8').trim()}`,
          ),
        )
        return
      }
      if (opts.outputPath) {
        await writeFile(opts.outputPath, out, { mode: 0o600 })
      }
      resolve({ stdout: out, stderr: errBuf })
    })
  })
}

/**
 * Prefer a disk-backed cache dir over /tmp (tmpfs) so large dumps do not
 * exhaust RAM. Override with PALPITAE_BACKUP_TMP.
 */
export function defaultBackupTmpRoot() {
  if (process.env.PALPITAE_BACKUP_TMP) return process.env.PALPITAE_BACKUP_TMP
  const home = process.env.HOME || homedir()
  if (home) return join(home, '.cache/scratch/palpitae-backup-tmp')
  // Last resort: still prefer an explicit subdir under the OS temp root, and
  // callers should chmod 0700 via createWorkDir. Avoid dumping plaintext at the
  // tmp root itself.
  return join(tmpdir(), 'palpitae-backup-tmp')
}

/**
 * Create a private work directory mode 0700 under base.
 * Caller must dispose.
 * @param {string} [base]
 */
export async function createWorkDir(base = defaultBackupTmpRoot()) {
  await mkdir(base, { recursive: true, mode: 0o700 })
  const dir = await mkdtemp(join(base, 'palpitae-backup-'))
  await chmod(dir, 0o700)
  return {
    dir,
    async dispose() {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Overwrite then unlink a file. Best-effort; not a guarantee against forensic recovery.
 * @param {string} path
 */
export async function scrubFile(path) {
  try {
    const data = await readFile(path)
    await writeFile(path, Buffer.alloc(data.length, 0))
  } catch {
    // ignore missing
  }
  await rm(path, { force: true })
}

/**
 * gzip a plaintext SQL dump.
 * @param {string} inputPath
 * @param {string} outputPath
 */
export async function gzipFile(inputPath, outputPath) {
  await mkdir(dirname(outputPath), { recursive: true })
  await pipeline(createReadStream(inputPath), createGzip({ level: 9 }), createWriteStream(outputPath, { mode: 0o600 }))
}

/**
 * @param {string} inputPath
 * @param {string} outputPath
 */
export async function gunzipFile(inputPath, outputPath) {
  await pipeline(createReadStream(inputPath), createGunzip(), createWriteStream(outputPath, { mode: 0o600 }))
}

/**
 * Encrypt a file to one or more age recipients (public key strings).
 * @param {{
 *   ageBin: string,
 *   inputPath: string,
 *   outputPath: string,
 *   recipient?: string,
 *   recipients?: string[],
 * }} opts
 */
export async function ageEncryptFile(opts) {
  const { ageBin, inputPath, outputPath } = opts
  const list = (opts.recipients && opts.recipients.length > 0
    ? opts.recipients
    : opts.recipient
      ? [opts.recipient]
      : []
  ).map((r) => assertAllowedRecipient(r))
  if (list.length === 0) {
    throw new Error('ageEncryptFile requires at least one recipient')
  }
  /** @type {string[]} */
  const args = []
  for (const recipient of list) {
    args.push('-r', recipient)
  }
  args.push('-o', outputPath, inputPath)
  await runCommand(ageBin, args)
  await chmod(outputPath, 0o600)
}

/**
 * Decrypt with an identity file. Identity path must stay outside the repo.
 * @param {{ ageBin: string, inputPath: string, outputPath: string, identityPath: string }} opts
 */
export async function ageDecryptFile({ ageBin, inputPath, outputPath, identityPath }) {
  await runCommand(ageBin, ['-d', '-i', identityPath, '-o', outputPath, inputPath])
  await chmod(outputPath, 0o600)
}

/**
 * Full pack: plaintext SQL → gzip → age → sink.put + manifest.
 *
 * If ciphertext upload succeeds and manifest upload fails, the orphan ciphertext
 * remains on the sink (unvalidated / preserved by prune). The error propagates
 * and the caller must not report success. Retries of the whole pack create a
 * new stamp rather than silently claiming the orphan is complete.
 *
 * @param {{
 *   sink: { put: Function, pathFor?: Function },
 *   dbName: string,
 *   plaintextPath: string,
 *   recipient?: string,
 *   recipients?: string[],
 *   source: string,
 *   prefix?: string,
 *   createdAt?: Date,
 *   ageBin?: string,
 *   rowCounts?: Record<string, number>,
 *   tablesPresent?: string[],
 * }} opts
 */
export async function packAndStore(opts) {
  const {
    sink,
    dbName,
    plaintextPath,
    source,
    prefix = '',
    createdAt = new Date(),
    ageBin = resolveAgeBins().age,
  } = opts

  const recipients = (
    opts.recipients && opts.recipients.length > 0
      ? opts.recipients
      : opts.recipient
        ? [opts.recipient]
        : []
  ).map((r) => assertAllowedRecipient(r))
  if (recipients.length === 0) {
    throw new Error('packAndStore requires recipient or recipients')
  }
  if (!opts.rowCounts || typeof opts.rowCounts !== 'object') {
    throw new Error(
      'packAndStore requires rowCounts from validatePlaintextDump (sealed into .meta.json.age)',
    )
  }
  const fps = recipientsFingerprints(recipients)

  const work = await createWorkDir()
  /** @type {string | null} */
  let uploadedCiphertextKey = null
  try {
    const paths = buildObjectPaths({ prefix, dbName, createdAt })
    const gzipPath = join(work.dir, `${paths.stamp}.sql.gz`)
    const agePath = join(work.dir, `${paths.stamp}.sql.gz.age`)
    const manifestPath = join(work.dir, `${paths.stamp}.manifest.json`)
    const sealedPlainPath = join(work.dir, `${paths.stamp}.meta.json`)
    const sealedAgePath = join(work.dir, `${paths.stamp}.meta.json.age`)
    const countsPath = join(work.dir, `${paths.stamp}.counts.json`)
    const createdAtIso = createdAt.toISOString()

    const plaintextSha256 = await sha256File(plaintextPath)
    const plaintextBytes = (await stat(plaintextPath)).size

    await gzipFile(plaintextPath, gzipPath)
    const gzipSha256 = await sha256File(gzipPath)
    const gzipBytes = (await stat(gzipPath)).size

    await ageEncryptFile({ ageBin, inputPath: gzipPath, outputPath: agePath, recipients })
    const ciphertextSha256 = await sha256File(agePath)
    const ciphertextBytes = (await stat(agePath)).size

    // Pass file path so sinks can stream instead of buffering the ciphertext twice.
    await sink.put(paths.ciphertextKey, { path: agePath })
    uploadedCiphertextKey = paths.ciphertextKey

    const sealed = buildSealedMeta({
      dbName,
      stamp: paths.stamp,
      ciphertextKey: paths.ciphertextKey,
      plaintextSha256,
      rowCounts: opts.rowCounts,
      ageRecipientFingerprint: fps.recipientFingerprint,
      ageRecipientFingerprints: fps.recipientFingerprints,
      createdAtIso,
    })
    const { body: sealedBody } = sealedMetaBody(sealed)
    await writeFile(sealedPlainPath, sealedBody, { mode: 0o600 })
    await ageEncryptFile({
      ageBin,
      inputPath: sealedPlainPath,
      outputPath: sealedAgePath,
      recipients,
    })
    const sealedMetaSha256 = await sha256File(sealedAgePath)
    const sealedMetaBytes = (await stat(sealedAgePath)).size
    try {
      await sink.put(paths.sealedMetaKey, { path: sealedAgePath })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `sealed meta upload failed after ciphertext was stored at ${uploadedCiphertextKey}: ${msg}. Orphan ciphertext is unvalidated and must be preserved until repaired or explicitly removed by an operator.`,
      )
    }

    const publicCounts = buildPublicCounts({
      dbName,
      stamp: paths.stamp,
      ciphertextKey: paths.ciphertextKey,
      rowCounts: opts.rowCounts,
      tables: opts.tablesPresent,
      createdAtIso,
    })
    const { body: countsBody, sha256: countsSha256, bytes: countsBytes } =
      publicCountsBody(publicCounts)
    await writeFile(countsPath, countsBody, { mode: 0o600 })
    try {
      await sink.put(paths.countsKey, { path: countsPath })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `public counts upload failed after ciphertext was stored at ${uploadedCiphertextKey}: ${msg}. Orphan ciphertext is unvalidated and must be preserved until repaired or explicitly removed by an operator.`,
      )
    }

    const manifest = buildManifest({
      dbName,
      stamp: paths.stamp,
      ciphertextKey: paths.ciphertextKey,
      sealedMetaKey: paths.sealedMetaKey,
      countsKey: paths.countsKey,
      ciphertextSha256,
      plaintextSha256,
      gzipSha256,
      sealedMetaSha256,
      countsSha256,
      plaintextBytes,
      gzipBytes,
      ciphertextBytes,
      sealedMetaBytes,
      countsBytes,
      ageRecipientFingerprint: fps.recipientFingerprint,
      ageRecipientFingerprints: fps.recipientFingerprints,
      ageRecipientCount: fps.recipientCount,
      source,
      createdAtIso,
      snapshotLimits: SNAPSHOT_LIMITS,
    })
    const manifestBody = `${JSON.stringify(manifest, null, 2)}\n`
    await writeFile(manifestPath, manifestBody, { mode: 0o600 })
    try {
      await sink.put(paths.manifestKey, { path: manifestPath })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(
        `manifest upload failed after ciphertext was stored at ${uploadedCiphertextKey}: ${msg}. Orphan ciphertext is unvalidated and must be preserved until repaired or explicitly removed by an operator.`,
      )
    }

    await scrubFile(gzipPath)
    await scrubFile(agePath)
    await scrubFile(manifestPath)
    await scrubFile(sealedPlainPath)
    await scrubFile(sealedAgePath)
    await scrubFile(countsPath)

    return { paths, manifest, sealedMeta: sealed, publicCounts, recipients }
  } finally {
    await work.dispose()
  }
}

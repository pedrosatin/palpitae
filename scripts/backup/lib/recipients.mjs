/**
 * Load and validate age public recipients.
 *
 * Rules:
 * - Support multiple age1 lines (comments and blanks ignored).
 * - Refuse AGE-SECRET-KEY material.
 * - Refuse the committed recipients.example path (copy to recipients.local).
 * - Refuse known orphan/example public keys that must never encrypt real backups.
 */

import { basename } from 'node:path'
import { readFile } from 'node:fs/promises'
import { recipientFingerprint, sha256Buffer } from './integrity.mjs'

/** Basename that must never be used as a live recipients file. */
export const EXAMPLE_RECIPIENTS_BASENAME = 'recipients.example'

/**
 * Public keys that appeared in docs/examples and must not encrypt real data.
 * The matching private keys are destroyed or were never operator-controlled.
 */
export const FORBIDDEN_EXAMPLE_RECIPIENTS = Object.freeze([
  'age1wqylnjtxa7m0ksva9ca08v745awzj5e5k4n4scss9tdjh5dgq5ds6t6zw9',
])

/**
 * @param {string} recipient
 */
export function assertAllowedRecipient(recipient) {
  const trimmed = recipient.trim()
  if (!trimmed.startsWith('age1')) {
    throw new Error(`recipient must be an age public key (age1...), got: ${trimmed.slice(0, 12)}`)
  }
  if (trimmed.startsWith('AGE-SECRET-KEY')) {
    throw new Error('refusing AGE-SECRET-KEY material; recipients must be public age1 keys only')
  }
  if (FORBIDDEN_EXAMPLE_RECIPIENTS.includes(trimmed)) {
    throw new Error(
      'refusing known example/orphan recipient; generate a real age-keygen pair and use recipients.local',
    )
  }
  return trimmed
}

/**
 * Parse recipients from file text. Returns unique age1 keys in file order.
 *
 * @param {string} raw
 * @param {{ sourcePath?: string }} [opts]
 * @returns {string[]}
 */
export function parseRecipientsText(raw, opts = {}) {
  if (opts.sourcePath && basename(opts.sourcePath) === EXAMPLE_RECIPIENTS_BASENAME) {
    throw new Error(
      `refusing ${EXAMPLE_RECIPIENTS_BASENAME}; copy the template to recipients.local with real public keys after a restore rehearsal`,
    )
  }

  if (/AGE-SECRET-KEY/i.test(raw)) {
    throw new Error('refusing recipients content that contains AGE-SECRET-KEY material')
  }

  /** @type {string[]} */
  const found = []
  const seen = new Set()
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    if (!trimmed.startsWith('age1')) {
      throw new Error(`invalid recipients line (expected age1... or comment): ${trimmed.slice(0, 24)}`)
    }
    const recipient = assertAllowedRecipient(trimmed)
    if (seen.has(recipient)) continue
    seen.add(recipient)
    found.push(recipient)
  }
  if (found.length === 0) {
    throw new Error('no age1 recipients found')
  }
  return found
}

/**
 * @param {string} path
 * @returns {Promise<string[]>}
 */
export async function loadRecipientsFile(path) {
  const raw = await readFile(path, 'utf8')
  return parseRecipientsText(raw, { sourcePath: path })
}

/**
 * Resolve recipients from CLI/env. Prefer explicit --recipient (repeatable via
 * comma-separated) or --recipients-file; else AGE_RECIPIENT / BACKUP_AGE_RECIPIENT.
 *
 * @param {{
 *   recipient?: string | boolean,
 *   recipientsFile?: string | boolean,
 * }} args
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<string[]>}
 */
export async function resolveRecipients(args, env = process.env) {
  if (args.recipientsFile) {
    return loadRecipientsFile(String(args.recipientsFile))
  }
  if (args.recipient) {
    const parts = String(args.recipient)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    return parseRecipientsText(parts.join('\n'))
  }
  const fromEnv = (env.AGE_RECIPIENT || env.BACKUP_AGE_RECIPIENT || '').trim()
  if (fromEnv) {
    // Env may hold one key or newline/comma-separated keys.
    const normalized = fromEnv.includes('\n') ? fromEnv : fromEnv.split(',').join('\n')
    return parseRecipientsText(normalized)
  }
  throw new Error('provide --recipient, --recipients-file, or AGE_RECIPIENT')
}

/**
 * Stable fingerprints for one or more recipients.
 * @param {string[]} recipients
 */
export function recipientsFingerprints(recipients) {
  const list = recipients.map((r) => recipientFingerprint(r))
  const combined = sha256Buffer(`${list.join('\n')}\n`).slice(0, 16)
  return {
    recipientFingerprints: list,
    recipientFingerprint: list.length === 1 ? list[0] : combined,
    recipientCount: list.length,
  }
}

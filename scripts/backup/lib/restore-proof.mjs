/**
 * BACKUP_RESTORE_PROOF helpers.
 *
 * An arbitrary string does **not** prove possession of the age identity or that
 * a restore rehearsal succeeded. The accepted format binds an operator token to
 * the fingerprint(s) of the age recipients used in that rehearsal.
 *
 * This is an operational checklist gate for CI, not an authenticated
 * cryptographic proof and not a substitute for a real isolated restore drill.
 */

import { recipientFingerprint } from './integrity.mjs'
import { recipientsFingerprints } from './recipients.mjs'

export const RESTORE_PROOF_PREFIX = 'palpitae-restore-proof:v1'

const PLACEHOLDERS = new Set([
  '',
  'TODO',
  'todo',
  'example',
  'EXAMPLE',
  'replace-me',
  'REPLACE-ME',
])

/**
 * Build a proof string after a successful isolated restore rehearsal.
 *
 * @param {{
 *   recipientFingerprints: string[],
 *   operatorToken: string,
 * }} opts
 */
export function buildRestoreProof(opts) {
  const fps = [...opts.recipientFingerprints].map((f) => String(f).toLowerCase()).sort()
  if (fps.length === 0) {
    throw new Error('restore proof requires at least one recipient fingerprint')
  }
  const token = String(opts.operatorToken || '').trim()
  if (!token || PLACEHOLDERS.has(token) || token.length < 8) {
    throw new Error(
      'operatorToken must be a non-placeholder string ≥ 8 chars chosen by the operator after a real rehearsal',
    )
  }
  if (/[:\s]/.test(token)) {
    throw new Error('operatorToken must not contain spaces or colons')
  }
  return `${RESTORE_PROOF_PREFIX}:${fps.join(',')}:${token}`
}

/**
 * @param {string[]} recipients age1 public keys used in the rehearsal
 * @param {string} operatorToken
 */
export function buildRestoreProofFromRecipients(recipients, operatorToken) {
  const fps = recipientsFingerprints(recipients)
  return buildRestoreProof({
    recipientFingerprints: fps.recipientFingerprints,
    operatorToken,
  })
}

/**
 * Validate a CI secret against the expected recipient fingerprint set.
 *
 * @param {string} proof
 * @param {{
 *   expectedFingerprints?: string[],
 *   expectedRecipients?: string[],
 * }} [opts]
 */
export function validateRestoreProof(proof, opts = {}) {
  const value = String(proof || '').trim()
  if (PLACEHOLDERS.has(value)) {
    return { ok: false, reason: 'placeholder-or-empty' }
  }
  if (!value.startsWith(`${RESTORE_PROOF_PREFIX}:`)) {
    return {
      ok: false,
      reason: 'unbound-arbitrary-string',
      detail:
        'BACKUP_RESTORE_PROOF must be palpitae-restore-proof:v1:<sorted-fps>:<token> bound to the rehearsal recipients. An arbitrary string is not proof of possession.',
    }
  }
  const rest = value.slice(`${RESTORE_PROOF_PREFIX}:`.length)
  const lastColon = rest.lastIndexOf(':')
  if (lastColon <= 0 || lastColon === rest.length - 1) {
    return { ok: false, reason: 'malformed-proof' }
  }
  const fpsPart = rest.slice(0, lastColon)
  const token = rest.slice(lastColon + 1)
  if (!token || PLACEHOLDERS.has(token) || token.length < 8 || /[:\s]/.test(token)) {
    return { ok: false, reason: 'invalid-operator-token' }
  }
  const proofFps = fpsPart
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .sort()
  if (proofFps.length === 0 || proofFps.some((f) => !/^[0-9a-f]{8,64}$/i.test(f))) {
    return { ok: false, reason: 'invalid-fingerprint-list' }
  }

  /** @type {string[] | null} */
  let expected = null
  if (opts.expectedFingerprints && opts.expectedFingerprints.length > 0) {
    expected = [...opts.expectedFingerprints].map((f) => f.toLowerCase()).sort()
  } else if (opts.expectedRecipients && opts.expectedRecipients.length > 0) {
    expected = opts.expectedRecipients.map((r) => recipientFingerprint(r)).sort()
  }

  if (expected) {
    if (expected.join(',') !== proofFps.join(',')) {
      return {
        ok: false,
        reason: 'fingerprint-mismatch',
        expected,
        proofFingerprints: proofFps,
      }
    }
  }

  return {
    ok: true,
    recipientFingerprints: proofFps,
    operatorTokenPresent: true,
    limitations: [
      'Not an authenticated cryptographic proof of identity possession.',
      'Does not replace a real isolated restore rehearsal.',
      'Anyone who knows the format can forge a matching string if they also know the public recipient fingerprints.',
      'CI only checks format (+ optional fingerprint match against BACKUP_AGE_RECIPIENT).',
    ],
  }
}

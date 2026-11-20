/**
 * Safety gates before applying retention deletes.
 *
 * Fail-closed rules:
 * - never apply on an empty or incomplete inventory validation
 * - only validated (manifest + ciphertext hash) objects enter keep/prune
 * - unvalidated copies are always preserved
 * - never delete the newest validated backup
 * - refuse apply when no validated backup exists to anchor retention
 * - refuse apply when a concurrent inventory change is detected
 */

/**
 * @param {{
 *   keep: Array<{ key: string, createdAt: Date }>,
 *   prune: Array<{ key: string, createdAt: Date }>,
 *   listed: Array<{ key: string, createdAt: Date }>,
 *   validated?: Array<{ key: string, createdAt: Date }>,
 *   unvalidated?: Array<{ key: string, createdAt: Date, reason?: string }>,
 *   incomplete?: boolean,
 *   inventoryChanged?: boolean,
 *   apply: boolean,
 * }} plan
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function evaluatePruneSafety(plan) {
  const {
    keep,
    prune,
    listed,
    incomplete = false,
    inventoryChanged = false,
    apply,
  } = plan

  const validated = plan.validated ?? listed
  const unvalidated = plan.unvalidated ?? []
  const integrityAware = plan.validated !== undefined || plan.unvalidated !== undefined

  if (inventoryChanged) {
    return { ok: false, reason: 'inventory-changed-concurrently' }
  }

  if (incomplete) {
    return { ok: false, reason: 'inventory-validation-incomplete' }
  }

  if (!Array.isArray(listed) || listed.length === 0) {
    return { ok: false, reason: 'empty-inventory' }
  }

  if (!Array.isArray(validated) || validated.length === 0) {
    return { ok: false, reason: integrityAware ? 'no-validated-backup' : 'empty-inventory' }
  }

  const newestValidated = [...validated].sort((a, b) => b.createdAt - a.createdAt)[0]
  if (!newestValidated) {
    return { ok: false, reason: 'no-validated-backup' }
  }

  if (keep.length === 0) {
    return { ok: false, reason: 'keep-set-empty' }
  }

  if (!keep.some((k) => k.key === newestValidated.key)) {
    return { ok: false, reason: integrityAware ? 'newest-validated-not-kept' : 'newest-not-kept' }
  }

  if (prune.some((p) => p.key === newestValidated.key)) {
    return { ok: false, reason: integrityAware ? 'newest-validated-in-prune-set' : 'newest-in-prune-set' }
  }

  const unvalidatedKeys = new Set(unvalidated.map((u) => u.key))
  if (prune.some((p) => unvalidatedKeys.has(p.key))) {
    return { ok: false, reason: 'unvalidated-in-prune-set' }
  }

  if (apply && keep.length + prune.length !== validated.length) {
    const managed = new Set([...keep, ...prune].map((o) => o.key))
    if (validated.some((k) => !managed.has(k.key))) {
      return { ok: false, reason: 'incomplete-retention-partition' }
    }
  }

  if (apply && prune.length > 0 && keep.length < 1) {
    return { ok: false, reason: 'would-delete-last-valid-backup' }
  }

  if (apply && validated.length === 1 && prune.length > 0) {
    return {
      ok: false,
      reason: integrityAware ? 'sole-validated-backup-protected' : 'sole-backup-protected',
    }
  }

  return { ok: true }
}

/**
 * Throw when apply was requested and the plan is unsafe.
 * Dry-run always proceeds (returns the evaluation for logging).
 *
 * @param {Parameters<typeof evaluatePruneSafety>[0]} plan
 */
export function assertPruneSafeToApply(plan) {
  const evaluation = evaluatePruneSafety(plan)
  if (plan.apply && !evaluation.ok) {
    throw new Error(`refusing --apply prune: ${evaluation.reason}`)
  }
  return evaluation
}

/**
 * Retention policy for independent D1 backups.
 *
 * Defaults (operator decision for ticket 08):
 *   daily:   keep 14 distinct calendar days (UTC)
 *   weekly:  keep 8 distinct ISO weeks (UTC Monday-start week key)
 *   monthly: keep 12 distinct calendar months (UTC)
 *
 * A single object can satisfy more than one tier. The newest object is always
 * kept. Prune candidates are objects that match none of the keep sets.
 */

/** @typedef {{ key: string, createdAt: Date }} BackupObject */

export const DEFAULT_RETENTION = Object.freeze({
  daily: 14,
  weekly: 8,
  monthly: 12,
})

/**
 * @param {Date} date
 * @returns {string} YYYY-MM-DD in UTC
 */
export function utcDayKey(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * ISO week key Monday-start, UTC. Format: YYYY-Www
 * @param {Date} date
 */
export function utcWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  // Thursday in current week decides the year (ISO 8601).
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * @param {Date} date
 * @returns {string} YYYY-MM
 */
export function utcMonthKey(date) {
  return date.toISOString().slice(0, 7)
}

/**
 * Pick which objects to keep under the retention policy.
 *
 * Strategy: sort newest-first. Walk once and claim slots for daily / weekly /
 * monthly tiers. An object that fills a new day also fills week/month if those
 * slots remain. Always keep the newest object even if counts are zero.
 *
 * @param {BackupObject[]} objects
 * @param {{ daily?: number, weekly?: number, monthly?: number }} [policy]
 * @returns {{ keep: BackupObject[], prune: BackupObject[], reasons: Map<string, string[]> }}
 */
export function selectRetention(objects, policy = DEFAULT_RETENTION) {
  const dailyLimit = policy.daily ?? DEFAULT_RETENTION.daily
  const weeklyLimit = policy.weekly ?? DEFAULT_RETENTION.weekly
  const monthlyLimit = policy.monthly ?? DEFAULT_RETENTION.monthly

  const sorted = [...objects].sort((a, b) => b.createdAt - a.createdAt)
  /** @type {Set<string>} */
  const keepKeys = new Set()
  /** @type {Map<string, string[]>} */
  const reasons = new Map()

  /** @param {string} key @param {string} reason */
  function mark(key, reason) {
    keepKeys.add(key)
    const list = reasons.get(key) ?? []
    list.push(reason)
    reasons.set(key, list)
  }

  if (sorted[0]) mark(sorted[0].key, 'newest')

  const seenDays = new Set()
  const seenWeeks = new Set()
  const seenMonths = new Set()

  for (const obj of sorted) {
    const day = utcDayKey(obj.createdAt)
    const week = utcWeekKey(obj.createdAt)
    const month = utcMonthKey(obj.createdAt)

    if (!seenDays.has(day) && seenDays.size < dailyLimit) {
      seenDays.add(day)
      mark(obj.key, `daily:${day}`)
    }
    if (!seenWeeks.has(week) && seenWeeks.size < weeklyLimit) {
      seenWeeks.add(week)
      mark(obj.key, `weekly:${week}`)
    }
    if (!seenMonths.has(month) && seenMonths.size < monthlyLimit) {
      seenMonths.add(month)
      mark(obj.key, `monthly:${month}`)
    }
  }

  const keep = sorted.filter((o) => keepKeys.has(o.key))
  const prune = sorted.filter((o) => !keepKeys.has(o.key))
  return { keep, prune, reasons }
}

/**
 * Sink factory. Local and R2 share the same object-key layout and prune API.
 * Choosing a sink means list/put/delete all operate on that same store — a
 * local prune never pretends to clean R2.
 */

import { createLocalSink } from './sink-local.mjs'
import { createR2Sink } from './sink-r2.mjs'

/**
 * @param {{
 *   kind: 'local' | 'r2',
 *   sinkDir?: string,
 *   r2?: Parameters<typeof createR2Sink>[0],
 * }} opts
 */
export function createSink(opts) {
  if (opts.kind === 'local') {
    if (!opts.sinkDir) throw new Error('sinkDir is required for kind=local')
    return createLocalSink(opts.sinkDir)
  }
  if (opts.kind === 'r2') {
    return createR2Sink(opts.r2 || {})
  }
  throw new Error(`unsupported sink kind: ${opts.kind}`)
}

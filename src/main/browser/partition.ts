// Each worktree's pages get their own session partition, so two worktrees serving the same localhost origin never
// share cookies, storage or service workers. No Electron imports, so it is unit-tested.
import { createHash } from 'node:crypto'

export const PARTITION_PREFIX = 'persist:tr-browser:'

export function partitionFor(worktree: string): string {
  return `${PARTITION_PREFIX}${createHash('sha256').update(worktree).digest('hex').slice(0, 16)}`
}

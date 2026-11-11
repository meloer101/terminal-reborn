// Whether a branch is in the middle of a merge, rebase, cherry-pick or revert in any worktree of its repository: the
// one check everything that moves a base ref by itself runs first (catching up after a PR merge or in 同步, exit A's
// catch-up and the local merge's fast-forward), since moving the ref under that operation breaks it.
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { operationInProgress, type GitOperation } from '@shared/git-merge'
import type { PorcelainWorktree } from '@shared/git-worktrees'
import { gitOut } from './run'

/**
 * The operation in progress on `branch`: in the checkout that has it out, or a rebase of it whose HEAD is detached
 * (git's is_worktree_being_rebased: `rebase-merge` / `rebase-apply` name it in head-name). `listing` is
 * `git worktree list --porcelain`, parsed.
 */
export async function operationOnBranch(listing: readonly PorcelainWorktree[], branch: string): Promise<GitOperation | null> {
  for (const entry of listing) {
    if (entry.bare || (entry.branch && entry.branch !== branch)) continue
    const gitDir = (await gitOut(entry.path, ['rev-parse', '--absolute-git-dir'])).trim()
    if (!gitDir) continue
    if (entry.branch === branch) {
      const kind = operationInProgress(await readdir(gitDir).catch(() => []))
      if (kind) return kind
      continue
    }
    for (const dir of ['rebase-merge', 'rebase-apply']) {
      const head = await readFile(join(gitDir, dir, 'head-name'), 'utf8').catch(() => '')
      if (head.trim() === `refs/heads/${branch}`) return 'rebase'
    }
  }
  return null
}

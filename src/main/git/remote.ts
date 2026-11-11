// Which remote a branch's work and its base are pushed to and fetched from: the one place that decides, shared by the
// ship chain (exit A, 再推送, 同步, 推送, the preflight), 创建 PR and its text, base CI and the local merge sheet's push,
// so the preflight and what runs never pick different remotes in a repository whose remote is not called origin.
import { gitOut } from './run'

export async function remotesOf(cwd: string): Promise<string[]> {
  return (await gitOut(cwd, ['remote'])).split('\n').map((r) => r.trim()).filter(Boolean)
}

/** A branch's upstream from the config (%(upstream) is empty when no fetch refspec maps it, as in a single-branch clone). */
const upstreamOf = async (cwd: string, branch: string): Promise<{ remote: string; remoteRef: string }> => {
  const [remote, remoteRef] = await Promise.all(['remote', 'merge'].map((key) => gitOut(cwd, ['config', '--get', `branch.${branch}.${key}`]).then((out) => out.trim())))
  return { remote: remote ?? '', remoteRef: remoteRef ?? '' }
}

/**
 * The remote a branch is pushed to and fetched from (推送, 创建 PR, 拉取): the branch's upstream remote, else `origin`,
 * else the base's upstream remote, else the repository's only remote; null without one.
 */
export async function remoteFor(cwd: string, branch: string | null, base: string | null = null): Promise<string | null> {
  const [remotes, own, baseOwn] = await Promise.all([
    remotesOf(cwd),
    branch ? upstreamOf(cwd, branch).then((up) => up.remote) : Promise.resolve(''),
    base ? upstreamOf(cwd, base).then((up) => up.remote) : Promise.resolve('')
  ])
  if (own && own !== '.' && remotes.includes(own)) return own
  if (remotes.includes('origin')) return 'origin'
  if (baseOwn && baseOwn !== '.' && remotes.includes(baseOwn)) return baseOwn
  return remotes.length === 1 ? remotes[0]! : null
}

/**
 * The remote the base is pushed to (exit A, 再推送, the merge sheet) and read from (its protection, merge settings and
 * CI): the base's own upstream remote (whatever the branch there is called: pushBase refuses another name), else
 * `origin`, else the only remote — a branch published to a fork must not take the base there. Only a repository with
 * several remotes, none of them origin or the base's, falls back to the branch's own upstream remote.
 */
export async function baseRemoteFor(cwd: string, branch: string | null, base: string): Promise<string | null> {
  const [remotes, up] = await Promise.all([remotesOf(cwd), upstreamOf(cwd, base)])
  if (up.remote && up.remote !== '.' && remotes.includes(up.remote)) return up.remote
  return (await remoteFor(cwd, null, base)) ?? (branch ? remoteFor(cwd, branch, base) : null)
}

/**
 * `<remote>/<name>` when the base's upstream is a branch of another name on `remote` (local main tracking origin/master):
 * a push of `<base>:<base>` would create a new branch there and leave the one it tracks behind, and git's own push
 * (push.default=simple) refuses it. null otherwise.
 */
export async function renamedUpstream(cwd: string, base: string, remote: string): Promise<string | null> {
  const up = await upstreamOf(cwd, base)
  if (up.remote !== remote || !up.remoteRef.startsWith('refs/heads/') || up.remoteRef === `refs/heads/${base}`) return null
  return `${remote}/${up.remoteRef.slice('refs/heads/'.length)}`
}

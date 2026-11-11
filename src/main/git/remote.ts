// Which remote a branch's work is pushed to and fetched from, shared by the ship chain (exit A, 同步, the preflight) and the
// local merge sheet's push, so they never disagree about a repository whose remote is not called origin.
import { gitOut } from './run'

export async function remotesOf(cwd: string): Promise<string[]> {
  return (await gitOut(cwd, ['remote'])).split('\n').map((r) => r.trim()).filter(Boolean)
}

/**
 * The remote the chain pushes to and fetches from: the branch's upstream remote, else `origin`, else the base's
 * upstream remote, else the repository's only remote; null without one.
 */
export async function remoteFor(cwd: string, branch: string, base: string | null = null): Promise<string | null> {
  const remoteOf = (ref: string): Promise<string> => gitOut(cwd, ['for-each-ref', '--format=%(upstream:remotename)', ref]).then((out) => out.trim())
  const [remotes, own, baseOwn] = await Promise.all([remotesOf(cwd), remoteOf(`refs/heads/${branch}`), base ? remoteOf(`refs/heads/${base}`) : Promise.resolve('')])
  if (own && own !== '.' && remotes.includes(own)) return own
  if (remotes.includes('origin')) return 'origin'
  if (baseOwn && baseOwn !== '.' && remotes.includes(baseOwn)) return baseOwn
  return remotes.length === 1 ? remotes[0]! : null
}

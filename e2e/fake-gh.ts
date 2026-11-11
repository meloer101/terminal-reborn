// A fake `gh` for e2e (PRD F16): a shell script put next to the fake claude on the login shell's PATH. It answers
// `auth status`, `pr list --head=<branch>` (from pr-<branch>.json, `/` written as `_`), `pr create` (prints the URL
// and turns after-create-<branch>.json into that branch's list) and `run view` (log-failed.txt), and logs each call.
// PRD F16 v1.63: `api graphql` answers the PR details query from graphql-<number>.json and takes mutations on stdin
// (saved as input-<n>.json); `pr merge` is logged and succeeds. Without graphql-<number>.json the details query gets
// `{"data":null}`, which Wavi reports as a failed poll: every open or draft PR a test shows gets details (setDetails,
// setPlainDetails). PRD F16 v1.78: `api repos/…` answers the base's branch protection (200 / 404) and the check runs
// of a pushed base commit. 合入链路 v2: a `signed-out` file makes `auth status`
// say gh is not logged in; a `fail-pr-list` file makes `pr list` fail as an unreachable GitHub does.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FAKE_GH = `#!/bin/sh
d="$TR_FAKE_GH_DIR"
printf '%s\\n' "---" "$@" >> "$d/calls"
head=""
for a in "$@"; do case "$a" in --head=*) head=$(printf '%s' "\${a#--head=}" | tr '/:' '__');; esac; done
case "$1 $2" in
  "auth status")
    if [ -f "$d/signed-out" ]; then echo "You are not logged into any GitHub hosts. To log in, run: gh auth login" >&2; exit 1; fi
    echo "github.com: Logged in"; exit 0 ;;
  "pr list")
    if [ -f "$d/fail-pr-list" ]; then echo "error connecting to api.github.com" >&2; exit 1; fi
    cat "$d/pr-$head.json" 2>/dev/null || echo '[]'; exit 0 ;;
  "pr create")
    [ -f "$d/after-create-$head.json" ] && cp "$d/after-create-$head.json" "$d/pr-$head.json"
    cat "$d/create-url"; exit 0 ;;
  "run view") cat "$d/log-failed.txt"; exit 0 ;;
  "pr merge") exit 0 ;;
  "api repos/"*)
    # REST (PRD F16 v1.78): the base's branch protection (protection.txt: 200 or 404, default 404) and the checks of a
    # pushed base commit (check-runs.json, commit-status.json).
    case "$2" in
      */protection)
        if [ "$(cat "$d/protection.txt" 2>/dev/null)" = 200 ]; then echo '{}'; exit 0; fi
        echo "gh: Branch not protected (HTTP 404)" >&2; exit 1 ;;
      */check-runs*) cat "$d/check-runs.json" 2>/dev/null || echo '{"check_runs":[]}'; exit 0 ;;
      */status*) cat "$d/commit-status.json" 2>/dev/null || echo '{"statuses":[]}'; exit 0 ;;
    esac ;;
  "api graphql")
    case "$*" in
      *"--input -"*)
        n=$(ls "$d" | grep -c '^input-')
        cat > "$d/input-$n.json"
        echo '{"data":{}}'; exit 0 ;;
    esac
    number=""
    for a in "$@"; do case "$a" in number=*) number="\${a#number=}";; esac; done
    cat "$d/graphql-$number.json" 2>/dev/null || echo '{"data":null}'; exit 0 ;;
esac
echo "unknown command $*" >&2
exit 1
`

export interface FakePr {
  number: number
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  isDraft?: boolean
  title?: string
  checks?: { name: string; status: string; conclusion: string | null; job?: number }[]
}

export function prList(prs: FakePr[]): string {
  return JSON.stringify(
    prs.map((pr) => ({
      number: pr.number,
      state: pr.state,
      isDraft: pr.isDraft ?? false,
      url: `https://github.com/acme/widget/pull/${pr.number}`,
      title: pr.title ?? `PR ${pr.number}`,
      isCrossRepository: false,
      headRepositoryOwner: { login: 'acme' },
      statusCheckRollup: (pr.checks ?? []).map((c) => ({
        __typename: 'CheckRun',
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
        detailsUrl: `https://github.com/acme/widget/actions/runs/500/job/${c.job ?? 1}`
      }))
    }))
  )
}

/** Installs the fake into `bin`; `env` goes to launchApp. */
export function fakeGh(bin: string, dir: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(bin, 'gh'), FAKE_GH)
  chmodSync(join(bin, 'gh'), 0o755)
  const file = (branch: string) => branch.replace(/[/:]/g, '_')
  return {
    // launchApp turns gh off by default; this test wants it.
    env: { TR_GH: undefined, TR_FAKE_GH_DIR: dir },
    setPrs: (branch: string, prs: FakePr[]) => writeFileSync(join(dir, `pr-${file(branch)}.json`), prList(prs)),
    afterCreate: (branch: string, prs: FakePr[], url: string) => {
      writeFileSync(join(dir, `after-create-${file(branch)}.json`), prList(prs))
      writeFileSync(join(dir, 'create-url'), `${url}\n`)
    },
    /** Whether the base branch is protected on GitHub: 200 (yes) or 404 (no, the default). */
    setProtection: (code: 200 | 404) => writeFileSync(join(dir, 'protection.txt'), String(code)),
    /** The check runs GitHub reports for any commit (the base CI row). */
    setCheckRuns: (runs: { name: string; status: string; conclusion: string | null; job?: number }[]) =>
      writeFileSync(
        join(dir, 'check-runs.json'),
        JSON.stringify({
          check_runs: runs.map((r) => ({
            name: r.name,
            status: r.status.toLowerCase(),
            conclusion: r.conclusion ? r.conclusion.toLowerCase() : null,
            details_url: `https://github.com/acme/widget/actions/runs/600/job/${r.job ?? 1}`
          }))
        })
      ),
    setFailedLog: (text: string) => writeFileSync(join(dir, 'log-failed.txt'), text),
    /** gh says it is not logged in (true) or logged in (false, the default). */
    setSignedOut: (on: boolean) => (on ? writeFileSync(join(dir, 'signed-out'), '') : rmSync(join(dir, 'signed-out'), { force: true })),
    /** `gh pr list` fails as when GitHub cannot be reached (true), or answers (false, the default). */
    setPrListFails: (on: boolean) => (on ? writeFileSync(join(dir, 'fail-pr-list'), '') : rmSync(join(dir, 'fail-pr-list'), { force: true })),
    /** What PR_DETAILS_QUERY returns for PR `number` (the `data` object). */
    setDetails: (number: number, data: unknown) => writeFileSync(join(dir, `graphql-${number}.json`), JSON.stringify({ data })),
    /**
     * The details GitHub gives a PR with nothing in its way: no threads, comments or reviews, no required checks, no
     * review decision. `headOid` is the PR's head as GitHub has it (the branch's pushed commit); a draft's merge state
     * is DRAFT, an open one's CLEAN. Every open or draft PR a test shows needs these: a real gh never answers a healthy
     * PR without them.
     */
    setPlainDetails: (number: number, headOid: string, options: { draft?: boolean } = {}) =>
      writeFileSync(
        join(dir, `graphql-${number}.json`),
        JSON.stringify({
          data: {
            viewer: { login: 'jacob' },
            repository: {
              autoMergeAllowed: true,
              deleteBranchOnMerge: false,
              squashMergeAllowed: true,
              mergeCommitAllowed: true,
              rebaseMergeAllowed: false,
              viewerDefaultMergeMethod: 'SQUASH',
              pullRequest: {
                id: `PR_${number}`,
                headRefOid: headOid,
                reviewDecision: null,
                mergeStateStatus: options.draft ? 'DRAFT' : 'CLEAN',
                isInMergeQueue: false,
                autoMergeRequest: null,
                commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [] } } } }] },
                reviewThreads: { nodes: [] },
                comments: { nodes: [] },
                reviews: { nodes: [] }
              }
            }
          }
        })
      ),
    /** The GraphQL mutations sent on stdin so far. */
    mutations: (): { query: string; variables: Record<string, unknown> }[] => {
      const out: { query: string; variables: Record<string, unknown> }[] = []
      for (let n = 0; existsSync(join(dir, `input-${n}.json`)); n++) out.push(JSON.parse(readFileSync(join(dir, `input-${n}.json`), 'utf8')))
      return out
    },
    /** Every call so far, as argument lists. */
    calls: (): string[][] =>
      existsSync(join(dir, 'calls'))
        ? readFileSync(join(dir, 'calls'), 'utf8')
            .split('---\n')
            .filter(Boolean)
            .map((call) => call.replace(/\n$/, '').split('\n'))
        : []
  }
}

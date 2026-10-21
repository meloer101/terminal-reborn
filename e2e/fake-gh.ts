// A fake `gh` for e2e (PRD F16): a shell script put next to the fake claude on the login shell's PATH. It answers
// `auth status`, `pr list --head=<branch>` (from pr-<branch>.json, `/` written as `_`), `pr create` (prints the URL
// and turns after-create-<branch>.json into that branch's list) and `run view` (log-failed.txt), and logs each call.
// PRD F16 v1.63: `api graphql` answers the PR details query from graphql-<number>.json and takes mutations on stdin
// (saved as input-<n>.json); `pr merge` is logged and succeeds.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const FAKE_GH = `#!/bin/sh
d="$TR_FAKE_GH_DIR"
printf '%s\\n' "---" "$@" >> "$d/calls"
head=""
for a in "$@"; do case "$a" in --head=*) head=$(printf '%s' "\${a#--head=}" | tr '/:' '__');; esac; done
case "$1 $2" in
  "auth status") echo "github.com: Logged in"; exit 0 ;;
  "pr list") cat "$d/pr-$head.json" 2>/dev/null || echo '[]'; exit 0 ;;
  "pr create")
    [ -f "$d/after-create-$head.json" ] && cp "$d/after-create-$head.json" "$d/pr-$head.json"
    cat "$d/create-url"; exit 0 ;;
  "run view") cat "$d/log-failed.txt"; exit 0 ;;
  "pr merge") exit 0 ;;
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
    setFailedLog: (text: string) => writeFileSync(join(dir, 'log-failed.txt'), text),
    /** What PR_DETAILS_QUERY returns for PR `number` (the `data` object). */
    setDetails: (number: number, data: unknown) => writeFileSync(join(dir, `graphql-${number}.json`), JSON.stringify({ data })),
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

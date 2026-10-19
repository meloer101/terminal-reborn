// A fake `claude` for e2e: a shell script put first on the login shell's PATH through a throwaway ZDOTDIR, so no
// model, no hooks and no real CLI is involved. It draws a minimal UI and logs every byte it reads to $TR_FAKE_LOG.
// Run as `claude -p` (Wavi's background review, PRD F13) it saves the prompt from stdin and prints the reply that
// `reviewReply()` set.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Reads byte by byte (-icanon) so the log shows what sits in the input line before Enter, which it logs as <ENTER>.
// Control characters are echoed raw (-echoctl), so the paste markers the send protocol writes are swallowed by the
// terminal as escape sequences instead of showing up as ^[[200~, as in the real TUI.
const FAKE_CLAUDE = `#!/bin/sh
if [ "$1" = "-p" ]; then
  cat > "$TR_FAKE_LOG.review-in"
  printf '%s\n' "$@" > "$TR_FAKE_LOG.review-argv"
  cat "$TR_FAKE_LOG.review-out" 2>/dev/null
  exit 0
fi
stty -echoctl -icanon min 1 2>/dev/null
printf 'Claude Code v9.9.9\\n\\n❯ Try "how does it work?"\\n\\n  ⏸ manual mode on\\n'
nl=$(printf '\\n.'); nl=\${nl%.}
while c=$(dd bs=1 count=1 2>/dev/null; echo .); do
  c=\${c%.}
  [ -z "$c" ] && exit 0
  if [ "$c" = "$nl" ]; then printf '<ENTER>\\n' >> "$TR_FAKE_LOG"; else printf '%s' "$c" >> "$TR_FAKE_LOG"; fi
done
`

export function outerClaudeEnv(): Record<string, undefined> {
  const strip: Record<string, undefined> = {}
  for (const key of Object.keys(process.env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_') || key.startsWith('CLAUDE_AGENT_')) strip[key] = undefined
  }
  return strip
}

/** Installs the fake under a new temp folder; `env` goes to launchApp, `logged()` / `typed()` read what it got. */
export function fakeClaude(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix))
  const bin = join(root, 'bin')
  const zdot = join(root, 'zdot')
  for (const dir of [bin, zdot]) mkdirSync(dir)
  writeFileSync(join(bin, 'claude'), FAKE_CLAUDE)
  chmodSync(join(bin, 'claude'), 0o755)
  writeFileSync(join(zdot, '.zshrc'), `export PATH="${bin}:$PATH"\n`)
  const log = join(root, 'claude.log')
  writeFileSync(log, '')
  const logged = () => readFileSync(log, 'utf8')
  return {
    root,
    /** What the next `claude -p` prints (Claude's --output-format json result). */
    reviewReply: (structured: unknown) =>
      writeFileSync(`${log}.review-out`, JSON.stringify({ type: 'result', is_error: false, total_cost_usd: 0.012, duration_ms: 900, structured_output: structured })),
    /** The prompt the last `claude -p` read from stdin ('' before any). */
    reviewPrompt: () => {
      try {
        return readFileSync(`${log}.review-in`, 'utf8')
      } catch {
        return ''
      }
    },
    env: { ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', TR_FAKE_LOG: log },
    logged,
    /** The log without the bracketed-paste end marker the send protocol wraps text in. */
    typed: () => logged().split(`${String.fromCharCode(27)}[201~`).join('')
  }
}

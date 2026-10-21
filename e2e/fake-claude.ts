// A fake `claude` for e2e: a shell script put first on the login shell's PATH through a throwaway ZDOTDIR, so no
// model, no hooks and no real CLI is involved. It draws a minimal UI and logs every byte it reads to $TR_FAKE_LOG.
// Run as `claude -p` (Wavi's background review, PRD F13) it saves the prompt from stdin and prints the reply that
// `reviewReply()` set. With TR_FAKE_PRINT=1 (`fakeClaude(prefix, { printable: true })`) the fake also prints what
// `print(dir, text)` writes for the folder it runs in — a menu over its input line, as Claude's /rate-limit-options is.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

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
printf '%s\n' "$*" >> "$TR_FAKE_LOG.argv"
stty -echoctl -icanon min 1 2>/dev/null
if [ -n "$TR_FAKE_PRINT" ]; then
  # Ends within a tick of this shell ending.
  parent=$$
  here="$TR_FAKE_LOG.print.$(basename "$PWD")"
  ( while kill -0 $parent 2>/dev/null; do
      if [ -f "$here" ]; then cat "$here"; rm -f "$here"; fi
      sleep 0.1
    done ) &
fi
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
export function fakeClaude(prefix: string, { printable = false }: { printable?: boolean } = {}) {
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
    /** One line per interactive launch: its arguments (e.g. `--resume <id>`). */
    launches: () => {
      try {
        return readFileSync(`${log}.argv`, 'utf8').split('\n').filter(Boolean)
      } catch {
        return []
      }
    },
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
    /** Prints `text` on the screen of the fake running in `dir` (needs `printable`). */
    print: (dir: string, text: string) => writeFileSync(`${log}.print.${basename(dir)}`, text),
    env: { ...outerClaudeEnv(), ZDOTDIR: zdot, SHELL: '/bin/zsh', TR_FAKE_LOG: log, ...(printable ? { TR_FAKE_PRINT: '1' } : {}) },
    logged,
    /** The log without the bracketed-paste end marker the send protocol wraps text in. */
    typed: () => logged().split(`${String.fromCharCode(27)}[201~`).join('')
  }
}

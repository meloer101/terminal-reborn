// Agents started by hand in a Wavi terminal (PRD F11): `claude` / `codex` typed at a plain terminal's prompt get the
// same per-launch hooks and statusLine as the agents Wavi starts itself, without writing the user's global config.
// - A shim directory (`<userData>/agent-shims`) holds `claude` and `codex`, which run resources/hooks/agent-shim.sh;
//   it goes first on the terminal's PATH. The shim finds the real CLI after it and adds `--settings` / `-c`.
// - zsh: rc files often put their own directories first on PATH, so we also hand zsh a ZDOTDIR of ours (as Ghostty
//   and VS Code do): its .zshenv puts the user's ZDOTDIR back, loads their .zshenv, and puts the shims first once
//   more right before the first prompt, after every rc file ran. fish: the same through XDG_DATA_DIRS vendor_conf.d.
//   bash and other shells: PATH at launch only.
// Electron-free: the glue passes the directories.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { shellQuote } from '@shared/agent-launch'

export const SHIM_AGENTS = ['claude', 'codex'] as const

/** The executable shim for one agent: hands over to the shared script. */
export function shimFile(agent: (typeof SHIM_AGENTS)[number], scriptPath: string): string {
  return `#!/bin/sh\n# Wavi agent shim, rewritten at every app start (src/main/hooks/shell-agents.ts).\nexec /bin/sh ${shellQuote(scriptPath)} ${agent} "$@"\n`
}

/**
 * zsh reads `$ZDOTDIR/.zshenv` first. Ours restores the user's ZDOTDIR (so .zprofile / .zshrc / .zlogin are theirs),
 * sources their .zshenv, and in an interactive shell moves the shim directory to the front of PATH just before the
 * first prompt.
 */
export const ZSH_ENV = `# Wavi shell integration (src/main/hooks/shell-agents.ts). Puts the user's ZDOTDIR back, then their own .zshenv.
if [[ -n \${WAVI_USER_ZDOTDIR-} ]]; then
  ZDOTDIR=$WAVI_USER_ZDOTDIR
else
  unset ZDOTDIR
fi
unset WAVI_USER_ZDOTDIR
[[ -f \${ZDOTDIR:-$HOME}/.zshenv ]] && builtin source \${ZDOTDIR:-$HOME}/.zshenv
if [[ -o interactive && -n \${WAVI_SHIM_DIR-} ]]; then
  __wavi_shims_first() {
    path=("$WAVI_SHIM_DIR" \${path:#\${(b)WAVI_SHIM_DIR}})
    builtin rehash
    add-zsh-hook -d precmd __wavi_shims_first
    builtin unfunction __wavi_shims_first
  }
  builtin autoload -Uz add-zsh-hook
  add-zsh-hook precmd __wavi_shims_first
fi
`

/** fish loads `<XDG_DATA_DIRS entry>/fish/vendor_conf.d/*.fish` before config.fish; the shims go first at the first prompt. */
export const FISH_CONF = `# Wavi shell integration (src/main/hooks/shell-agents.ts).
if status is-interactive; and set -q WAVI_SHIM_DIR
  function __wavi_shims_first --on-event fish_prompt
    set -l rest (string match -v -- $WAVI_SHIM_DIR $PATH)
    set -gx PATH $WAVI_SHIM_DIR $rest
    functions -e __wavi_shims_first
  end
end
`

export interface ShimDirs {
  /** `claude` / `codex` shims. */
  bin: string
  /** ZDOTDIR handed to zsh. */
  zsh: string
  /** Prepended to XDG_DATA_DIRS for fish. */
  fishData: string
  /** Codex `-c` overrides, one per line (read by agent-shim.sh). */
  codexConfig: string
}

export function shimDirs(root: string): ShimDirs {
  return { bin: join(root, 'bin'), zsh: join(root, 'zsh'), fishData: join(root, 'fish-data'), codexConfig: join(root, 'codex-config') }
}

/** Writes the shims and integration files (again at every start: the app, and so the script path, may have moved). */
export function writeShims(root: string, scriptPath: string): ShimDirs {
  const dirs = shimDirs(root)
  mkdirSync(dirs.bin, { recursive: true, mode: 0o700 })
  mkdirSync(dirs.zsh, { recursive: true, mode: 0o700 })
  mkdirSync(join(dirs.fishData, 'fish', 'vendor_conf.d'), { recursive: true, mode: 0o700 })
  for (const agent of SHIM_AGENTS) {
    const file = join(dirs.bin, agent)
    writeFileSync(file, shimFile(agent, scriptPath), { mode: 0o755 })
    chmodSync(file, 0o755)
  }
  writeFileSync(join(dirs.zsh, '.zshenv'), ZSH_ENV, { mode: 0o644 })
  writeFileSync(join(dirs.fishData, 'fish', 'vendor_conf.d', 'wavi.fish'), FISH_CONF, { mode: 0o644 })
  return dirs
}

/** Codex overrides for the shim, one `key=value` per line. */
export function writeCodexOverrides(dirs: ShimDirs, overrides: readonly string[]): void {
  writeFileSync(dirs.codexConfig, overrides.filter((o) => !o.includes('\n')).join('\n') + '\n', { mode: 0o600 })
}

/**
 * The environment a plain terminal gets so a hand-started agent can be wrapped: the shim directory first on PATH,
 * and for zsh / fish the integration that keeps it first after the user's rc files. `base` is the environment the
 * shell would otherwise start with.
 */
export function shellIntegrationEnv(shell: string, base: Readonly<Record<string, string | undefined>>, dirs: ShimDirs): Record<string, string> {
  const rest = (base.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin').split(':').filter((d) => d !== '' && d !== dirs.bin)
  const env: Record<string, string> = { WAVI_SHIM_DIR: dirs.bin, PATH: [dirs.bin, ...rest].join(':') }
  const name = basename(shell)
  if (name === 'zsh') {
    env.ZDOTDIR = dirs.zsh
    if (base.ZDOTDIR) env.WAVI_USER_ZDOTDIR = base.ZDOTDIR
  } else if (name === 'fish') {
    env.XDG_DATA_DIRS = [dirs.fishData, base.XDG_DATA_DIRS || '/usr/local/share:/usr/share'].join(':')
  }
  return env
}

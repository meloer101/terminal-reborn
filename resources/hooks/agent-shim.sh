#!/bin/sh
# Wavi agent shim (PRD F11 · agents started by hand in a Wavi terminal).
#   usage: agent-shim.sh <claude|codex> [args...]
# The `claude` / `codex` files in $WAVI_SHIM_DIR, which comes first on a Wavi terminal's PATH, run this. It starts
# the real CLI found after the shim directory on PATH. For an interactive run it adds Wavi's per-launch settings
# (Claude: `--settings <file>` with our hooks and statusLine; Codex: the `-c` hook overrides) and tells Wavi when
# the agent ended. It writes nothing anywhere. Outside a Wavi terminal, for management or one-shot commands, for a
# launch that already passes its own `--settings`, and for an agent started from inside an agent it runs the CLI
# unchanged.
agent="${1:-}"
[ $# -gt 0 ] && shift

# The real CLI: the first one on PATH after the shim directory. Nothing it starts sees the shims.
set -f
old_ifs=$IFS
IFS=:
clean_path=
for dir in $PATH; do
  [ -z "$dir" ] && continue
  [ -n "${WAVI_SHIM_DIR-}" ] && [ "$dir" = "$WAVI_SHIM_DIR" ] && continue
  clean_path="${clean_path:+$clean_path:}$dir"
done
IFS=$old_ifs
set +f
PATH=$clean_path
export PATH
real=$(command -v "$agent" 2>/dev/null)
case "$real" in
  /*) ;;
  *)
    printf '%s: command not found\n' "$agent" >&2
    exit 127
    ;;
esac

# Started from an agent's own tools, or not in a Wavi terminal with a live hook socket: plain run.
if [ -n "${WAVI_AGENT_WRAPPED-}" ] || [ -z "${TR_SESSION_ID-}" ] || [ -z "${TR_HOOK_SOCK-}" ] || [ ! -S "$TR_HOOK_SOCK" ]; then
  exec "$real" "$@"
fi

# Whether this is an interactive session worth reporting: no management subcommand, no one-shot or info flag.
interactive=1
positional=
for arg in "$@"; do
  case "$agent:$arg" in
    claude:--settings | claude:--settings=* | *:-p | *:--print | *:-h | *:--help | *:-v | *:-V | *:--version)
      interactive=0
      break
      ;;
    *:-*) ;;
    *)
      positional=$arg
      break
      ;;
  esac
done
if [ "$interactive" = 1 ] && [ -n "$positional" ]; then
  case "$agent:$positional" in
    claude:agents | claude:attach | claude:auth | claude:auto-mode | claude:config | claude:doctor | claude:gateway | \
      claude:import | claude:install | claude:logs | claude:mcp | claude:migrate-installer | claude:plugin | \
      claude:plugins | claude:project | claude:purge | claude:respawn | claude:rm | claude:setup-token | claude:stop | \
      claude:kill | claude:ultrareview | claude:update | claude:upgrade | \
      codex:exec | codex:e | codex:review | codex:login | codex:logout | codex:mcp | codex:plugin | codex:mcp-server | \
      codex:app-server | codex:remote-control | codex:app | codex:completion | codex:update | codex:doctor | \
      codex:sandbox | codex:debug | codex:apply | codex:a | codex:archive | codex:delete | codex:unarchive | \
      codex:cloud | codex:exec-server | codex:features | codex:help)
      interactive=0
      ;;
  esac
fi
[ "$interactive" = 1 ] || exec "$real" "$@"

quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

case "$agent" in
  claude)
    [ -n "${TR_CLAUDE_SETTINGS-}" ] && [ -f "$TR_CLAUDE_SETTINGS" ] || exec "$real" "$@"
    set -- --settings "$TR_CLAUDE_SETTINGS" "$@"
    ;;
  codex)
    [ -n "${TR_CODEX_CONFIG-}" ] && [ -f "$TR_CODEX_CONFIG" ] || exec "$real" "$@"
    prefix=
    while IFS= read -r line || [ -n "$line" ]; do
      [ -n "$line" ] && prefix="$prefix -c $(quote "$line")"
    done <"$TR_CODEX_CONFIG"
    eval "set -- $prefix \"\$@\""
    ;;
  *)
    exec "$real" "$@"
    ;;
esac

# The agent runs as a child so its end can be reported (Codex sends no SessionEnd). Ctrl+C reaches the agent in its
# own raw-mode input anyway; a signal sent to the group must not take the shim down before it.
trap ':' INT QUIT
WAVI_AGENT_WRAPPED=1 "$real" "$@"
code=$?
trap - INT QUIT
if [ -n "${TR_HOOK_SCRIPT-}" ] && [ -f "$TR_HOOK_SCRIPT" ]; then
  printf '{}' | /bin/sh "$TR_HOOK_SCRIPT" AgentExit "$agent" >/dev/null 2>&1
fi
exit "$code"

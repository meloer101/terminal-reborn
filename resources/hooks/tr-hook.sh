#!/bin/sh
# Wavi agent hook relay (PRD §6.6).
#   usage: tr-hook.sh <EventName> [agent]
# Pipes the hook payload from stdin to the app over a Unix socket and prints the reply body,
# which is how a PermissionRequest decision reaches Claude Code. Needs only sh and curl (both
# ship with macOS), not the user's node. If the app is unreachable it exits 0 with no output,
# so an agent is never blocked or slowed by our absence.
event="${1:-}"
agent="${2:-claude}"

[ -n "$event" ] || exit 0
[ -n "${TR_SESSION_ID-}" ] && [ -n "${TR_HOOK_SOCK-}" ] && [ -n "${TR_HOOK_TOKEN-}" ] || exit 0
[ -S "$TR_HOOK_SOCK" ] || exit 0

# Only PermissionRequest may block (until the user answers in the app; the app caps it at 120 s).
case "$event" in
  PermissionRequest) max_time=130 ;;
  *) max_time=5 ;;
esac

# Is this Claude on its account's plan (PRD F11)? Not when it talks to a third-party endpoint (CC Switch writes
# ANTHROPIC_BASE_URL into ~/.claude/settings.json, and Claude passes its settings' env on to hooks) or a cloud
# provider. Sent before SessionStart, so the app never takes this session for one that uses the account.
if [ "$event" = SessionStart ] && [ "$agent" = claude ]; then
  plan=true
  case "${ANTHROPIC_BASE_URL-}" in
    '' | https://api.anthropic.com | https://api.anthropic.com/*) ;;
    *) plan=false ;;
  esac
  for flag in "${CLAUDE_CODE_USE_BEDROCK-}" "${CLAUDE_CODE_USE_VERTEX-}" "${CLAUDE_CODE_USE_FOUNDRY-}"; do
    case "$flag" in '' | 0 | false) ;; *) plan=false ;; esac
  done
  printf '{"plan":%s}' "$plan" | curl --silent --fail --connect-timeout 1 --max-time 5 \
    --unix-socket "$TR_HOOK_SOCK" \
    -H "X-TR-Token: $TR_HOOK_TOKEN" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    "http://tr/hook/AgentBilling?session=$TR_SESSION_ID&agent=claude" >/dev/null 2>&1
fi

curl --silent --fail --connect-timeout 1 --max-time "$max_time" \
  --unix-socket "$TR_HOOK_SOCK" \
  -H "X-TR-Token: $TR_HOOK_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @- \
  "http://tr/hook/$event?session=$TR_SESSION_ID&agent=$agent" 2>/dev/null
exit 0

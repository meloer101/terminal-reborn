#!/bin/sh
# Wavi statusLine relay (PRD F11, §6.6).
#   usage: tr-statusline.sh
# Claude Code runs this as the session's statusLine and pipes it the statusLine JSON on stdin.
# 1. Forwards that JSON to the app (context %, plan usage) in the background, never delaying the line.
# 2. Runs the user's own statusLine, if they had one ($TR_USER_STATUSLINE, resolved by the app at launch
#    from their settings), with the same stdin, and prints its output unchanged. Ours replaces theirs in
#    Claude's settings merge, so this chaining is what keeps their status line working.
input=$(cat)

if [ -n "${TR_SESSION_ID-}" ] && [ -n "${TR_HOOK_SOCK-}" ] && [ -n "${TR_HOOK_TOKEN-}" ] && [ -S "$TR_HOOK_SOCK" ]; then
  printf '%s' "$input" | curl --silent --fail --connect-timeout 1 --max-time 3 \
    --unix-socket "$TR_HOOK_SOCK" \
    -H "X-TR-Token: $TR_HOOK_TOKEN" \
    -H 'Content-Type: application/json' \
    --data-binary @- \
    "http://tr/hook/StatusLine?session=$TR_SESSION_ID&agent=claude" >/dev/null 2>&1 &
fi

if [ -n "${TR_USER_STATUSLINE-}" ]; then
  printf '%s' "$input" | /bin/sh -c "$TR_USER_STATUSLINE"
  exit $?
fi
exit 0

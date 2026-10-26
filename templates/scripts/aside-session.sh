#!/usr/bin/env bash
# Keeps one `aside repl` session alive so several steps share variables and tabs.
# A single `aside repl "<code>"` call is a fresh session: its tabs close when it ends.
#
#   aside-session.sh start <name>          start a session for the harness test account
#   aside-session.sh send  <name> '<js>'   run one line of JS, print its output (waits up to 130s)
#   aside-session.sh stop  <name>          end the session (its tabs close)
#   aside-session.sh list                  list live sessions of this project
#   aside-session.sh stop-under <dir>      stop every session of projects at <dir> or below (/clean)
#
# Sessions are per project (git root, else the current dir), so two terminals testing
# different projects can both use e2e-2 without colliding.
#   aside-session.sh account               print the configured test account (e.g. u2)
#
# Exit codes: 0 ok · 1 usage/config error · 2 aside unavailable (use the Playwright fallback)
# · 3 the JS step failed or timed out.

set -euo pipefail

ASIDE_BIN="${ASIDE_BIN:-$HOME/.local/bin/aside}"
STATE_PARENT="${TMPDIR:-/tmp}"
STATE_PARENT="${STATE_PARENT%/}/cc-baseline-$(id -u)"
STATE_BASE="$STATE_PARENT/aside"
STEP_TIMEOUT=130

die() { echo "aside-session: $2" >&2; exit "$1"; }

project_dir() {
  local top; top="$(git rev-parse --show-toplevel 2>/dev/null)" || top="."
  (cd "$top" && pwd -P)
}

PROJECT="$(project_dir)"
STATE_ROOT="$STATE_BASE/$(printf '%s' "$PROJECT" | cksum | awk '{print $1}')"

# Each state dir must be a real directory we own with mode 700 — never a symlink
# someone else planted in the shared temp dir.
secure_dir() {
  [ -L "$1" ] && die 1 "refusing symlinked state dir: $1"
  [ -d "$1" ] || mkdir -m 700 "$1"
  [ -O "$1" ] || die 1 "state dir is not owned by $(id -un): $1"
  chmod 700 "$1"
}

secure_tree() {
  secure_dir "$STATE_PARENT"; secure_dir "$STATE_BASE"; secure_dir "$STATE_ROOT"
  printf '%s\n' "$PROJECT" > "$STATE_ROOT/project"
}

valid_name() { [[ "$1" =~ ^[a-z0-9][a-z0-9-]{0,40}$ ]] || die 1 "session name must match ^[a-z0-9][a-z0-9-]{0,40}$"; }

# Test account from the project's .claude/ first, then ~/.claude/. Never falls back to the default profile.
account() {
  local cfg
  for cfg in "$PROJECT/.claude/cc-baseline-browser.json" "$HOME/.claude/cc-baseline-browser.json"; do
    [ -f "$cfg" ] || continue
    local acct
    acct="$(node -e 'try{const a=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).aside.account;if(/^u\d+$/.test(a||""))process.stdout.write(a)}catch{}' "$cfg")"
    if [ -n "$acct" ]; then echo "$acct"; return 0; fi
  done
  return 1
}

dir_of() { echo "$STATE_ROOT/$1"; }

strip_ansi() { sed -e $'s/\x1b\\[[0-9;]*m//g'; }

cmd_start() {
  valid_name "$1"
  [ -x "$ASIDE_BIN" ] || die 2 "aside CLI not found at $ASIDE_BIN"
  local acct; acct="$(account)" || die 2 "no Aside test account configured (cc-baseline --yes --aside-account <id>)"
  local d; d="$(dir_of "$1")"
  [ -e "$d/repl.pid" ] && kill -0 "$(cat "$d/repl.pid")" 2>/dev/null && die 1 "session $1 is already running"
  secure_tree; rm -rf "$d"; mkdir -m 700 "$d"
  mkfifo -m 600 "$d/in"
  : > "$d/out"
  # The holder keeps the FIFO's write end open so the REPL does not see EOF between steps.
  # Background processes get no inherited stdio, so callers are not left waiting on them.
  ( sleep 86400 > "$d/in" 2>/dev/null </dev/null & echo $! > "$d/holder.pid" )
  ( nohup "$ASIDE_BIN" repl --account "$acct" < "$d/in" > "$d/out" 2>&1 & echo $! > "$d/repl.pid" )
  echo "$acct" > "$d/account"
  sleep 1
  if ! kill -0 "$(cat "$d/repl.pid")" 2>/dev/null; then
    cat "$d/out" >&2; cmd_stop "$1" >/dev/null 2>&1 || true
    die 2 "aside repl exited at start"
  fi
  echo "started $1 (account $acct)"
}

cmd_send() {
  valid_name "$1"
  local d; d="$(dir_of "$1")"
  [ -p "$d/in" ] && kill -0 "$(cat "$d/repl.pid" 2>/dev/null)" 2>/dev/null || die 2 "session $1 is not running"
  local code="$2"
  [[ "$code" == *$'\n'* ]] && die 1 "send one line of JS (join statements with ;)"
  local before; before="$(wc -c < "$d/out")"
  printf '%s\n' "$code" > "$d/in"
  local waited=0 chunk
  while :; do
    chunk="$(tail -c +"$((before + 1))" "$d/out" | strip_ansi)"
    if grep -q '\[ok |' <<<"$chunk"; then printf '%s\n' "$chunk" | grep -v '^repl > *$'; return 0; fi
    if grep -q '\[error |' <<<"$chunk"; then printf '%s\n' "$chunk" | grep -v '^repl > *$'; return 3; fi
    kill -0 "$(cat "$d/repl.pid")" 2>/dev/null || { printf '%s\n' "$chunk"; die 2 "aside repl exited"; }
    [ "$waited" -ge "$STEP_TIMEOUT" ] && { printf '%s\n' "$chunk"; die 3 "step timed out after ${STEP_TIMEOUT}s"; }
    sleep 1; waited=$((waited + 1))
  done
}

cmd_stop() {
  valid_name "$1"
  stop_dir "$(dir_of "$1")"
}

stop_dir() {
  local d="$1"
  [ -d "$d" ] || { echo "no session $(basename "$d")"; return 0; }
  # Opening a FIFO for writing blocks while nothing reads it (the REPL may already be gone),
  # so write in the background and give up after a second.
  if [ -p "$d/in" ]; then
    ( printf 'exit\n' > "$d/in" ) 2>/dev/null &
    local writer=$!
    sleep 1
    { kill "$writer" && wait "$writer"; } 2>/dev/null || true
  fi
  for f in repl.pid holder.pid; do
    [ -f "$d/$f" ] && kill "$(cat "$d/$f")" 2>/dev/null || true
  done
  rm -rf "$d"
  echo "stopped $(basename "$d")"
}

cmd_list() {
  [ -d "$STATE_ROOT" ] || return 0
  local d
  for d in "$STATE_ROOT"/*/; do
    [ -f "$d/repl.pid" ] || continue
    if kill -0 "$(cat "$d/repl.pid")" 2>/dev/null; then echo "$(basename "$d") running (account $(cat "$d/account"))"; fi
  done
}

cmd_stop_under() {
  local root; root="$(cd "$1" 2>/dev/null && pwd -P)" || die 1 "no such directory: $1"
  [ "$root" = "/" ] || [ "$root" = "$HOME" ] && die 1 "refusing to stop sessions under $root"
  [ -d "$STATE_BASE" ] || return 0
  local p proj d
  for p in "$STATE_BASE"/*/; do
    [ -f "$p/project" ] || continue
    proj="$(cat "$p/project")"
    case "$proj/" in
      "$root"/*) for d in "$p"*/; do [ -d "$d" ] && stop_dir "${d%/}"; done ;;
    esac
  done
}

case "${1:-}" in
  start) [ $# -eq 2 ] || die 1 "usage: start <name>"; cmd_start "$2" ;;
  send)  [ $# -eq 3 ] || die 1 "usage: send <name> '<js>'"; cmd_send "$2" "$3" ;;
  stop)  [ $# -eq 2 ] || die 1 "usage: stop <name>"; cmd_stop "$2" ;;
  list)  cmd_list ;;
  stop-under) [ $# -eq 2 ] || die 1 "usage: stop-under <dir>"; cmd_stop_under "$2" ;;
  account) account || die 2 "no Aside test account configured" ;;
  *) die 1 "usage: aside-session.sh start|send|stop|stop-under|list|account" ;;
esac

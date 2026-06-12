#!/usr/bin/env bash
set -euo pipefail

interval="${TMUXFLEET_UPDATE_INTERVAL:-60}"

usage() {
  cat <<'EOF'
Usage: scripts/run-with-autoupdate.sh [--interval seconds] -- command [args...]

Runs a Hub or Node command, checks the current Git upstream periodically, and
restarts the command after a clean fast-forward update.

Examples:
  scripts/run-with-autoupdate.sh -- node src/cli.js hub --host 0.0.0.0 --port 8090
  scripts/run-with-autoupdate.sh -- node src/cli.js node --connect http://hub:8090 --name devbox
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval)
      interval="${2:-}"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 2
fi

if ! [[ "$interval" =~ ^[0-9]+$ ]] || [[ "$interval" -lt 5 ]]; then
  echo "tmuxfleet autoupdate: interval must be an integer >= 5 seconds" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

child_pid=""
stop_requested=0

log() {
  printf '[%s] tmuxfleet autoupdate: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2
}

start_child() {
  log "starting: $*"
  "$@" &
  child_pid="$!"
}

stop_child() {
  if [[ -n "$child_pid" ]] && kill -0 "$child_pid" 2>/dev/null; then
    log "stopping child pid $child_pid"
    kill "$child_pid" 2>/dev/null || true
    for _ in {1..20}; do
      if ! kill -0 "$child_pid" 2>/dev/null; then
        wait "$child_pid" 2>/dev/null || true
        child_pid=""
        return
      fi
      sleep 0.25
    done
    log "child did not stop after SIGTERM; sending SIGKILL"
    kill -9 "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
    child_pid=""
  fi
}

shutdown() {
  stop_requested=1
  stop_child
}

trap shutdown INT TERM

upstream_ref() {
  git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true
}

worktree_clean() {
  [[ -z "$(git status --porcelain)" ]]
}

check_update() {
  local upstream ahead behind
  upstream="$(upstream_ref)"
  if [[ -z "$upstream" ]]; then
    log "no upstream configured for current branch; skipping update check"
    return 1
  fi

  if ! git fetch --quiet; then
    log "git fetch failed; keeping current process"
    return 1
  fi

  read -r ahead behind < <(git rev-list --left-right --count "HEAD...$upstream")
  if [[ "$behind" -eq 0 ]]; then
    return 1
  fi
  if [[ "$ahead" -ne 0 ]]; then
    log "local branch diverged from $upstream; skipping auto-update"
    return 1
  fi
  if ! worktree_clean; then
    log "working tree is dirty; skipping auto-update"
    return 1
  fi

  log "updating from $upstream ($behind commits behind)"
  git pull --ff-only --quiet
  return 0
}

start_child "$@"

while [[ "$stop_requested" -eq 0 ]]; do
  sleep "$interval" &
  wait "$!" || true
  [[ "$stop_requested" -ne 0 ]] && break

  if [[ -n "$child_pid" ]] && ! kill -0 "$child_pid" 2>/dev/null; then
    wait "$child_pid" 2>/dev/null || true
    log "child exited; restarting"
    start_child "$@"
    continue
  fi

  if check_update; then
    stop_child
    start_child "$@"
  fi
done

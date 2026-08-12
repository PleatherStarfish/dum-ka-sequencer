#!/bin/bash

# Keep a stable shell process as proj's recorded group leader. The Node launcher
# and everything it starts stay in this shell's process group, so proj can stop
# the complete Tauri/Vite tree without accepting an executable-identity handoff.
set -euo pipefail

if [[ $# -ne 1 || "$1" != /* || ! -x "$1" ]]; then
  echo "proj-tauri-dev: expected one absolute, executable Node adapter path" >&2
  exit 2
fi

node_adapter="$1"
child_pid=""

terminate_child() {
  trap - TERM INT
  if [[ -n "$child_pid" ]]; then
    kill -TERM "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  exit 143
}

interrupt_child() {
  trap - TERM INT
  if [[ -n "$child_pid" ]]; then
    kill -INT "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  exit 130
}

trap terminate_child TERM
trap interrupt_child INT

"$node_adapter" node scripts/proj-tauri-dev.mjs &
child_pid=$!

set +e
wait "$child_pid"
status=$?
set -e
trap - TERM INT
exit "$status"

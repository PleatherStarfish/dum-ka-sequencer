#!/usr/bin/env bash
# Mutation-testing pilot (docs/TEST_COVERAGE_PLAN_2026-07.md Phase 4.5).
#
# Line coverage says a line RAN under test; mutation testing asks whether any
# test NOTICES when its behavior changes — the assertion-strength signal the
# coverage ratchet can't give. This pilot is scoped to the two highest-risk
# retained seams (the Example generator + the transport layer-lifecycle module)
# so a run stays minutes, not hours; widen the scope as the lane proves useful.
#
# REPORT-ONLY: always exits 0 unless the harness itself breaks. Missed
# mutants are a to-review list, not a failure. Results land in mutants.out/
# (outcomes.json, missed.txt, caught.txt).
#
#   scripts/mutants.sh            # run the pilot scope
#   MUTANTS_LIST=1 scripts/mutants.sh   # list the in-scope mutants, run nothing

set -uo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

HARNESS_FAILED=0

if ! cargo mutants --version >/dev/null 2>&1; then
  echo "cargo-mutants is not installed. Run: cargo +nightly install cargo-mutants --locked" >&2
  exit 1
fi

# The pilot scope: the concrete Example generator implementation and the whole
# transport layers module (the retained timeline/playback lifecycle table).

run_mutants() {
  local package="$1"
  local out_dir="$2"
  shift 2
  local list_flag=() status=0 outcomes
  if [[ "${MUTANTS_LIST:-0}" != "0" ]]; then
    list_flag=(--list)
  fi
  # `--timeout` guards runaway mutants (an infinite-loop mutation otherwise
  # hangs the run); the baseline test time here is a few seconds, so 120s is
  # generous. `--no-shuffle` keeps output ordering stable across runs.
  # cargo-mutants writes results to `<--output>/mutants.out/` and requires the
  # directory to exist.
  mkdir -p "${out_dir}"
  cargo mutants \
    --package "${package}" \
    --no-shuffle \
    --timeout 120 \
    --output "${out_dir}" \
    ${list_flag[@]+"${list_flag[@]}"} \
    "$@" || status=$?

  if [[ "${MUTANTS_LIST:-0}" != "0" ]]; then
    if (( status != 0 )); then
      echo "cargo-mutants list failed for ${package} (exit ${status})" >&2
      HARNESS_FAILED=1
    fi
    return
  fi

  case "${status}" in
    0)
      ;;
    2|3)
      echo "cargo-mutants for ${package} reported missed/timed-out mutants (report-only)"
      ;;
    *)
      echo "cargo-mutants harness failed for ${package} (exit ${status})" >&2
      HARNESS_FAILED=1
      ;;
  esac

  outcomes="${out_dir}/mutants.out/outcomes.json"
  if [[ ! -f "${outcomes}" ]]; then
    echo "cargo-mutants for ${package} produced no outcomes.json" >&2
    HARNESS_FAILED=1
    return
  fi

  if ! python3 - "${outcomes}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    outcomes = json.load(handle)

if not isinstance(outcomes.get("outcomes"), list):
    raise SystemExit("outcomes.json has no outcomes array")
if not isinstance(outcomes.get("total_mutants"), int) or outcomes["total_mutants"] <= 0:
    raise SystemExit("outcomes.json reports no tested mutants")
PY
  then
    echo "cargo-mutants for ${package} produced invalid/empty outcomes" >&2
    HARNESS_FAILED=1
  fi
}

run_mutants cseq-rhythm mutants.out/cseq-rhythm --file "**/generators/example.rs"
run_mutants cseq-transport mutants.out/cseq-transport --file "**/layers.rs"

if [[ "${MUTANTS_LIST:-0}" != "0" ]]; then
  exit "${HARNESS_FAILED}"
fi

echo
echo "== Mutation pilot summary =="
for dir in mutants.out/cseq-rhythm/mutants.out mutants.out/cseq-transport/mutants.out; do
  if [[ -f "${dir}/outcomes.json" ]]; then
    python3 - "$dir" <<'PY'
import json, sys
d = sys.argv[1].removesuffix("/mutants.out")
o = json.load(open(f"{sys.argv[1]}/outcomes.json"))
total = o.get("total_mutants", len(o.get("outcomes", [])))
caught = o.get("caught", 0)
missed = o.get("missed", 0)
timeout = o.get("timeout", 0)
unviable = o.get("unviable", 0)
print(f"{d}: total {total} · caught {caught} · MISSED {missed} · timeout {timeout} · unviable {unviable}")
PY
  else
    echo "${dir}: no outcomes.json (run failed before results)"
  fi
done
echo "Missed mutants (assertion gaps to review): mutants.out/*/missed.txt"
exit "${HARNESS_FAILED}"

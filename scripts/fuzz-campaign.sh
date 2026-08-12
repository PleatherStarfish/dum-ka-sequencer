#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# shellcheck source=scripts/fuzz-targets.sh
source "${SCRIPT_DIR}/fuzz-targets.sh"
validate_dumka_fuzz_targets
if [[ "${FUZZ_VALIDATE_ONLY:-0}" != "0" ]]; then
  exit 0
fi

if ! cargo +nightly fuzz --version >/dev/null 2>&1; then
  echo "cargo-fuzz is not installed. Run: scripts/fuzz-setup.sh" >&2
  exit 1
fi

FUZZ_SECONDS="${FUZZ_SECONDS:-120}"
FUZZ_TIMEOUT="${FUZZ_TIMEOUT:-10}"
FUZZ_CORPUS_ROOT="${FUZZ_CORPUS_ROOT:-fuzz/corpus-local}"
FUZZ_JSON_DICT="${FUZZ_JSON_DICT:-fuzz/dictionaries/cseq-json.dict}"

run_target() {
  local target="$1"
  local max_len="$2"
  local dict="${3:-}"
  local local_corpus_dir="${FUZZ_CORPUS_ROOT}/${target}"
  local seed_corpus_dir="fuzz/corpus/${target}"
  local extra_args=()

  echo "==> ${target} (${FUZZ_SECONDS}s, max_len=${max_len}, timeout=${FUZZ_TIMEOUT}s)"
  mkdir -p "${local_corpus_dir}"
  if [[ -n "${dict}" && -f "${dict}" ]]; then
    extra_args+=("-dict=${dict}")
  fi
  if [[ ${#extra_args[@]} -gt 0 ]]; then
    cargo +nightly fuzz run "${target}" "${local_corpus_dir}" "${seed_corpus_dir}" -- \
      -max_total_time="${FUZZ_SECONDS}" \
      -max_len="${max_len}" \
      -timeout="${FUZZ_TIMEOUT}" \
      "${extra_args[@]}"
  else
    cargo +nightly fuzz run "${target}" "${local_corpus_dir}" "${seed_corpus_dir}" -- \
      -max_total_time="${FUZZ_SECONDS}" \
      -max_len="${max_len}" \
      -timeout="${FUZZ_TIMEOUT}"
  fi
}

for spec in "${SEQSTART_FUZZ_TARGET_SPECS[@]}"; do
  IFS='|' read -r target max_len dictionary <<< "${spec}"
  if [[ "${dictionary}" == "json" ]]; then
    run_target "${target}" "${max_len}" "${FUZZ_JSON_DICT}"
  else
    run_target "${target}" "${max_len}"
  fi
done

#!/usr/bin/env bash

# Single source of truth for Dum-Ka's retained libFuzzer targets.
# Fields are: target | max input bytes | optional dictionary key.
readonly SEQSTART_FUZZ_TARGET_SPECS=(
  "persist_load_score|65536|json"
  "score_pipeline|65536|json"
  "structured_score_pipeline|4096|"
  "parallel_transport_queue|8192|"
  "dumka_dsl_parse|4096|"
)

dumka_fuzz_script_targets() {
  local spec target _max_len _dictionary
  for spec in "${SEQSTART_FUZZ_TARGET_SPECS[@]}"; do
    IFS='|' read -r target _max_len _dictionary <<< "${spec}"
    printf '%s\n' "${target}"
  done
}

dumka_fuzz_manifest_targets() {
  awk '
    /^\[\[bin\]\]/ { in_bin = 1; next }
    in_bin && /^name[[:space:]]*=/ {
      name = $0
      sub(/^[^=]*=[[:space:]]*"/, "", name)
      sub(/"[[:space:]]*$/, "", name)
      print name
      in_bin = 0
    }
  ' fuzz/Cargo.toml
}

validate_dumka_fuzz_targets() {
  local manifest_targets script_targets source_targets corpus_targets target
  manifest_targets="$(dumka_fuzz_manifest_targets | LC_ALL=C sort)"
  script_targets="$(dumka_fuzz_script_targets | LC_ALL=C sort)"
  source_targets="$(
    find fuzz/fuzz_targets -maxdepth 1 -type f -name '*.rs' ! -name 'common.rs' \
      | sed -e 's#^.*/##' -e 's/\.rs$//' \
      | LC_ALL=C sort
  )"
  corpus_targets="$(
    find fuzz/corpus -mindepth 1 -maxdepth 1 -type d \
      | sed -e 's#^.*/##' \
      | LC_ALL=C sort
  )"

  if [[ "${manifest_targets}" != "${script_targets}" ]]; then
    echo "fuzz launcher targets differ from fuzz/Cargo.toml" >&2
    diff -u \
      <(printf '%s\n' "${manifest_targets}") \
      <(printf '%s\n' "${script_targets}") >&2 || true
    return 1
  fi

  if [[ "${source_targets}" != "${script_targets}" ]]; then
    echo "fuzz target sources differ from the retained target inventory" >&2
    diff -u \
      <(printf '%s\n' "${script_targets}") \
      <(printf '%s\n' "${source_targets}") >&2 || true
    return 1
  fi

  if [[ "${corpus_targets}" != "${script_targets}" ]]; then
    echo "fuzz corpus directories differ from the retained target inventory" >&2
    diff -u \
      <(printf '%s\n' "${script_targets}") \
      <(printf '%s\n' "${corpus_targets}") >&2 || true
    return 1
  fi

  while IFS= read -r target; do
    [[ -n "${target}" ]] || continue
    if [[ ! -f "fuzz/fuzz_targets/${target}.rs" ]]; then
      echo "missing fuzz target source: fuzz/fuzz_targets/${target}.rs" >&2
      return 1
    fi
    if [[ ! -d "fuzz/corpus/${target}" ]]; then
      echo "missing seed corpus: fuzz/corpus/${target}" >&2
      return 1
    fi
  done <<< "${script_targets}"
}

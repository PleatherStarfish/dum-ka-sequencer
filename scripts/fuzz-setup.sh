#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# shellcheck source=scripts/fuzz-targets.sh
source "${SCRIPT_DIR}/fuzz-targets.sh"
validate_dumka_fuzz_targets

rustup toolchain install nightly

if ! cargo +nightly fuzz --version >/dev/null 2>&1; then
  cargo +nightly install cargo-fuzz --locked
fi

cargo +nightly fuzz build

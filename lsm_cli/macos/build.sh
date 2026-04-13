#!/usr/bin/env bash
set -euo pipefail

PYTHON_BIN="${PYTHON_BIN:-python3}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SPEC_PATH="${SCRIPT_DIR}/lsm.spec"

if [[ "${1:-}" == "--clean" ]]; then
  rm -rf "${REPO_ROOT}/build" "${REPO_ROOT}/dist"
fi

cd "${REPO_ROOT}"
"${PYTHON_BIN}" -m PyInstaller --version >/dev/null
"${PYTHON_BIN}" -m PyInstaller --noconfirm "${SPEC_PATH}"

echo "Build completed: ${REPO_ROOT}/dist/lsm"

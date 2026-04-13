#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SOURCE_DIR="${1:-${REPO_ROOT}/dist/lsm}"
TARGET_DIR="${HOME}/Library/Application Support/LabStorageManager/bin/lsm"
TARGET_PARENT="$(dirname "${TARGET_DIR}")"

mkdir -p "${TARGET_DIR}"
rsync -a --delete "${SOURCE_DIR}/" "${TARGET_DIR}/"

SHELL_NAME="$(basename "${SHELL:-zsh}")"
if [[ "${SHELL_NAME}" == "bash" ]]; then
  RC_FILE="${HOME}/.bash_profile"
else
  RC_FILE="${HOME}/.zshrc"
fi

EXPORT_LINE="export PATH=\"${TARGET_PARENT}:\$PATH\""
touch "${RC_FILE}"
if ! grep -Fq "${TARGET_PARENT}" "${RC_FILE}"; then
  {
    echo ""
    echo "# LabStorageManager CLI"
    echo "${EXPORT_LINE}"
  } >> "${RC_FILE}"
  echo "Added PATH entry to ${RC_FILE}"
else
  echo "PATH already configured in ${RC_FILE}"
fi

echo "Installed lsm to: ${TARGET_DIR}"
echo "Open a new terminal and run: lsm auth login --username <user> --password-stdin"

#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == -c ]]; then
    realpath -m -- "$3"
elif [[ "$1" == - ]]; then
    cat >/dev/null
elif [[ "$2" == app.read_only.snapshot ]]; then
    echo "snapshot $3" >>"${TEST_LOG}"
    if [[ "$3" == create ]]; then
        [[ "${FAIL_CREATE:-0}" != 1 ]] || exit 9
        printf 'snapshot-data' >"$5"
    else
        [[ -f "$5" ]] || exit 8
    fi
elif [[ "$2" == uvicorn ]]; then
    service="$3"
    printf '%s|%s|%s|%s|%s|%s\n' "$service" "$PWD" "${DATABASE_URL:-}" "${MAINTENANCE_MODE:-}" "${REDIS_KEY_PREFIX:-}" "$*" >>"${TEST_LOG}"
    echo "$$" >"${TEST_LOG}.${service}.pid"
    trap 'exit 0' TERM INT
    if [[ "${IGNORE_TERM:-0}" == 1 ]]; then
        trap '' TERM INT
    fi
    while [[ ! -f "${TEST_LOG}.${service}.stop" ]]; do
        sleep 0.1 &
        wait "$!" || true
    done
    exit "${SERVICE_EXIT_CODE:-0}"
else
    exit 7
fi

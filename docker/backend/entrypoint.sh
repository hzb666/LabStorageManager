#!/bin/sh
set -eu

PERSIST_ROOT="/data"
APP_ROOT="/app"

mkdir -p "${PERSIST_ROOT}/static" "${PERSIST_ROOT}/keys" "${PERSIST_ROOT}/logs"

if [ ! -f "${PERSIST_ROOT}/lab_inventory.db" ]; then
  touch "${PERSIST_ROOT}/lab_inventory.db"
fi

rm -rf "${APP_ROOT}/static"
ln -s "${PERSIST_ROOT}/static" "${APP_ROOT}/static"

rm -rf "${APP_ROOT}/.keys"
ln -s "${PERSIST_ROOT}/keys" "${APP_ROOT}/.keys"

rm -rf "${APP_ROOT}/logs"
ln -s "${PERSIST_ROOT}/logs" "${APP_ROOT}/logs"

ln -sf "${PERSIST_ROOT}/lab_inventory.db" "${APP_ROOT}/lab_inventory.db"

if [ "${ALGORITHM:-RS256}" = "RS256" ]; then
  if [ ! -f "${APP_ROOT}/.keys/private.pem" ] || [ ! -f "${APP_ROOT}/.keys/public.pem" ]; then
    runtime_env="$(printf '%s' "${ENV:-production}" | tr '[:upper:]' '[:lower:]')"
    case "${runtime_env}" in
      development|dev)
        openssl genrsa -out "${APP_ROOT}/.keys/private.pem" 2048 >/dev/null 2>&1
        openssl rsa -in "${APP_ROOT}/.keys/private.pem" -pubout -out "${APP_ROOT}/.keys/public.pem" >/dev/null 2>&1
        ;;
      *)
        echo "Missing RS256 key files under ${APP_ROOT}/.keys." >&2
        echo "Generate /data/keys/private.pem and /data/keys/public.pem before production startup." >&2
        exit 1
        ;;
    esac
  fi
fi

exec "$@"

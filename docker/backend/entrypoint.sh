#!/bin/sh
set -eu

PERSIST_ROOT="/data"
APP_ROOT="/app"

mkdir -p "${PERSIST_ROOT}/static" "${PERSIST_ROOT}/keys"

if [ ! -f "${PERSIST_ROOT}/lab_inventory.db" ]; then
  touch "${PERSIST_ROOT}/lab_inventory.db"
fi

rm -rf "${APP_ROOT}/static"
ln -s "${PERSIST_ROOT}/static" "${APP_ROOT}/static"

rm -rf "${APP_ROOT}/.keys"
ln -s "${PERSIST_ROOT}/keys" "${APP_ROOT}/.keys"

ln -sf "${PERSIST_ROOT}/lab_inventory.db" "${APP_ROOT}/lab_inventory.db"

if [ "${ALGORITHM:-RS256}" = "RS256" ] && [ ! -f "${APP_ROOT}/.keys/private.pem" ]; then
  openssl genrsa -out "${APP_ROOT}/.keys/private.pem" 2048 >/dev/null 2>&1
  openssl rsa -in "${APP_ROOT}/.keys/private.pem" -pubout -out "${APP_ROOT}/.keys/public.pem" >/dev/null 2>&1
fi

exec "$@"

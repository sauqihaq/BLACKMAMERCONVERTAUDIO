#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
[ -f .env ] || cp .env.example .env
[ -d node_modules/express ] || npm install --no-audit --no-fund
node server.js

#!/usr/bin/env bash
# Rebuilds the e2e database with demo data and restarts the mock services.
set -e
cd "$(dirname "$0")/../.."
mkdir -p tests/.tmp
if [ -f tests/.tmp/mock.pid ]; then kill "$(cat tests/.tmp/mock.pid)" 2>/dev/null || true; fi
rm -rf tests/.tmp/media
export DATABASE_URL=$(node tests/db/setup-db.mjs sarees_e2e)
node tests/mock/seed-demo.mjs
nohup node tests/mock/server.mjs > tests/.tmp/mock.log 2>&1 &
echo $! > tests/.tmp/mock.pid
sleep 1
echo "e2e database ready: $DATABASE_URL"

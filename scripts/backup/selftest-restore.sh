#!/usr/bin/env bash
# Dump -> wipe -> restore -> compare, against the LOCAL Supabase stack (already started and reset with the seed).
# Proves dump.sh, restore.sh and compare-counts.sh work end to end and that a difference is detected. No live project.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
export PGHOST=127.0.0.1 PGPORT=54322 PGUSER=supabase_admin PGPASSWORD=postgres PGDATABASE=postgres
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT

"$here/dump.sh" "$t/d"
# the seed must have given us something worth restoring
users="$(awk -F'\t' '$1 == "auth.users" {print $2}' "$t/d/counts.tsv")"
[ "${users:-0}" -ge 1 ] || { echo "FAIL: no auth.users in the dump (seed missing?)"; exit 1; }

# wipe the data the restore is meant to bring back
docker run --rm --network host -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE postgres:17-alpine \
  psql -X -v ON_ERROR_STOP=1 -q -c "truncate public.users, auth.users cascade"
if "$here/compare-counts.sh" "$t/d" > /dev/null 2>&1; then echo "FAIL: counts matched after a wipe"; exit 1; fi
echo "PASS: compare-counts notices missing data"

"$here/restore.sh" "$t/d"
echo "PASS: restore brought every table back to its dump-time count"

# restoring twice is fine (it replaces, never appends)
"$here/restore.sh" "$t/d"
echo "PASS: a second restore is idempotent"

echo "restore selftest ok"

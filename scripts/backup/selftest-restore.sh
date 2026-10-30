#!/usr/bin/env bash
# Dump -> wipe -> restore -> verify, against the LOCAL Supabase stack (already started and reset with the seed).
# Proves dump.sh, restore.sh, compare-counts.sh, compare-checksums.sh, fk-check.sql and smoke.sql work end to end, that the two
# archive schemas are in the dump and come back, that the dump is taken at one snapshot, and that a changed amount, a missing row
# or an orphan row is DETECTED. No live project.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/lib.sh"
export PGHOST=127.0.0.1 PGPORT=54322 PGUSER=supabase_admin PGPASSWORD=postgres PGDATABASE=postgres
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
sql() { pgx "$t" psql -X -v ON_ERROR_STOP=1 -q -At -c "$1"; }

# Something worth restoring: one chain of money rows, and one row in each archive schema.
sql "insert into public.companies (id, name) values ('c0de0000-0000-4000-8000-000000000001', 'Selftest Customer');
     insert into public.orders (id, company_id, owner_id) values ('c0de0000-0000-4000-8000-000000000002', 'c0de0000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002');
     insert into public.invoices (id, order_id, number, net_amount, gst_amount) values ('c0de0000-0000-4000-8000-000000000003', 'c0de0000-0000-4000-8000-000000000002', 'ST-1', 123456.78, 22222.22);
     insert into public.payments_in (id, order_id, amount) values ('c0de0000-0000-4000-8000-000000000004', 'c0de0000-0000-4000-8000-000000000002', 5000.5);
     insert into public.expenses (id, amount_pkr, category_id) values ('c0de0000-0000-4000-8000-000000000005', 777.25, 'ca7e0000-0000-4000-8000-000000000012');
     insert into legacy_archive.legacy_rows (table_name, row_id, data) values ('invoices', 'c0de0000-0000-4000-8000-000000000003', '{\"old\": true}');
     insert into audit_archive.audit_log_months (table_name, month, row_count, first_at, last_at, rows) values ('rfqs', '2020-01-01', 1, now(), now(), '[{}]');"

"$here/dump.sh" "$t/d"
users="$(awk -F'\t' '$1 == "auth.users" {print $2}' "$t/d/counts.tsv")"
[ "${users:-0}" -ge 1 ] || { echo "FAIL: no auth.users in the dump (seed missing?)"; exit 1; }

# C3: the archive schemas are in the dump, the counts and the checksums
for s in legacy_archive.legacy_rows audit_archive.audit_log_months; do
  [ "$(awk -F'\t' -v t="$s" '$1 == t {print $2}' "$t/d/counts.tsv")" = "1" ] || { echo "FAIL: $s missing from the counts"; exit 1; }
  grep -q "^hash\.$s" "$t/d/checksums.tsv" || { echo "FAIL: $s missing from the checksums"; exit 1; }
done
[ -s "$t/d/archive.dump" ] || { echo "FAIL: no archive.dump"; exit 1; }
echo "PASS: legacy_archive and audit_archive are in the dump, the counts and the checksums"

# H4: money checksums are there, and the dump is one snapshot
grep -q '^invoices.net_sum' "$t/d/checksums.tsv" && grep -q '^payments_in.amount_sum' "$t/d/checksums.tsv" && grep -q '^expenses.amount_sum' "$t/d/checksums.tsv" \
  && grep -q '^invoices.month\.' "$t/d/checksums.tsv" || { echo "FAIL: money checksums missing"; exit 1; }
grep -q '^one_snapshot=yes' "$t/d/manifest.txt" || { echo "FAIL: the dump was not taken at one snapshot"; cat "$t/d/manifest.txt"; exit 1; }
echo "PASS: money checksums are present and the dump was taken at one snapshot"

# a write that lands while a snapshot is open must not show in what the snapshot sees
snapshot_open
[ -n "$SNAP_ID" ] || { echo "FAIL: no snapshot"; exit 1; }
before="$(psql_snap "$t" snap1.tsv "select count(*) from public.companies" && cat "$t/snap1.tsv")"
sql "insert into public.companies (name) values ('Written after the snapshot')"
psql_snap "$t" snap2.tsv "select count(*) from public.companies"
[ "$before" = "$(cat "$t/snap2.tsv")" ] || { echo "FAIL: the snapshot saw a later write"; exit 1; }
snapshot_close
sql "delete from public.companies where name = 'Written after the snapshot'"
echo "PASS: a later write is invisible at the snapshot"

# wipe the data the restore is meant to bring back
sql "truncate public.users, auth.users, legacy_archive.legacy_rows cascade"
if "$here/compare-counts.sh" "$t/d" > /dev/null 2>&1; then echo "FAIL: counts matched after a wipe"; exit 1; fi
echo "PASS: compare-counts notices missing data"

"$here/restore.sh" "$t/d"
echo "PASS: restore brought every table back: counts, checksums, foreign keys, triggers, views"
[ "$(sql "select count(*) from legacy_archive.legacy_rows")" = "1" ] || { echo "FAIL: legacy_archive not restored"; exit 1; }
echo "PASS: the archive schemas came back"

# restoring twice is fine (it replaces, never appends)
"$here/restore.sh" "$t/d"
echo "PASS: a second restore is idempotent"

# H4: a changed amount (same row counts) is caught by the checksums
sql "update public.invoices set net_amount = net_amount + 1 where id = 'c0de0000-0000-4000-8000-000000000003'"
"$here/compare-counts.sh" "$t/d" > /dev/null
if bash "$here/compare-checksums.sh" "$t/d" > "$t/cs.out" 2>&1; then echo "FAIL: a changed invoice amount was not noticed"; exit 1; fi
grep -q 'invoices.net_sum' "$t/cs.out" && grep -q 'hash.public.invoices' "$t/cs.out" || { echo "FAIL: the differing lines were not named"; cat "$t/cs.out"; exit 1; }
if grep -q '123457' "$t/cs.out"; then echo "FAIL: a value was printed"; exit 1; fi
echo "PASS: a changed amount with equal row counts is caught, by name, without printing a value"
sql "update public.invoices set net_amount = net_amount - 1 where id = 'c0de0000-0000-4000-8000-000000000003'"
bash "$here/compare-checksums.sh" "$t/d" > /dev/null

# H4: an orphan row (loaded with triggers off, so no foreign key stopped it) is caught by the FK check
cp "$here/fk-check.sql" "$t/fk-check.sql"
pgx "$t" psql -X -q -v ON_ERROR_STOP=1 -f fk-check.sql 2> /dev/null
PGOPTIONS="-c session_replication_role=replica" pgx "$t" psql -X -q -v ON_ERROR_STOP=1 -c "insert into public.payments_in (id, order_id, amount) values ('c0de0000-0000-4000-8000-0000000000ff', 'c0de0000-0000-4000-8000-0000000000fe', 1)"
if pgx "$t" psql -X -q -v ON_ERROR_STOP=1 -f fk-check.sql > /dev/null 2>&1; then echo "FAIL: an orphan row was not noticed"; exit 1; fi
sql "delete from public.payments_in where id = 'c0de0000-0000-4000-8000-0000000000ff'"
pgx "$t" psql -X -q -v ON_ERROR_STOP=1 -f fk-check.sql 2> /dev/null
echo "PASS: the foreign key check passes on good data and catches an orphan row"

# a trigger left disabled is caught too
sql "alter table public.invoices disable trigger user"
if pgx "$t" psql -X -q -v ON_ERROR_STOP=1 -f fk-check.sql > /dev/null 2>&1; then echo "FAIL: a disabled trigger was not noticed"; exit 1; fi
sql "alter table public.invoices enable trigger user"
echo "PASS: a disabled trigger is caught"

echo "restore selftest ok"

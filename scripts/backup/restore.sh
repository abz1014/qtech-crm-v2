#!/usr/bin/env bash
# restore.sh DUMPDIR: restore a dump made by dump.sh into the database named by the PG* variables, then check it:
#   1. row counts match counts.tsv                                (compare-counts.sh)
#   2. money checksums and table hashes match checksums.tsv        (compare-checksums.sh)
#   3. every foreign key holds, constraints are valid, triggers are on (fk-check.sql)
#   4. every view reads, users exist, the first functions answer   (smoke.sql)
# The target must already have the schema (run the migrations first: `supabase db reset --local`, or `supabase db push`
# for a new hosted project). Existing rows in public, legacy_archive, audit_archive, auth.users, auth.identities and storage.*
# are REPLACED. Triggers are switched off for the load (session_replication_role = replica) so audit rows are not doubled and
# capture triggers do not rewrite data; they are on again for the checks (a new session). This needs a role that may set it:
# supabase_admin locally, postgres on hosted.
. "$(dirname "$0")/lib.sh"
here="$(cd "$(dirname "$0")" && pwd)"
dir="${1:?usage: restore.sh DUMPDIR}"
dir="$(cd "$dir" && pwd)"
[ -s "$dir/public.dump" ] && [ -s "$dir/authstorage.dump" ] && [ -s "$dir/counts.tsv" ] || { echo "::error::$dir is not a dump directory"; exit 1; }

tables="$(pgx "$dir" psql -X -At -v ON_ERROR_STOP=1 -c "select string_agg(format('%I.%I', schemaname, tablename), ', ') from pg_tables where schemaname in ($BACKUP_SCHEMAS_SQL)")"
pgx "$dir" psql -X -v ON_ERROR_STOP=1 -q -c "truncate $tables, auth.users, storage.buckets, storage.objects cascade"

export PGOPTIONS="-c session_replication_role=replica"
# auth and storage first: public.users points at auth.users.
pgx "$dir" pg_restore --data-only --no-owner --no-privileges -d "$PGDATABASE" --exit-on-error authstorage.dump
pgx "$dir" pg_restore --data-only --no-owner --no-privileges -d "$PGDATABASE" --exit-on-error public.dump
# dumps made before the archive schemas were included have no archive.dump
if [ -s "$dir/archive.dump" ]; then
  pgx "$dir" pg_restore --data-only --no-owner --no-privileges -d "$PGDATABASE" --exit-on-error archive.dump
else
  echo "no archive.dump in this dump (made before R13b): legacy_archive and audit_archive not restored"
fi
unset PGOPTIONS

"$here/compare-counts.sh" "$dir"
bash "$here/compare-checksums.sh" "$dir"
cp "$here/fk-check.sql" "$here/smoke.sql" "$dir/"
pgx "$dir" psql -X -q -v ON_ERROR_STOP=1 -f fk-check.sql
pgx "$dir" psql -X -q -v ON_ERROR_STOP=1 -f smoke.sql
rm -f "$dir/fk-check.sql" "$dir/smoke.sql"
echo "restore verified: counts, checksums, foreign keys, triggers, views"

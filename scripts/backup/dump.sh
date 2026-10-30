#!/usr/bin/env bash
# dump.sh OUTDIR: dump the database named by the PG* variables into OUTDIR (created if needed).
#   public.dump         schema + data of the public schema (tables, sequences, views, functions, policies, grants)
#   archive.dump        schema + data of legacy_archive and audit_archive (old audit rows, the import's raw rows). `-n public`
#                       alone leaves both out (C3).
#   authstorage.dump    data of auth.users, auth.identities, storage.buckets, storage.objects (file METADATA; the files are
#                       fetched by storage-download.sh)
#   counts.tsv          row count per table at dump time (restore.sh compares against it)
#   checksums.tsv       money sums and per-month counts, and a content hash of every table (restore.sh compares against it)
#   migrations.txt      applied migration versions
#   roles.txt           custom roles (platform roles are managed by Supabase and not listed)
#   manifest.txt        when, which commit, server version, whether the files share one snapshot
# Every file is taken at ONE snapshot (pg_export_snapshot + pg_dump --snapshot), so the dumps, the counts and the checksums agree
# even while the app writes. Plain pg_dump over the connection given: on the Free plan use the session pooler (IPv4), which keeps
# the session the snapshot lives in; see docs/SUPABASE.md.
. "$(dirname "$0")/lib.sh"
out="${1:?usage: dump.sh OUTDIR}"
mkdir -p "$out"; out="$(cd "$out" && pwd)"

snapshot_open
trap snapshot_close EXIT

pg_dump_snap "$out" -Fc --no-owner -n public -f public.dump
pg_dump_snap "$out" -Fc --no-owner -n legacy_archive -n audit_archive -f archive.dump
pg_dump_snap "$out" -Fc --no-owner -t auth.users -t auth.identities -t storage.buckets -t storage.objects -f authstorage.dump
row_counts "$out" counts.tsv
checksums "$out" checksums.tsv
psql_snap "$out" migrations.txt "select version from supabase_migrations.schema_migrations order by version"
pgx "$out" psql -X -At -F ' ' -v ON_ERROR_STOP=1 -c "select rolname, case when rolcanlogin then 'login' else 'nologin' end from pg_roles where rolname !~ '^(pg_|supabase|authenticator|anon\$|authenticated\$|service_role\$|dashboard_user\$|pgbouncer\$|postgres\$|cli_login|pgsodium)' order by 1" > "$out/roles.txt"
{
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git_sha=${GITHUB_SHA:-unknown}"
  echo "server=$(pgx "$out" psql -X -At -c 'show server_version')"
  echo "tables_counted=$(wc -l < "$out/counts.tsv" | tr -d ' ')"
  echo "checksums=$(wc -l < "$out/checksums.tsv" | tr -d ' ')"
  echo "one_snapshot=$([ -n "$SNAP_ID" ] && echo yes || echo no)"
} > "$out/manifest.txt"
snapshot_close
trap - EXIT

# Sanity: every archive must list objects, and counts and checksums must be present.
for f in public.dump archive.dump authstorage.dump; do
  [ "$(pgx "$out" pg_restore --list "$f" | grep -c .)" -gt 5 ] || { echo "::error::$f looks empty"; exit 1; }
done
[ -s "$out/counts.tsv" ] || { echo "::error::no row counts"; exit 1; }
grep -q '^invoices.net_sum' "$out/checksums.tsv" || { echo "::error::no money checksums"; exit 1; }
grep -q '^hash\.public\.' "$out/checksums.tsv" || { echo "::error::no table hashes"; exit 1; }
for s in legacy_archive audit_archive; do
  grep -q "^$s\." "$out/counts.tsv" || { echo "::error::the $s schema is missing from the row counts"; exit 1; }
done
echo "dump ok: $(wc -l < "$out/counts.tsv" | tr -d ' ') tables counted, $(wc -l < "$out/checksums.tsv" | tr -d ' ') checksums, $(wc -l < "$out/migrations.txt" | tr -d ' ') migrations, public.dump $(wc -c < "$out/public.dump") bytes, one snapshot: $(grep -o 'one_snapshot=.*' "$out/manifest.txt" | cut -d= -f2)"

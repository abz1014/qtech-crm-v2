#!/usr/bin/env bash
# dump.sh OUTDIR: dump the database named by the PG* variables into OUTDIR (created if needed).
#   public.dump         schema + data of the public schema (tables, sequences, views, functions, policies, grants)
#   authstorage.dump    data of auth.users, auth.identities, storage.buckets, storage.objects (file METADATA, not the files)
#   counts.tsv          row count per table at dump time (restore.sh compares against it)
#   migrations.txt      applied migration versions
#   roles.txt           custom roles (platform roles are managed by Supabase and not listed)
#   manifest.txt        when, which commit, server version
# Plain pg_dump over the connection given: on the Free plan use the session pooler (IPv4), see docs/SUPABASE.md.
. "$(dirname "$0")/lib.sh"
out="${1:?usage: dump.sh OUTDIR}"
mkdir -p "$out"; out="$(cd "$out" && pwd)"

pgx "$out" pg_dump -Fc --no-owner -n public -f public.dump
pgx "$out" pg_dump -Fc --no-owner -t auth.users -t auth.identities -t storage.buckets -t storage.objects -f authstorage.dump
row_counts "$out" counts.tsv
pgx "$out" psql -X -At -v ON_ERROR_STOP=1 -c "select version from supabase_migrations.schema_migrations order by version" > "$out/migrations.txt"
pgx "$out" psql -X -At -F ' ' -v ON_ERROR_STOP=1 -c "select rolname, case when rolcanlogin then 'login' else 'nologin' end from pg_roles where rolname !~ '^(pg_|supabase|authenticator|anon\$|authenticated\$|service_role\$|dashboard_user\$|pgbouncer\$|postgres\$|cli_login|pgsodium)' order by 1" > "$out/roles.txt"
{
  echo "created_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "git_sha=${GITHUB_SHA:-unknown}"
  echo "server=$(pgx "$out" psql -X -At -c 'show server_version')"
  echo "tables_counted=$(wc -l < "$out/counts.tsv" | tr -d ' ')"
} > "$out/manifest.txt"

# Sanity: both archives must list objects, and counts must be present.
for f in public.dump authstorage.dump; do
  [ "$(pgx "$out" pg_restore --list "$f" | grep -c .)" -gt 5 ] || { echo "::error::$f looks empty"; exit 1; }
done
[ -s "$out/counts.tsv" ] || { echo "::error::no row counts"; exit 1; }
echo "dump ok: $(wc -l < "$out/counts.tsv" | tr -d ' ') tables counted, $(wc -l < "$out/migrations.txt" | tr -d ' ') migrations, public.dump $(wc -c < "$out/public.dump") bytes"

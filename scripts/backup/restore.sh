#!/usr/bin/env bash
# restore.sh DUMPDIR: restore a dump made by dump.sh into the database named by the PG* variables, then compare row counts.
# The target must already have the schema (run the migrations first: `supabase db reset --local`, or `supabase db push`
# for a new hosted project). Existing rows in public, auth.users, auth.identities and storage.* are REPLACED.
# Triggers are switched off for the load (session_replication_role = replica) so audit rows are not doubled and
# capture triggers do not rewrite data. This needs a role that may set it: supabase_admin locally, postgres on hosted.
. "$(dirname "$0")/lib.sh"
dir="${1:?usage: restore.sh DUMPDIR}"
dir="$(cd "$dir" && pwd)"
[ -s "$dir/public.dump" ] && [ -s "$dir/authstorage.dump" ] && [ -s "$dir/counts.tsv" ] || { echo "::error::$dir is not a dump directory"; exit 1; }

tables="$(pgx "$dir" psql -X -At -v ON_ERROR_STOP=1 -c "select string_agg(format('%I.%I', schemaname, tablename), ', ') from pg_tables where schemaname = 'public'")"
pgx "$dir" psql -X -v ON_ERROR_STOP=1 -q -c "truncate $tables, auth.users, storage.buckets, storage.objects cascade"

export PGOPTIONS="-c session_replication_role=replica"
# auth and storage first: public.users points at auth.users.
pgx "$dir" pg_restore --data-only --no-owner --no-privileges -d "$PGDATABASE" --exit-on-error authstorage.dump
pgx "$dir" pg_restore --data-only --no-owner --no-privileges -d "$PGDATABASE" --exit-on-error public.dump
unset PGOPTIONS

"$(dirname "$0")/compare-counts.sh" "$dir"

#!/usr/bin/env bash
# Shared helpers for the backup scripts (R13). Source this file; do not run it.
# Connection comes from the standard libpq variables: PGHOST PGPORT PGUSER PGPASSWORD [PGDATABASE PGSSLMODE PGOPTIONS].
# The Postgres client tools run from the postgres:17 Docker image, so their version always matches the server (17),
# whatever the runner ships. Nothing here ever prints a password, a host or row contents.
set -euo pipefail

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
export PGDATABASE="${PGDATABASE:-postgres}"
export PGPORT="${PGPORT:-5432}"

# pgx DIR CMD ARGS...: run a client tool with DIR mounted at /work (and as the working directory).
pgx() {
  local dir="$1"; shift
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGOPTIONS \
    -v "$dir:/work" -w /work "$PG_IMAGE" "$@"
}

# The tables whose row counts prove a restore: every table in public, plus the user, identity and storage tables.
COUNTS_SQL_BUILDER="select string_agg(format('select %L as t, count(*)::bigint as n from %I.%I', table_schema || '.' || table_name, table_schema, table_name), ' union all ' order by table_schema, table_name)
from information_schema.tables
where table_type = 'BASE TABLE'
  and (table_schema = 'public'
       or (table_schema, table_name) in (('auth', 'users'), ('auth', 'identities'), ('storage', 'buckets'), ('storage', 'objects')))"

# row_counts DIR OUTFILE: write "schema.table<TAB>count" lines, sorted, to OUTFILE (inside DIR).
row_counts() {
  local dir="$1" out="$2" sql
  sql="$(pgx "$dir" psql -X -At -v ON_ERROR_STOP=1 -c "$COUNTS_SQL_BUILDER")"
  [ -n "$sql" ] || { echo "::error::could not build the row-count query"; return 1; }
  pgx "$dir" psql -X -At -F $'\t' -v ON_ERROR_STOP=1 -c "select t, n from ($sql) c order by t" > "$dir/$out"
}

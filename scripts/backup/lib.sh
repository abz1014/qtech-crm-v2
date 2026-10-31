#!/usr/bin/env bash
# Shared helpers for the backup scripts (R13). Source this file; do not run it.
# Connection comes from the standard libpq variables: PGHOST PGPORT PGUSER PGPASSWORD [PGDATABASE PGSSLMODE PGOPTIONS].
# The Postgres client tools run from the postgres:17 Docker image, so their version always matches the server (17),
# whatever the runner ships. Nothing here ever prints a password, a host or row contents.
set -euo pipefail

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
export PGDATABASE="${PGDATABASE:-postgres}"
export PGPORT="${PGPORT:-5432}"

# Schemas whose tables are counted, checksummed and restored: the app's own, plus the two archive schemas that a plain
# `pg_dump -n public` leaves out (audit_archive: old audit rows, legacy_archive: the import's raw rows).
BACKUP_SCHEMAS_SQL="'public', 'legacy_archive', 'audit_archive'"

# pgx DIR CMD ARGS...: run a client tool with DIR mounted at /work (and as the working directory).
pgx() {
  local dir="$1"; shift
  docker run --rm --network host --user "$(id -u):$(id -g)" \
    -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGOPTIONS \
    -v "$dir:/work" -w /work "$PG_IMAGE" "$@"
}

# pgxi DIR CMD ARGS...: like pgx, with standard input forwarded (used by the snapshot holder).
pgxi() {
  local dir="$1"; shift
  docker run --rm -i --network host --user "$(id -u):$(id -g)" \
    -e PGHOST -e PGPORT -e PGUSER -e PGPASSWORD -e PGDATABASE -e PGSSLMODE -e PGOPTIONS \
    -v "$dir:/work" -w /work "$PG_IMAGE" "$@"
}

# ---------------------------------------------------------------- one consistent snapshot for every dump and query
# snapshot_open: open a repeatable-read transaction in a background psql and export its snapshot id into SNAP_ID. Every pg_dump
# (--snapshot) and every count/checksum query (SET TRANSACTION SNAPSHOT) that runs while it is open sees exactly the same data,
# even if the app writes meanwhile. Needs a session connection (the Supabase SESSION pooler, or a direct connection), not the
# transaction pooler. If a snapshot cannot be had, SNAP_ID stays empty and the caller carries on without one (see dump.sh).
SNAP_ID=""
SNAP_DIR=""
SNAP_PID=""
snapshot_open() {
  SNAP_ID=""
  SNAP_DIR="$(mktemp -d)"
  mkfifo "$SNAP_DIR/in"
  pgxi "$SNAP_DIR" psql -X -q -At -v ON_ERROR_STOP=1 < "$SNAP_DIR/in" > "$SNAP_DIR/out" 2> "$SNAP_DIR/err" &
  SNAP_PID=$!
  exec 9> "$SNAP_DIR/in"
  echo "begin transaction isolation level repeatable read read only;" >&9
  echo "select 'SNAP:' || pg_export_snapshot();" >&9
  local i
  for i in $(seq 1 60); do
    SNAP_ID="$(sed -n 's/^SNAP://p' "$SNAP_DIR/out" 2> /dev/null | head -1)"
    [ -n "$SNAP_ID" ] && return 0
    kill -0 "$SNAP_PID" 2> /dev/null || break
    sleep 1
  done
  echo "::warning::could not export a snapshot, so the dumps are not taken at one instant (rows written while the dump runs may differ between files)"
  snapshot_close
  return 0
}

snapshot_close() {
  if [ -n "${SNAP_PID:-}" ]; then
    echo "commit;" >&9 2> /dev/null || true
    exec 9>&- 2> /dev/null || true
    wait "$SNAP_PID" 2> /dev/null || true
  fi
  [ -n "${SNAP_DIR:-}" ] && rm -rf "$SNAP_DIR"
  SNAP_ID=""; SNAP_DIR=""; SNAP_PID=""
}

# pg_dump_snap DIR ARGS...: pg_dump at the open snapshot, when there is one.
pg_dump_snap() {
  local dir="$1"; shift
  if [ -n "$SNAP_ID" ]; then pgx "$dir" pg_dump --snapshot="$SNAP_ID" "$@"; else pgx "$dir" pg_dump "$@"; fi
}

# psql_snap DIR OUTFILE SQL: run one query as tab-separated rows into DIR/OUTFILE, at the open snapshot when there is one.
# Display settings are pinned so the same data prints the same text on the live server and on the restore target.
psql_snap() {
  local dir="$1" out="$2" sql="$3" f="$1/.q.sql"
  {
    echo "begin transaction isolation level repeatable read read only;"
    [ -n "$SNAP_ID" ] && echo "set transaction snapshot '$SNAP_ID';"
    echo "set local timezone = 'UTC'; set local datestyle = 'ISO, YMD'; set local extra_float_digits = 1; set local bytea_output = 'hex';"
    echo "$sql;"
    echo "commit;"
  } > "$f"
  pgx "$dir" psql -X -q -At -F $'\t' -v ON_ERROR_STOP=1 -f .q.sql > "$dir/$out"
  rm -f "$f"
}

# ---------------------------------------------------------------- row counts
# The tables whose row counts prove a restore: every table in the backup schemas, plus the user, identity and storage tables.
COUNTS_SQL_BUILDER="select string_agg(format('select %L as t, count(*)::bigint as n from %I.%I', table_schema || '.' || table_name, table_schema, table_name), ' union all ' order by table_schema, table_name)
from information_schema.tables
where table_type = 'BASE TABLE'
  and (table_schema in ($BACKUP_SCHEMAS_SQL)
       or (table_schema, table_name) in (('auth', 'users'), ('auth', 'identities'), ('storage', 'buckets'), ('storage', 'objects')))"

# row_counts DIR OUTFILE: write "schema.table<TAB>count" lines, sorted, to OUTFILE (inside DIR).
row_counts() {
  local dir="$1" out="$2" sql
  sql="$(pgx "$dir" psql -X -At -v ON_ERROR_STOP=1 -c "$COUNTS_SQL_BUILDER")"
  [ -n "$sql" ] || { echo "::error::could not build the row-count query"; return 1; }
  psql_snap "$dir" "$out" "select t, n from ($sql) c order by t"
}

# ---------------------------------------------------------------- checksums (H4)
# Money checksums: sums and counts of the tables that hold money, in total and per month. Printed nowhere: only the NAMES of lines
# that differ ever reach a log.
MONEY_SQL="select 'invoices.count' as k, count(*)::text as v from public.invoices
union all select 'invoices.net_sum', coalesce(sum(net_amount), 0)::text from public.invoices
union all select 'invoices.gst_sum', coalesce(sum(gst_amount), 0)::text from public.invoices
union all select 'payments_in.count', count(*)::text from public.payments_in
union all select 'payments_in.amount_sum', coalesce(sum(amount), 0)::text from public.payments_in
union all select 'payments_in.live_amount_sum', coalesce(sum(amount) filter (where voided_at is null), 0)::text from public.payments_in
union all select 'expenses.count', count(*)::text from public.expenses
union all select 'expenses.amount_sum', coalesce(sum(amount_pkr), 0)::text from public.expenses
union all select 'invoices.month.' || m, n || '|' || a || '|' || b
  from (select coalesce(to_char(invoice_date, 'YYYY-MM'), 'none') m, count(*) n, coalesce(sum(net_amount), 0) a, coalesce(sum(gst_amount), 0) b from public.invoices group by 1) s
union all select 'payments_in.month.' || m, n || '|' || a
  from (select coalesce(to_char(received_on, 'YYYY-MM'), 'none') m, count(*) n, coalesce(sum(amount), 0) a from public.payments_in group by 1) s
union all select 'expenses.month.' || m, n || '|' || a
  from (select coalesce(to_char(paid_on, 'YYYY-MM'), 'none') m, count(*) n, coalesce(sum(amount_pkr), 0) a from public.expenses group by 1) s"

# Content hash of every table in the backup schemas (md5 of the sorted md5 of each row's text). Catches a changed value that a
# row count cannot.
HASH_SQL_BUILDER="select string_agg(format('select %L as k, coalesce(md5(string_agg(md5(x::text), '''' order by md5(x::text))), '''') as v from %I.%I x', 'hash.' || table_schema || '.' || table_name, table_schema, table_name), ' union all ' order by table_schema, table_name)
from information_schema.tables
where table_type = 'BASE TABLE' and table_schema in ($BACKUP_SCHEMAS_SQL)"

# checksums DIR OUTFILE: write "key<TAB>value" lines, sorted, to OUTFILE (inside DIR).
checksums() {
  local dir="$1" out="$2" hashes
  hashes="$(pgx "$dir" psql -X -At -v ON_ERROR_STOP=1 -c "$HASH_SQL_BUILDER")"
  [ -n "$hashes" ] || { echo "::error::could not build the checksum query"; return 1; }
  psql_snap "$dir" "$out" "select k, v from ($MONEY_SQL union all $hashes) c order by k"
}

# ---------------------------------------------------------------- storage (S3 protocol)
# s3_setup: read STORAGE_S3_ENDPOINT, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY (Supabase
# Storage S3 access keys: they reach Storage only, not the database or Auth) and prepare the aws CLI for them.
s3_setup() {
  : "${STORAGE_S3_ENDPOINT:?STORAGE_S3_ENDPOINT is not set}" "${STORAGE_S3_REGION:?STORAGE_S3_REGION is not set}"
  : "${STORAGE_S3_ACCESS_KEY_ID:?STORAGE_S3_ACCESS_KEY_ID is not set}" "${STORAGE_S3_SECRET_ACCESS_KEY:?STORAGE_S3_SECRET_ACCESS_KEY is not set}"
  command -v aws > /dev/null || { echo "::error::the aws CLI is not installed"; return 1; }
  export AWS_ACCESS_KEY_ID="$STORAGE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$STORAGE_S3_SECRET_ACCESS_KEY" AWS_DEFAULT_REGION="$STORAGE_S3_REGION"
  export AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required
  unset AWS_SESSION_TOKEN AWS_PROFILE
  AWS_CONFIG_FILE="$(mktemp)"
  printf '[default]\ns3 =\n    addressing_style = path\n' > "$AWS_CONFIG_FILE"
  export AWS_CONFIG_FILE
}

# s3 ARGS...: the aws CLI aimed at the Supabase Storage endpoint.
s3() { aws --endpoint-url "$STORAGE_S3_ENDPOINT" "$@"; }

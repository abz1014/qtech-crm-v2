#!/usr/bin/env bash
# record-status.sh backup DB_BYTES STORAGE_BYTES OBJECTS | record-status.sh backup-db-only DB_BYTES | record-status.sh drill ok|fail
# Tells the app (Settings, Backups and usage; the To do warning) what the backup job just did, through the database functions of
# migration 0120. Uses the PG* variables. A failure to record is a warning, never a failure of the backup itself.
. "$(dirname "$0")/lib.sh"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
num() { case "$1" in ''|*[!0-9]*) echo "::error::not a number: $1"; exit 1 ;; esac; }
case "${1:?usage: record-status.sh backup|backup-db-only|drill ...}" in
  backup)
    num "${2:?}"; num "${3:?}"; num "${4:?}"
    sql="select qtech_ops.record_backup($2, $3, $4)" ;;
  backup-db-only)
    num "${2:?}"
    sql="select qtech_ops.record_backup($2, null, null)" ;;
  drill)
    case "${2:?}" in ok) v=true ;; fail) v=false ;; *) echo "::error::drill ok|fail"; exit 1 ;; esac
    sql="select qtech_ops.record_drill($v)" ;;
  *) echo "::error::unknown status $1"; exit 1 ;;
esac
if pgx "$t" psql -X -At -v ON_ERROR_STOP=1 -c "$sql" > /dev/null 2> "$t/err"; then
  echo "status recorded"
else
  echo "::warning::could not record the status in the database (is migration 0120 applied to this project?)"
fi

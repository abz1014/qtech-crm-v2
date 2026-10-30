#!/usr/bin/env bash
# purge-trash.sh: remove from Storage the files whose records were deleted more than 30 days ago (migration 0120). The database
# lists them in qtech_private.pending_file_deletes; this script asks which are due (a path a live record points at again is released,
# not removed), deletes each through the Storage S3 API (which also removes its storage.objects row), then tells the database they are
# done. Run it AFTER the nightly files backup, so a deleted file has always been in at least one backup. Prints counts only.
# Needs the PG* variables and the STORAGE_S3_* variables of storage-download.sh. PURGE_MAX (default 500) caps one run.
. "$(dirname "$0")/lib.sh"
s3_setup
max="${PURGE_MAX:-500}"
case "$max" in ''|*[!0-9]*) echo "::error::PURGE_MAX must be a number"; exit 1 ;; esac
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT

pgx "$t" psql -X -At -F $'\t' -v ON_ERROR_STOP=1 -c "select id, bucket, path from qtech_private.trash_claim_due($max)" > "$t/due.tsv"
due="$(grep -c . "$t/due.tsv" || true)"
if [ "$due" -eq 0 ]; then echo "purge: nothing is due"; exit 0; fi

done_ids=(); failed=0
while IFS=$'\t' read -r id bucket path; do
  [ -n "$id" ] || continue
  if s3 s3api delete-object --bucket "$bucket" --key "$path" > /dev/null 2>&1; then done_ids+=("$id"); else failed=$((failed + 1)); fi
done < "$t/due.tsv"

if [ "${#done_ids[@]}" -gt 0 ]; then
  list="$(printf "'%s'," "${done_ids[@]}")"
  pgx "$t" psql -X -At -v ON_ERROR_STOP=1 -c "select qtech_private.trash_done(array[${list%,}]::uuid[])" > /dev/null
fi
echo "purge: $due due, ${#done_ids[@]} removed from storage, $failed failed (they are tried again tomorrow)"
if [ "$failed" -gt 0 ]; then echo "::warning::purge: $failed file(s) could not be removed from storage"; fi

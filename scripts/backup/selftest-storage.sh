#!/usr/bin/env bash
# Storage backup, trash and purge, against the LOCAL Supabase stack (already started and reset with the seed). Needs the aws CLI,
# age, and the S3 variables the CI step exports from `supabase status` (STORAGE_S3_*). No live project.
#   - files uploaded through the S3 API come down byte for byte, and a missing or short file is caught
#   - the downloaded folder encrypts and decrypts with a throwaway age key, and the artifact has no plain file
#   - deleting a record lists its file in the 30-day trash and removes nothing from storage
#   - purge removes only what is due, leaves a re-attached file alone, and tells the database
#   - record-status writes what the app reads
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
. "$here/lib.sh"
export PGHOST=127.0.0.1 PGPORT=54322 PGUSER=supabase_admin PGPASSWORD=postgres PGDATABASE=postgres
: "${STORAGE_S3_ENDPOINT:?}" "${STORAGE_S3_REGION:?}" "${STORAGE_S3_ACCESS_KEY_ID:?}" "${STORAGE_S3_SECRET_ACCESS_KEY:?}"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
sql() { pgx "$t" psql -X -v ON_ERROR_STOP=1 -q -At -c "$1"; }
s3_setup

# ---- upload three small PDFs through the S3 API (so Storage records them in storage.objects)
mkdir -p "$t/up"
printf '%%PDF-1.4 selftest file a\n' > "$t/up/a.pdf"
printf '%%PDF-1.4 selftest file b, a little longer\n' > "$t/up/b.pdf"
printf '%%PDF-1.4 selftest generated doc\n' > "$t/up/c.pdf"
s3 s3api put-object --bucket rfq-files --key selftest/a.pdf --body "$t/up/a.pdf" --content-type application/pdf > /dev/null
s3 s3api put-object --bucket rfq-files --key selftest/b.pdf --body "$t/up/b.pdf" --content-type application/pdf > /dev/null
s3 s3api put-object --bucket generated-docs --key selftest/c.pdf --body "$t/up/c.pdf" --content-type application/pdf > /dev/null
[ "$(sql "select count(*) from storage.objects where name like 'selftest/%'")" = "3" ] || { echo "FAIL: the three uploads are not in storage.objects"; exit 1; }
echo "PASS: three files uploaded through the S3 API"

# ---- download all buckets, byte for byte
bash "$here/storage-download.sh" "$t/dl"
cmp "$t/up/a.pdf" "$t/dl/files/rfq-files/selftest/a.pdf" && cmp "$t/up/b.pdf" "$t/dl/files/rfq-files/selftest/b.pdf" && cmp "$t/up/c.pdf" "$t/dl/files/generated-docs/selftest/c.pdf"
grep -q 'selftest/a.pdf' "$t/dl/SHA256SUMS" 2> /dev/null || grep -q 'a.pdf' "$t/dl/SHA256SUMS" || { echo "FAIL: no checksum list"; exit 1; }
echo "PASS: every file came down byte for byte"

# ---- a missing file and a short file are caught
rm "$t/dl/files/rfq-files/selftest/a.pdf"
if bash "$here/storage-verify.sh" "$t/dl" > /dev/null 2>&1; then echo "FAIL: a missing file was not noticed"; exit 1; fi
cp "$t/up/a.pdf" "$t/dl/files/rfq-files/selftest/a.pdf"
head -c 5 "$t/up/b.pdf" > "$t/dl/files/rfq-files/selftest/b.pdf"
if bash "$here/storage-verify.sh" "$t/dl" > /dev/null 2>&1; then echo "FAIL: a short file was not noticed"; exit 1; fi
cp "$t/up/b.pdf" "$t/dl/files/rfq-files/selftest/b.pdf"
bash "$here/storage-verify.sh" "$t/dl" > /dev/null
echo "PASS: a missing file and a short file are caught"

# ---- encrypt the downloaded folder: only .age leaves, and it opens with the right key
command -v age-keygen > /dev/null || { echo "FAIL: age is not installed"; exit 1; }
age-keygen -o "$t/key.txt" 2> "$t/pub.txt"
pub="$(grep -o 'age1[a-z0-9]*' "$t/pub.txt" | head -1)"
mkdir -p "$t/out"
BACKUP_AGE_RECIPIENT="$pub" GZIP_LEVEL=1 bash "$here/encrypt.sh" "$t/dl" "$t/out/files.tar.gz.age" > /dev/null
[ -z "$(find "$t/out" -type f ! -name '*.age')" ] || { echo "FAIL: a non-.age file would be uploaded"; exit 1; }
if grep -aq 'selftest' "$t/out/files.tar.gz.age"; then echo "FAIL: a plain name is visible in the ciphertext"; exit 1; fi
mkdir "$t/open"; bash "$here/decrypt.sh" "$t/out/files.tar.gz.age" "$t/key.txt" "$t/open" > /dev/null
cmp "$t/up/a.pdf" "$t/open/dl/files/rfq-files/selftest/a.pdf"
echo "PASS: the files artifact is encrypted and opens with the key"

# ---- the 30-day trash: deleting a record lists its file and removes nothing
sql "insert into public.companies (id, name) values ('c0de0000-0000-4000-8000-0000000000a1', 'Trash Customer');
     insert into public.rfqs (id, company_id) values ('c0de0000-0000-4000-8000-0000000000a2', 'c0de0000-0000-4000-8000-0000000000a1'),
                                                    ('c0de0000-0000-4000-8000-0000000000a3', 'c0de0000-0000-4000-8000-0000000000a1');
     insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id) values
       ('rfq-files', 'selftest/a.pdf', 'a.pdf', 'application/pdf', 22, 'c0de0000-0000-4000-8000-0000000000a2'),
       ('rfq-files', 'selftest/b.pdf', 'b.pdf', 'application/pdf', 40, 'c0de0000-0000-4000-8000-0000000000a2');
     delete from public.rfqs where id = 'c0de0000-0000-4000-8000-0000000000a2';"
[ "$(sql "select count(*) from qtech_ops.pending_file_deletes")" = "2" ] || { echo "FAIL: the deleted record's files are not in the trash"; exit 1; }
[ "$(sql "select count(*) from storage.objects where name like 'selftest/%'")" = "3" ] || { echo "FAIL: deleting a record removed a file"; exit 1; }
echo "PASS: deleting a record lists its files in the trash and removes nothing"

# ---- purge: nothing is due inside 30 days
bash "$here/purge-trash.sh" | tee "$t/purge1.out"
grep -q 'nothing is due' "$t/purge1.out" || { echo "FAIL: purge ran early"; exit 1; }
[ "$(sql "select count(*) from storage.objects where name like 'selftest/%'")" = "3" ] || { echo "FAIL: purge removed a file inside the 30 days"; exit 1; }
echo "PASS: purge removes nothing inside the 30 days"

# ---- purge after 30 days: a.pdf goes, b.pdf was re-attached to another RFQ so it stays, c.pdf was never deleted
sql "insert into public.attachments (bucket, path, file_name, mime_type, size_bytes, rfq_id) values ('rfq-files', 'selftest/b.pdf', 'b.pdf', 'application/pdf', 40, 'c0de0000-0000-4000-8000-0000000000a3');
     update qtech_ops.pending_file_deletes set purge_after = now() - interval '1 day';"
bash "$here/purge-trash.sh" | tee "$t/purge2.out"
grep -q '1 removed from storage' "$t/purge2.out" || { echo "FAIL: purge did not remove exactly the due file"; exit 1; }
[ "$(sql "select count(*) from storage.objects where name = 'selftest/a.pdf'")" = "0" ] || { echo "FAIL: the due file is still in storage"; exit 1; }
[ "$(sql "select count(*) from storage.objects where name in ('selftest/b.pdf', 'selftest/c.pdf')")" = "2" ] || { echo "FAIL: purge removed a file it must keep"; exit 1; }
[ "$(sql "select count(*) from qtech_ops.pending_file_deletes")" = "0" ] || { echo "FAIL: the trash is not empty after the purge"; exit 1; }
echo "PASS: purge removed the due file, kept the re-attached one and the untouched one, and emptied the trash"

# ---- what the app reads
bash "$here/record-status.sh" backup 1234 5678 3 | grep -q 'status recorded'
bash "$here/record-status.sh" drill ok | grep -q 'status recorded'
[ "$(sql "select (last_backup_at > now() - interval '5 minutes' and last_backup_bytes = 1234 and last_storage_bytes = 5678 and last_storage_objects = 3 and last_drill_ok) from qtech_ops.backup_status")" = "t" ] || { echo "FAIL: the status was not recorded"; exit 1; }
if bash "$here/record-status.sh" backup 12x 1 1 > /dev/null 2>&1; then echo "FAIL: a non-number was accepted"; exit 1; fi
echo "PASS: the backup status is recorded for the app, and a bad value is refused"

# ---- clean up what this test added
s3 s3api delete-object --bucket rfq-files --key selftest/b.pdf > /dev/null || true
s3 s3api delete-object --bucket generated-docs --key selftest/c.pdf > /dev/null || true
echo "storage selftest ok"

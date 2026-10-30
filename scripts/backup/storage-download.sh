#!/usr/bin/env bash
# storage-download.sh OUTDIR: download every file of every Storage bucket into OUTDIR/files/<bucket>/<name>, then check that every
# object the database lists is there with the right size (storage-verify.sh). Writes OUTDIR/files.tsv (bucket, name, size) and
# OUTDIR/SHA256SUMS.
#
# Credentials: Supabase Storage S3 access keys (Dashboard, Storage, S3 Configuration, New access key). They reach Storage only: not
# the database, Auth or the REST API, which is why they are used here and the service-role key is not. Needs
# STORAGE_S3_ENDPOINT, STORAGE_S3_REGION, STORAGE_S3_ACCESS_KEY_ID, STORAGE_S3_SECRET_ACCESS_KEY, the PG* variables (to list the
# buckets and objects), and the aws CLI. Prints counts and sizes only, never a file name.
. "$(dirname "$0")/lib.sh"
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:?usage: storage-download.sh OUTDIR}"
mkdir -p "$out"; out="$(cd "$out" && pwd)"
s3_setup

# What the database says exists, taken BEFORE the download (a file uploaded meanwhile is not required to be in this backup).
pgx "$out" psql -X -At -F $'\t' -v ON_ERROR_STOP=1 -c "select bucket_id, name, coalesce(metadata ->> 'size', '0') from storage.objects where name not like '%/' order by bucket_id, name" > "$out/files.tsv"
buckets="$(pgx "$out" psql -X -At -v ON_ERROR_STOP=1 -c "select id from storage.buckets order by id")"

mkdir -p "$out/files"
n=0
for b in $buckets; do
  mkdir -p "$out/files/$b"
  s3 s3 sync --only-show-errors --no-progress "s3://$b" "$out/files/$b"
  n=$((n + 1))
done

bash "$here/storage-verify.sh" "$out"
( cd "$out/files" && find . -type f -print0 | sort -z | xargs -0 -r sha256sum ) > "$out/SHA256SUMS"
echo "storage download ok: $n buckets, $(wc -l < "$out/files.tsv" | tr -d ' ') files, $(du -sb "$out/files" | cut -f1) bytes"

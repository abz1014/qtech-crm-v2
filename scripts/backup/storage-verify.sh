#!/usr/bin/env bash
# storage-verify.sh DIR: DIR/files.tsv lists (bucket, name, size) what the database said existed when the download started;
# DIR/files/<bucket>/<name> must exist for every line, with that size. Prints counts only. Exit 1 when anything is missing or
# differs: a backup that silently lacks files is worse than no backup.
set -euo pipefail
dir="$(cd "${1:?usage: storage-verify.sh DIR}" && pwd)"
[ -f "$dir/files.tsv" ] || { echo "::error::no files.tsv in $dir"; exit 1; }
total=0; missing=0; wrong=0
while IFS=$'\t' read -r bucket name size; do
  [ -n "$bucket" ] || continue
  total=$((total + 1))
  f="$dir/files/$bucket/$name"
  if [ ! -f "$f" ]; then missing=$((missing + 1)); continue; fi
  [ "$(stat -c %s "$f")" = "$size" ] || wrong=$((wrong + 1))
done < "$dir/files.tsv"
if [ "$missing" -gt 0 ] || [ "$wrong" -gt 0 ]; then
  echo "::error::storage backup incomplete: $total files listed, $missing missing, $wrong with a different size"
  exit 1
fi
echo "storage verified: all $total listed files are present with the right size"

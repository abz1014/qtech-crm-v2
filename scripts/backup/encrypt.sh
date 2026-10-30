#!/usr/bin/env bash
# encrypt.sh DUMPDIR OUTFILE: tar + gzip DUMPDIR and encrypt it with age to the PUBLIC key in $BACKUP_AGE_RECIPIENT.
# The private key is never on the runner, so nobody holding the artifact can open it. Plain files are not touched here;
# the caller deletes them.
set -euo pipefail
dir="${1:?usage: encrypt.sh DUMPDIR OUTFILE}"; out="${2:?usage: encrypt.sh DUMPDIR OUTFILE}"
r="${BACKUP_AGE_RECIPIENT:-}"
[ -n "$r" ] || { echo "::error::BACKUP_AGE_RECIPIENT is empty"; exit 1; }
case "$r" in
  AGE-SECRET-KEY-*) echo "::error::BACKUP_AGE_RECIPIENT holds a PRIVATE key. Never put that in GitHub. Rotate it."; exit 1 ;;
esac
printf '%s' "$r" | grep -Eq '^age1[a-z0-9]{50,}$' || { echo "::error::BACKUP_AGE_RECIPIENT is not an age public key (age1...)"; exit 1; }
tar -C "$(dirname "$dir")" -cf - "$(basename "$dir")" | gzip -"${GZIP_LEVEL:-9}" | age -r "$r" -o "$out"
head -c 21 "$out" | grep -q '^age-encryption.org' || { echo "::error::output is not an age file"; exit 1; }
echo "encrypted: $(wc -c < "$out" | tr -d ' ') bytes"

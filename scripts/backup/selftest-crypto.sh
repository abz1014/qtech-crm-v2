#!/usr/bin/env bash
# Encrypt/decrypt round trip with a throwaway key. Needs `age` and `age-keygen` on PATH. No database, no network.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
t="$(mktemp -d)"; trap 'rm -rf "$t"' EXIT
mkdir -p "$t/bk"; head -c 50000 /dev/urandom > "$t/bk/public.dump"; printf 'x\t1\n' > "$t/bk/counts.tsv"
age-keygen -o "$t/key.txt" 2> "$t/pub.txt"
pub="$(grep -o 'age1[a-z0-9]*' "$t/pub.txt" | head -1)"
BACKUP_AGE_RECIPIENT="$pub" "$here/encrypt.sh" "$t/bk" "$t/out.age"

# 1. the file is encrypted: plain names are not in it
if grep -aq 'counts.tsv' "$t/out.age"; then echo "FAIL: plain file name visible in ciphertext"; exit 1; fi
# 2. the right key round-trips
mkdir "$t/open"; "$here/decrypt.sh" "$t/out.age" "$t/key.txt" "$t/open" > /dev/null
cmp "$t/bk/public.dump" "$t/open/bk/public.dump" && cmp "$t/bk/counts.tsv" "$t/open/bk/counts.tsv"
echo "PASS: round trip with the right key"
# 3. a different key cannot open it
age-keygen -o "$t/other.txt" 2> /dev/null
if "$here/decrypt.sh" "$t/out.age" "$t/other.txt" "$t/open2" > /dev/null 2>&1; then echo "FAIL: wrong key decrypted"; exit 1; fi
echo "PASS: a wrong key is refused"
# 4. a private key, an empty value and junk are refused as recipient
priv="$(grep -o 'AGE-SECRET-KEY-[A-Z0-9]*' "$t/key.txt" | head -1)"
for bad in "$priv" "" "not-a-key"; do
  if BACKUP_AGE_RECIPIENT="$bad" "$here/encrypt.sh" "$t/bk" "$t/bad.age" > /dev/null 2>&1; then echo "FAIL: accepted a bad recipient"; exit 1; fi
done
echo "PASS: private key, empty and malformed recipients are refused"
echo "crypto selftest ok"

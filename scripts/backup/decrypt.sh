#!/usr/bin/env bash
# decrypt.sh FILE.age KEYFILE [DESTDIR]: owner side. Decrypt and unpack a backup. KEYFILE is the private key from age-keygen.
# Result: DESTDIR/<backup folder>/{public.dump,authstorage.dump,counts.tsv,...}. Run on the owner's machine only.
set -euo pipefail
f="${1:?usage: decrypt.sh FILE.age KEYFILE [DESTDIR]}"; k="${2:?usage: decrypt.sh FILE.age KEYFILE [DESTDIR]}"; d="${3:-.}"
mkdir -p "$d"
age -d -i "$k" "$f" | tar -xz -C "$d"
echo "unpacked into $d"

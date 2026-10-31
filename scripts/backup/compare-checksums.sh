#!/usr/bin/env bash
# compare-checksums.sh DUMPDIR: recompute the money checksums and table hashes in the database named by the PG* variables and
# compare them with DUMPDIR/checksums.tsv (taken at dump time). Prints only the NAMES of lines that differ (never a value: a
# public CI log must not show sums); exit 1 on any difference. A dump made before checksums existed is skipped with a notice.
. "$(dirname "$0")/lib.sh"
dir="$(cd "${1:?usage: compare-checksums.sh DUMPDIR}" && pwd)"
if [ ! -s "$dir/checksums.tsv" ]; then echo "no checksums.tsv in this dump (made before R13b): skipped"; exit 0; fi
checksums "$dir" checksums.after.tsv
if diff -q "$dir/checksums.tsv" "$dir/checksums.after.tsv" > /dev/null; then
  echo "checksums ok: $(wc -l < "$dir/checksums.tsv" | tr -d ' ') lines (money sums, per-month counts, table hashes) all match"
else
  echo "::error::checksums differ after restore (these lines, values not shown):"
  join -t $'\t' -a1 -a2 -e MISSING -o 0,1.2,2.2 "$dir/checksums.tsv" "$dir/checksums.after.tsv" | awk -F'\t' '$2 != $3 {print "  " $1}'
  exit 1
fi

#!/usr/bin/env bash
# compare-counts.sh DUMPDIR: count rows in the database named by the PG* variables and compare with DUMPDIR/counts.tsv.
# Prints only the tables that differ (a public CI log must not show how much data there is); exit 1 on any difference.
. "$(dirname "$0")/lib.sh"
dir="$(cd "${1:?usage: compare-counts.sh DUMPDIR}" && pwd)"
row_counts "$dir" counts.after.tsv
if diff -q "$dir/counts.tsv" "$dir/counts.after.tsv" > /dev/null; then
  echo "restore ok: $(wc -l < "$dir/counts.tsv" | tr -d ' ') tables, every row count matches"
else
  echo "::error::row counts differ after restore (table, before, after):"
  join -t $'\t' -a1 -a2 -e MISSING -o 0,1.2,2.2 "$dir/counts.tsv" "$dir/counts.after.tsv" | awk -F'\t' '$2 != $3'
  exit 1
fi

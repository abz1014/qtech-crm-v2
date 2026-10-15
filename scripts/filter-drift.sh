#!/usr/bin/env bash
# Usage: filter-drift.sh <drift.sql> <allowlist.txt>
# Removes statements belonging to allowlisted platform-managed functions from
# `supabase db diff` output, prints what was removed (stderr), writes the
# remainder to stdout. Anything not allowlisted is passed through untouched.
set -euo pipefail
sql="${1:?drift sql file}"; list="${2:?allowlist file}"

names=$(sed -e 's/#.*//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' "$list" | grep -v '^$' | tr '\n' ' ' || true)

awk -v names="$names" '
function flush(   i, hdr, drop, n, parts, k, nm) {
  if (nstmt == 0) return
  hdr = first; gsub(/"/, "", hdr)
  drop = 0
  if (hdr ~ /^(CREATE (OR REPLACE )?FUNCTION|GRANT .* ON FUNCTION|REVOKE .* ON FUNCTION)/) {
    n = split(names, parts, " ")
    for (k = 1; k <= n; k++) {
      nm = parts[k]
      if (index(hdr, " " nm "(") > 0) drop = 1
    }
  }
  nout++
  if (drop) { filtered[nout] = 1; print "filtered: " first > "/dev/stderr" }
  body[nout] = buf; head[nout] = first
  buf = ""; first = ""; nstmt = 0
}
{
  line = $0; sub(/\r$/, "", line)
  if (!indollar && line ~ /^[[:space:]]*$/) { flush(); next }
  if (nstmt == 0) { first = line; nstmt = 1; buf = line }
  else buf = buf "\n" line
  # track $tag$ quoting (body may contain blank lines and semicolons)
  tmp = line; c = 0
  while (match(tmp, /\$[A-Za-z_]*\$/)) { c++; tmp = substr(tmp, RSTART + RLENGTH) }
  if (c % 2 == 1) indollar = !indollar
}
END {
  flush()
  keep = 0
  for (i = 1; i <= nout; i++)
    if (!filtered[i] && head[i] !~ /^SET (local )?check_function_bodies = off;$/) keep = 1
  for (i = 1; i <= nout; i++) {
    if (filtered[i]) continue
    if (head[i] ~ /^SET (local )?check_function_bodies = off;$/ && !keep) { print "filtered: " head[i] " (preamble, nothing else remains)" > "/dev/stderr"; continue }
    print body[i]; print ""
  }
}' "$sql"

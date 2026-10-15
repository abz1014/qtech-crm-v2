#!/usr/bin/env bash
# Tests scripts/filter-drift.sh against the real drift output from remote.yml run 38708549583.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
fx="$here/fixtures/drift-rls-auto-enable.sql"
list="$here/../supabase/drift-allowlist.txt"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
fail=0

# Case 1: allowlisted function alone -> nothing left.
"$here/filter-drift.sh" "$fx" "$list" > "$tmp/out1.sql" 2> "$tmp/err1.txt"
if grep -q '[^[:space:]]' "$tmp/out1.sql"; then echo "FAIL case 1: output not empty"; cat "$tmp/out1.sql"; fail=1
else echo "PASS case 1: allowlisted function alone is fully filtered"; fi
grep -q 'rls_auto_enable' "$tmp/err1.txt" || { echo "FAIL case 1: nothing reported as filtered"; fail=1; }

# Case 2: plus an unknown table -> only the table remains, and it is non-empty.
{ cat "$fx"; printf '\ncreate table "public"."surprise" (\n  "id" uuid not null\n\n);\n\n'; } > "$tmp/in2.sql"
"$here/filter-drift.sh" "$tmp/in2.sql" "$list" > "$tmp/out2.sql" 2> /dev/null
if grep -q 'surprise' "$tmp/out2.sql" && ! grep -q 'rls_auto_enable' "$tmp/out2.sql"; then echo "PASS case 2: unknown table survives, allowlisted function removed"
else echo "FAIL case 2"; cat "$tmp/out2.sql"; fail=1; fi

# Case 3: a function NOT on the allowlist is not filtered.
sed 's/rls_auto_enable/other_fn/g' "$fx" > "$tmp/in3.sql"
"$here/filter-drift.sh" "$tmp/in3.sql" "$list" > "$tmp/out3.sql" 2> /dev/null
if grep -q 'other_fn' "$tmp/out3.sql"; then echo "PASS case 3: non-allowlisted function is kept"; else echo "FAIL case 3"; fail=1; fi
exit $fail

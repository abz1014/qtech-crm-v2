#!/usr/bin/env bash
# find-pooler.sh: print the session-pooler host for the project, trying the known Supabase regions.
# Needs PGPASSWORD and SUPABASE_PROJECT_REF. Skipped when SUPABASE_POOLER_HOST is set (preferred: faster and exact).
# Why a pooler: on the Free plan the direct host db.<ref>.supabase.co is IPv6 only and GitHub runners have no IPv6.
set -uo pipefail
if [ -n "${SUPABASE_POOLER_HOST:-}" ]; then echo "$SUPABASE_POOLER_HOST"; exit 0; fi
ref="${SUPABASE_PROJECT_REF:?}"
regions="us-east-1 us-east-2 us-west-1 us-west-2 ca-central-1 sa-east-1 eu-west-1 eu-west-2 eu-west-3 eu-central-1 eu-central-2 eu-north-1 ap-south-1 ap-southeast-1 ap-southeast-2 ap-northeast-1 ap-northeast-2 me-central-1"
for prefix in aws-0 aws-1; do
  for r in $regions; do
    h="$prefix-$r.pooler.supabase.com"
    if PGCONNECT_TIMEOUT=5 psql -X -At -h "$h" -p 5432 -U "postgres.$ref" -d postgres -c 'select 1' > /dev/null 2>&1; then
      echo "$h"; exit 0
    fi
  done
done
echo "::error::no pooler host answered; set the SUPABASE_POOLER_HOST variable in the backup environment" >&2
exit 1

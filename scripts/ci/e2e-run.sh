#!/usr/bin/env bash
# Run the given E2E suites one after another against the local Supabase stack (already started, with the app built).
# The database is reset before every suite except the first (the stack is fresh) and except pwa (needs no database).
# A failing suite does not stop the rest; the script exits 1 at the end if any failed.
set -u
fail=0
first=1
case " $* " in *" rfq-quotation "*|*" orders "*|*" journeys "*|*" verify-sales "*|*" verify-quotes "*|*" verify-orders "*|*" verify-admin "*|*" hunt-workflows "*|*" hunt-workflows-sales "*|*" hunt-workflows-orders "*)
  command -v pdftoppm >/dev/null && command -v pdftotext >/dev/null || (sudo apt-get update -qq && sudo apt-get install -y -qq poppler-utils) ;;
esac
# P04: every suite runs under the production Content-Security-Policy (the preview server reads vercel.json, see vite.config.ts).
export E2E_CSP=1
# The perf suite drives the real Lighthouse; it is pinned here and is not a project dependency.
# It also measures what production serves (perf/lcp): Vercel answers over HTTPS and HTTP/2, and so does Supabase. A throwaway
# self-signed certificate (127.0.0.1 only) lets vite preview do the same, and an HTTPS, HTTP/2 proxy in front of the stack
# (scripts/ci/e2e-h2-proxy.mjs) stands in for Supabase's edge; the perf suite gets its own build that talks to that proxy.
case " $* " in *" perf "*)
  npm i --no-save --no-audit --no-fund lighthouse@12.8.2
  PERF_TLS="$(mktemp -d)"
  openssl req -x509 -newkey rsa:2048 -nodes -days 2 -keyout "$PERF_TLS/key.pem" -out "$PERF_TLS/cert.pem" \
    -subj "/CN=127.0.0.1" -addext "subjectAltName=IP:127.0.0.1" 2>/dev/null
  ;;
esac
# perf goes first in its shard: on the freshly booted stack, before other suites have warmed or loaded the runner, as when it runs
# alone. Behind other suites the Job page measured 2.53 s every time (limit 2.5 s); alone it measures about 2.3 s.
ordered=""; rest=""
for s in "$@"; do if [ "$s" = "perf" ]; then ordered="perf"; else rest="$rest $s"; fi; done
set -- $ordered $rest
for s in "$@"; do
  echo "::group::suite $s"
  if [ "$first" = 0 ] && [ "$s" != "pwa" ]; then npx supabase db reset --local || fail=1; fi
  first=0
  eval "$(npx supabase status -o env | sed 's/^/export /')"
  if [ "$s" = "perf" ]; then
    # 54390: clear of the stack's own ports (54321 API, 54322 database, 54323 studio, ...).
    nohup node scripts/ci/e2e-h2-proxy.mjs 54390 "$API_URL" "$PERF_TLS/key.pem" "$PERF_TLS/cert.pem" > "$PERF_TLS/proxy.log" 2>&1 &
    proxy=$!
    for _ in $(seq 1 40); do curl -sk -o /dev/null https://127.0.0.1:54390/ && break; sleep 0.25; done
    # Built as on Vercel: database requests go to the site's own /rest/v1/, which the preview server forwards to the stack
    # (vercel.json's rewrite; vite.config.ts, vercelRestRewrite).
    export E2E_SAME_ORIGIN_REST=1
    VITE_SUPABASE_URL=https://127.0.0.1:54390 VITE_SUPABASE_ANON_KEY="$ANON_KEY" npx vite build --outDir dist-perf --emptyOutDir > "$PERF_TLS/build.log" 2>&1 \
      || { cat "$PERF_TLS/build.log"; fail=1; }
    export E2E_TLS_KEY="$PERF_TLS/key.pem" E2E_TLS_CERT="$PERF_TLS/cert.pem" E2E_DIST=dist-perf E2E_APP_API_URL=https://127.0.0.1:54390
  fi
  E2E_SUITE=db REVIEW_DIR=review-shots PLAYWRIGHT_HTML_REPORT="playwright-report/$s" \
    npx playwright test --project="$s" --output="test-results/$s" || { echo "::error::suite $s failed"; fail=1; }
  if [ "$s" = "perf" ]; then
    kill "$proxy" 2>/dev/null || true
    cat "$PERF_TLS/proxy.log" || true
    unset E2E_TLS_KEY E2E_TLS_CERT E2E_DIST E2E_APP_API_URL E2E_SAME_ORIGIN_REST
  fi
  echo "::endgroup::"
done
exit $fail

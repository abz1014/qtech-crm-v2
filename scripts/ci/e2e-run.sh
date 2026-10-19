#!/usr/bin/env bash
# Run the given E2E suites one after another against the local Supabase stack (already started, with the app built).
# The database is reset before every suite except the first (the stack is fresh) and except pwa (needs no database).
# A failing suite does not stop the rest; the script exits 1 at the end if any failed.
set -u
fail=0
first=1
case " $* " in *" rfq-quotation "*|*" orders "*|*" journeys "*)
  command -v pdftoppm >/dev/null && command -v pdftotext >/dev/null || (sudo apt-get update -qq && sudo apt-get install -y -qq poppler-utils) ;;
esac
for s in "$@"; do
  echo "::group::suite $s"
  if [ "$first" = 0 ] && [ "$s" != "pwa" ]; then npx supabase db reset --local || fail=1; fi
  first=0
  eval "$(npx supabase status -o env | sed 's/^/export /')"
  E2E_SUITE=db REVIEW_DIR=review-shots PLAYWRIGHT_HTML_REPORT="playwright-report/$s" \
    npx playwright test --project="$s" --repeat-each=3 --retries=0 --output="test-results/$s" || { echo "::error::suite $s failed"; fail=1; }
  echo "::endgroup::"
done
exit $fail

#!/usr/bin/env bash
# Verifies every package with explicit exit codes. Never trust a grep count:
# when node_modules is absent, `npx tsc` prints an npm error containing no
# "error TS", so a broken package looks clean.
set -uo pipefail
cd /home/user/creatordna
export HOME=/home/user

PKGS=(shared prompts render api worker web)
FAIL=0

for p in "${PKGS[@]}"; do
  dir=""
  [ -d "packages/$p" ] && dir="packages/$p"
  [ -d "apps/$p" ] && dir="apps/$p"

  ( cd "$dir" && npx tsc --noEmit >/tmp/tsc-$p.log 2>&1 )
  T=$?
  ( cd "$dir" && npx eslint src --max-warnings=0 >/tmp/eslint-$p.log 2>&1 )
  E=$?
  ( cd "$dir" && npx vitest run >/tmp/vitest-$p.log 2>&1 )
  V=$?

  # Pull the test summary line out of the log.
  SUM=$(grep -E "Test Files|Tests +[0-9]" /tmp/vitest-$p.log | tail -2 | tr '\n' ' ')

  printf '%-8s tsc=%-3s eslint=%-3s vitest=%-3s | %s\n' "$p" "$T" "$E" "$V" "$SUM"
  [ "$T" -ne 0 ] && { echo "  --- tsc errors ---"; tail -15 /tmp/tsc-$p.log; FAIL=1; }
  [ "$E" -ne 0 ] && { echo "  --- eslint errors ---"; tail -15 /tmp/eslint-$p.log; FAIL=1; }
  [ "$V" -ne 0 ] && { echo "  --- vitest errors ---"; tail -25 /tmp/vitest-$p.log; FAIL=1; }
done

echo
[ "$FAIL" -eq 0 ] && echo "ALL GREEN" || echo "FAILURES PRESENT"
exit $FAIL

#!/usr/bin/env bash
# Smoke test a deployed URL: login page, security headers, auth gate, public verify page.
set -euo pipefail
U=${1:?usage: smoke.sh https://app}
U=${U%/}
fail() { echo "FAIL: $*"; exit 1; }
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
[ "$(code "$U/login")" = 200 ] || fail "login page"
H=$(curl -sI "$U/login")
echo "$H" | grep -qi "content-security-policy:.*frame-ancestors 'none'" || fail "CSP header"
echo "$H" | grep -qi "strict-transport-security" || fail "HSTS header"
echo "$H" | grep -qi "x-content-type-options: nosniff" || fail "nosniff"
[ "$(code "$U/pipeline")" = 307 ] || fail "pipeline should redirect to login"
[ "$(code "$U/api/audit/export")" = 401 ] || fail "audit export should need sign-in"
curl -s "$U/verify/000000000000000000000000" | grep -q "does not match any letter" || fail "verify page"
echo "Smoke test passed for $U"

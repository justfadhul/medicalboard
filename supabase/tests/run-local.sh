#!/usr/bin/env bash
# Runs migrations + RLS/workflow tests against a throwaway Postgres database.
# Usage: PGURL=postgres://postgres@localhost:5432/postgres bash supabase/tests/run-local.sh
set -euo pipefail
PGURL=${PGURL:-postgres://postgres:postgres@localhost:5432/postgres}
DB=umb_test_$$
psql "$PGURL" -qc "create database $DB" >/dev/null
trap 'psql "$PGURL" -qc "drop database if exists $DB" >/dev/null' EXIT
URL="${PGURL%/*}/$DB"
cd "$(dirname "$0")/.."
psql "$URL" -v ON_ERROR_STOP=1 -q -f tests/stub_supabase.sql
for f in migrations/*.sql; do psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null; done
psql "$URL" -v ON_ERROR_STOP=1 -q -f seed.sql >/dev/null
for t in tests/*.test.sql; do echo "== $t"; psql "$URL" -v ON_ERROR_STOP=1 -q -f "$t" >/dev/null; done
echo "All SQL tests passed"

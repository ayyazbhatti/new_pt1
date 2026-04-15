#!/usr/bin/env bash
# Prune `symbols` to only:
#   - rows with market = crypto (Binance universe), and
#   - rows whose code (case-insensitive) appears in MMDPS GET /feed/symbols (names[].name).
# All other symbol rows are deleted after removing dependent orders and positions.
#
# Requires: curl, jq, psql. Loads repo-root .env for DATABASE_URL and optional MMDPS_API_KEY.
#
# Usage:
#   ./scripts/prune-symbols-keep-crypto-and-mmdps-feed.sh           # execute
#   ./scripts/prune-symbols-keep-crypto-and-mmdps-feed.sh --dry-run # counts only
#
# Set MMDPS_SYMBOLS_URL if the key is not in the URL (default appends api_key from MMDPS_API_KEY).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$REPO_ROOT/.env"
  set +a
fi

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

if ! command -v curl >/dev/null || ! command -v jq >/dev/null || ! command -v psql >/dev/null; then
  echo "Need curl, jq, and psql on PATH." >&2
  exit 1
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is not set (e.g. in .env)." >&2
  exit 1
fi

MMDPS_BASE="${MMDPS_SYMBOLS_URL:-https://api.mmdps.uk/feed/symbols}"
if ! printf '%s' "$MMDPS_BASE" | grep -qi 'api_key='; then
  if [ -z "${MMDPS_API_KEY:-}" ]; then
    echo "Set MMDPS_API_KEY or include api_key= in MMDPS_SYMBOLS_URL." >&2
    exit 1
  fi
  FEED_URL="${MMDPS_BASE}?api_key=${MMDPS_API_KEY}"
else
  FEED_URL="$MMDPS_BASE"
fi

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

echo "Fetching MMDPS feed…" >&2
curl -fsS "$FEED_URL" -o "$TMP.json"
jq -e '.symbols | type == "array"' "$TMP.json" >/dev/null
jq -r '.symbols[].name' "$TMP.json" | sed '/^[[:space:]]*$/d' | awk '{ print toupper($0) }' | sort -u >"$TMP"

FEED_COUNT="$(wc -l <"$TMP" | tr -d ' ')"
echo "Unique feed codes: $FEED_COUNT" >&2

SQL_BODY=$(cat <<'EOSQL'
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE mmdps_feed (code text PRIMARY KEY);
COPY mmdps_feed (code) FROM STDIN;
EOSQL
)

if [ "$DRY_RUN" -eq 1 ]; then
  {
    echo "$SQL_BODY"
    cat "$TMP"
    printf '%s\n' '\.'
    cat <<'EOSQL'

-- Rows that would be removed (not crypto and not in MMDPS feed)
SELECT count(*) AS would_delete
FROM symbols s
WHERE NOT (
  s.market::text = 'crypto'
  OR upper(trim(s.code)) IN (SELECT code FROM mmdps_feed)
);

SELECT count(*) AS would_keep FROM symbols s
WHERE (
  s.market::text = 'crypto'
  OR upper(trim(s.code)) IN (SELECT code FROM mmdps_feed)
);

ROLLBACK;
EOSQL
  } | psql -v ON_ERROR_STOP=1 "$DATABASE_URL"
  echo "Dry run complete (transaction rolled back)." >&2
  exit 0
fi

{
  echo "$SQL_BODY"
  cat "$TMP"
  printf '%s\n' '\.'
  cat <<'EOSQL'

CREATE TEMP TABLE to_prune AS
SELECT s.id
FROM symbols s
WHERE NOT (
  s.market::text = 'crypto'
  OR upper(trim(s.code)) IN (SELECT code FROM mmdps_feed)
);

DELETE FROM orders o
USING to_prune t
WHERE o.symbol_id = t.id;

DELETE FROM positions p
USING to_prune t
WHERE p.symbol_id = t.id;

DELETE FROM symbols s
USING to_prune t
WHERE s.id = t.id;

SELECT count(*) AS remaining_symbols FROM symbols;

COMMIT;
EOSQL
} | psql -v ON_ERROR_STOP=1 "$DATABASE_URL"

echo "Done. Remaining symbol count printed above." >&2

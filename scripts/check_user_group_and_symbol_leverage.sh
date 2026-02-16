#!/usr/bin/env bash
# Check a user's group and the leverage profile assigned to a symbol for that group.
# Usage: ./check_user_group_and_symbol_leverage.sh [email] [symbol_code]
# Example: ./check_user_group_and_symbol_leverage.sh naja@mailinator.com BTCUSDT

EMAIL="${1:-naja@mailinator.com}"
SYMBOL_CODE="${2:-BTCUSDT}"

echo "User: $EMAIL"
echo "Symbol: $SYMBOL_CODE"
echo ""

# Load DATABASE_URL from auth-service .env if present
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/backend/auth-service/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  source "$ENV_FILE" 2>/dev/null || true
  set +a
fi

run_psql() {
  local sql="$1"
  if [ -n "$DATABASE_URL" ]; then
    psql "$DATABASE_URL" -t -A -c "$sql" 2>/dev/null
  else
    return 1
  fi
}

run_psql_multiline() {
  local sql="$1"
  if [ -n "$DATABASE_URL" ]; then
    psql "$DATABASE_URL" -c "$sql" 2>/dev/null
  else
    return 1
  fi
}

# Try DATABASE_URL first
if [ -n "$DATABASE_URL" ]; then
  echo "Using DATABASE_URL from .env"
  echo ""

  SQL_USER_GROUP="
    SELECT u.id, u.email, u.group_id, ug.name AS group_name
    FROM users u
    LEFT JOIN user_groups ug ON ug.id = u.group_id
    WHERE LOWER(u.email) = LOWER('$EMAIL');
  "
  RESULT=$(run_psql_multiline "$SQL_USER_GROUP")
  if [ -z "$RESULT" ] || echo "$RESULT" | grep -q "0 rows"; then
    echo "User not found: $EMAIL"
    exit 1
  fi
  echo "=== User & Group ==="
  echo "$RESULT"
  echo ""

  # Get group_id for the user
  GROUP_ID=$(run_psql "SELECT group_id::text FROM users WHERE LOWER(email) = LOWER('$EMAIL');" | head -1 | tr -d ' ')
  if [ -z "$GROUP_ID" ] || [ "$GROUP_ID" = "" ] || [ "$GROUP_ID" = "NULL" ]; then
    echo "User has no group assigned."
    exit 0
  fi

  # Leverage profile for this group + symbol (same logic as list_group_symbols: COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id))
  SQL_LEVERAGE="
    SELECT
      s.code AS symbol_code,
      COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id) AS leverage_profile_id,
      (SELECT lp2.name FROM leverage_profiles lp2 WHERE lp2.id = COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id)) AS leverage_profile_name
    FROM symbols s
    CROSS JOIN user_groups ug
    LEFT JOIN group_symbols gs ON gs.symbol_id = s.id AND gs.group_id = ug.id
    WHERE ug.id = '$GROUP_ID' AND s.code = '$SYMBOL_CODE';
  "
  echo "=== Leverage profile for $SYMBOL_CODE in this group ==="
  run_psql_multiline "$SQL_LEVERAGE"
  exit 0
fi

# Fallback: try Docker containers (same as check_user_filled_orders.sh)
echo "DATABASE_URL not set. Trying Docker containers..."
for CONTAINER in trading-postgres tpc-postgres-dev postgres; do
  if docker ps --format "{{.Names}}" | grep -q "^${CONTAINER}$"; then
    for DB in newpt trading_platform tpc; do
      for DB_USER in postgres tpc_user; do
        FOUND=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB" -t -A -c "SELECT u.id FROM users u WHERE LOWER(u.email) = LOWER('$EMAIL');" 2>/dev/null | head -1 | tr -d ' ')
        if [ -n "$FOUND" ]; then
          echo "Found user in $CONTAINER / $DB"
          echo "=== User & Group ==="
          docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB" -c "
            SELECT u.id, u.email, u.group_id, ug.name AS group_name
            FROM users u
            LEFT JOIN user_groups ug ON ug.id = u.group_id
            WHERE LOWER(u.email) = LOWER('$EMAIL');
          " 2>/dev/null
          GROUP_ID=$(docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB" -t -A -c "SELECT group_id::text FROM users WHERE LOWER(email) = LOWER('$EMAIL');" 2>/dev/null | head -1 | tr -d ' ')
          if [ -z "$GROUP_ID" ] || [ "$GROUP_ID" = "NULL" ]; then
            echo "User has no group."
            exit 0
          fi
          echo ""
          echo "=== Leverage profile for $SYMBOL_CODE in this group ==="
          docker exec "$CONTAINER" psql -U "$DB_USER" -d "$DB" -c "
            SELECT
              s.code AS symbol_code,
              COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id) AS leverage_profile_id,
              (SELECT lp2.name FROM leverage_profiles lp2 WHERE lp2.id = COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id)) AS leverage_profile_name
            FROM symbols s
            CROSS JOIN user_groups ug
            LEFT JOIN group_symbols gs ON gs.symbol_id = s.id AND gs.group_id = ug.id
            WHERE ug.id = '$GROUP_ID' AND s.code = '$SYMBOL_CODE';
          " 2>/dev/null
          exit 0
        fi
      done
    done
  fi
done

echo "User not found or DATABASE_URL not set. Set backend/auth-service/.env DATABASE_URL or run with Docker."
exit 1

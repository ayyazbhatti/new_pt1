#!/usr/bin/env bash
# Run migration 0009 (user_groups profile columns) then rebuild and restart auth-service.
# Requires: PostgreSQL running, DATABASE_URL set (or .env in backend/auth-service).

set -e
cd "$(dirname "$0")/.."

# Load .env from auth-service if present
if [ -f backend/auth-service/.env ]; then
  set -a
  source backend/auth-service/.env
  set +a
fi
export DATABASE_URL="${DATABASE_URL:-postgresql://postgres:postgres@localhost:5432/newpt}"

echo "==> Running migration 0009_user_groups_profile_ids.sql ..."
psql "$DATABASE_URL" -f database/migrations/0009_user_groups_profile_ids.sql
echo "==> Migration done."

echo "==> Building auth-service ..."
cd backend/auth-service
cargo build --bin auth-service
echo "==> Build done. Restart auth-service (e.g. cargo run --bin auth-service or your usual command)."

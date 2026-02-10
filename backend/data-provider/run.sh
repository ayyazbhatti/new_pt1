#!/bin/bash
# Data Provider Server Startup Script

set -e

# Load environment variables from .env if it exists
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Set defaults
export REDIS_URL=${REDIS_URL:-redis://127.0.0.1:6379}
export FEED_PROVIDER=${FEED_PROVIDER:-binance}
export SERVER_REGION=${SERVER_REGION:-asia-1}
export MAX_CONNECTIONS=${MAX_CONNECTIONS:-200000}
export WS_PORT=${WS_PORT:-9001}
export HTTP_PORT=${HTTP_PORT:-9002}
export ADMIN_SECRET_KEY=${ADMIN_SECRET_KEY:-change-me-in-production}
export BINANCE_WS_URL=${BINANCE_WS_URL:-wss://stream.binance.com:9443/ws}

echo "🚀 Starting Data Provider Server..."
echo "   Redis: $REDIS_URL"
echo "   WebSocket Port: $WS_PORT"
echo "   HTTP Port: $HTTP_PORT"
echo "   Region: $SERVER_REGION"
echo ""

# Run in release mode for production performance
cargo run --release


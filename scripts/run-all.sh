#!/bin/bash

# Script to run all services in development

echo "Starting Trading Platform Services..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "⚠️  WARNING: Docker is not running!"
    echo "   Some services (core-api) require Postgres, Redis, and NATS."
    echo "   Start infrastructure with: ./scripts/start-infra.sh"
    echo ""
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

echo ""

# Start services in background
echo "Starting data-provider..."
cargo run -p data-provider &
DATA_PROVIDER_PID=$!

sleep 2

echo "Starting order-engine..."
cargo run -p order-engine &
ORDER_ENGINE_PID=$!

sleep 2

echo "Starting core-api..."
cargo run -p core-api &
CORE_API_PID=$!

sleep 2

echo "Starting gateway-ws..."
cargo run -p gateway-ws &
GATEWAY_WS_PID=$!

echo ""
echo "All services started!"
echo "Data Provider: http://localhost:3001/health"
echo "Order Engine: http://localhost:3002/health"
echo "Core API: http://localhost:3004/health"
echo "Gateway WS: ws://localhost:3003/ws"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for interrupt
trap "kill $DATA_PROVIDER_PID $ORDER_ENGINE_PID $CORE_API_PID $GATEWAY_WS_PID; exit" INT
wait


#!/bin/bash

# Script to start infrastructure services (Redis, NATS)

echo "🚀 Starting Infrastructure Services..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running!"
    echo ""
    echo "Please start Docker Desktop and try again."
    echo "On macOS: Open Docker Desktop application"
    echo "On Linux: sudo systemctl start docker"
    echo ""
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Navigate to infra directory
cd "$(dirname "$0")/../infra" || exit 1

# Start services
echo "Starting Redis and NATS (Postgres is external: newpt-postgres on 5433)..."
docker-compose up -d redis nats

# Wait for services to be ready
echo ""
echo "⏳ Waiting for services to be ready..."
sleep 3

# Check service status
echo ""
echo "=== Service Status ==="
docker-compose ps

echo ""
echo "✅ Infrastructure services started!"
echo ""
echo "Services:"
echo "  - Postgres: localhost:5433 (newpt-postgres container)"
echo "  - Redis: localhost:6379"
echo "  - NATS: localhost:4222"
echo "  - NATS Monitoring: http://localhost:8222"


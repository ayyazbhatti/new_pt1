#!/bin/bash

# Script to setup newpt database properly
# This ensures only newpt database is used for this project

set -e

echo "🔧 Setting up newpt database..."
echo ""

# Check if trading-postgres is running
if docker ps --format "{{.Names}}" | grep -q "^trading-postgres$"; then
    echo "✅ trading-postgres is already running"
else
    echo "⚠️  trading-postgres is not running"
    
    # Check if port 5432 is in use
    if lsof -i :5432 >/dev/null 2>&1; then
        echo "⚠️  Port 5432 is in use. Checking what's using it..."
        
        # Check if tpc-postgres-dev is using it
        if docker ps --format "{{.Names}}" | grep -q "^tpc-postgres-dev$"; then
            echo "⚠️  tpc-postgres-dev is using port 5432"
            echo "   This is a different project's database container"
            echo "   Stopping it to start trading-postgres..."
            docker stop tpc-postgres-dev
            sleep 2
            echo "✅ tpc-postgres-dev stopped"
        fi
    fi
    
    echo "🚀 Starting trading-postgres container..."
    cd "$(dirname "$0")/.."
    docker-compose -f infra/docker-compose.yml up -d postgres
    
    echo "⏳ Waiting for PostgreSQL to be ready..."
    sleep 5
    
    # Wait for postgres to be ready
    for i in {1..30}; do
        if docker exec trading-postgres pg_isready -U postgres >/dev/null 2>&1; then
            echo "✅ PostgreSQL is ready!"
            break
        fi
        echo "   Waiting... ($i/30)"
        sleep 1
    done
fi

# Check if newpt database exists
echo ""
echo "🔍 Checking newpt database..."
DB_EXISTS=$(docker exec trading-postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='newpt'" 2>/dev/null || echo "0")

if [ "$DB_EXISTS" = "1" ]; then
    echo "✅ newpt database exists"
else
    echo "📦 Creating newpt database..."
    docker exec trading-postgres psql -U postgres -c "CREATE DATABASE newpt;" 2>&1
fi

# Check if schema is applied
echo ""
echo "🔍 Checking if schema is applied..."
TABLE_COUNT=$(docker exec trading-postgres psql -U postgres -d newpt -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null || echo "0")

if [ "$TABLE_COUNT" -gt 0 ]; then
    echo "✅ Schema appears to be applied ($TABLE_COUNT tables found)"
    echo ""
    echo "📊 Current tables:"
    docker exec trading-postgres psql -U postgres -d newpt -c "\dt" 2>&1 | head -20
else
    echo "⚠️  No tables found. Applying schema..."
    echo ""
    
    SCHEMA_FILE="$(dirname "$0")/../database/schema.sql"
    if [ ! -f "$SCHEMA_FILE" ]; then
        echo "❌ Schema file not found: $SCHEMA_FILE"
        exit 1
    fi
    
    echo "📄 Applying schema from: $SCHEMA_FILE"
    docker exec -i trading-postgres psql -U postgres -d newpt < "$SCHEMA_FILE"
    
    echo ""
    echo "✅ Schema applied successfully!"
    echo ""
    echo "📊 Tables created:"
    docker exec trading-postgres psql -U postgres -d newpt -c "\dt" 2>&1 | head -20
fi

echo ""
echo "✅ newpt database setup complete!"
echo ""
echo "📋 Connection details:"
echo "   Host: localhost"
echo "   Port: 5432"
echo "   Database: newpt"
echo "   User: postgres"
echo "   Password: postgres"
echo "   Connection String: postgresql://postgres:postgres@localhost:5432/newpt"
echo ""


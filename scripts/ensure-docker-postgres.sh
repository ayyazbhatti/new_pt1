#!/bin/bash

# Script to ensure Docker PostgreSQL is running and local PostgreSQL doesn't interfere
# This is the standard database for this project

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_info() {
    echo -e "${GREEN}ℹ️  $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

echo "🔧 Ensuring Docker PostgreSQL is ready for this project..."
echo ""

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

# Check if local PostgreSQL is running on port 5432
if pg_isready -h localhost -U postgres >/dev/null 2>&1; then
    # Check if it's actually Docker PostgreSQL
    if ! docker ps --format "{{.Names}}" | grep -q "^trading-postgres$"; then
        print_warning "Local PostgreSQL is running on port 5432"
        print_warning "This project uses Docker PostgreSQL (trading-postgres)"
        echo ""
        print_info "Options:"
        echo "  1. Stop local PostgreSQL:"
        echo "     brew services stop postgresql@14  (or your version)"
        echo "     OR"
        echo "     pg_ctl -D /usr/local/var/postgres stop"
        echo ""
        echo "  2. Use a different port for local PostgreSQL"
        echo ""
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Exiting. Please stop local PostgreSQL or choose a different port."
            exit 1
        fi
    fi
fi

# Start Docker PostgreSQL if not running
if ! docker ps --format "{{.Names}}" | grep -q "^trading-postgres$"; then
    print_info "Starting Docker PostgreSQL container..."
    cd "$(dirname "$0")/.."
    docker-compose -f infra/docker-compose.yml up -d postgres
    
    print_info "Waiting for PostgreSQL to be ready..."
    for i in {1..30}; do
        if docker exec trading-postgres pg_isready -U postgres >/dev/null 2>&1; then
            print_success "Docker PostgreSQL is ready!"
            break
        fi
        if [ $i -eq 30 ]; then
            print_error "PostgreSQL did not become ready in time"
            exit 1
        fi
        sleep 1
    done
else
    print_success "Docker PostgreSQL (trading-postgres) is already running"
fi

# Verify connection
if docker exec trading-postgres psql -U postgres -d newpt -c "SELECT 1;" >/dev/null 2>&1; then
    print_success "Database 'newpt' is accessible"
    echo ""
    print_info "Connection details:"
    echo "  Host: localhost"
    echo "  Port: 5432"
    echo "  Database: newpt"
    echo "  User: postgres"
    echo "  Password: postgres"
    echo "  Connection String: postgresql://postgres:postgres@localhost:5432/newpt"
    echo ""
    print_success "✅ Docker PostgreSQL is ready!"
else
    print_warning "Database 'newpt' might not exist yet"
    print_info "Run: ./scripts/setup-newpt-database.sh to create it"
fi


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

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Replace container if it was created with a different host port (e.g. legacy 5433).
if docker ps -a --format "{{.Names}}" | grep -q "^newpt-postgres$"; then
    host_port="$(docker inspect newpt-postgres --format '{{if index .HostConfig.PortBindings "5432/tcp"}}{{with index (index .HostConfig.PortBindings "5432/tcp") 0}}{{.HostPort}}{{end}}{{end}}' 2>/dev/null || true)"
    if [ "$host_port" != "5434" ]; then
        print_warning "Removing newpt-postgres (host port was '${host_port:-unset}', expected 5434)..."
        docker rm -f newpt-postgres >/dev/null 2>&1 || true
    fi
fi

# Start Docker PostgreSQL if not running
if ! docker ps --format "{{.Names}}" | grep -q "^newpt-postgres$"; then
    if docker ps -a --format "{{.Names}}" | grep -q "^newpt-postgres$"; then
        print_info "Starting Docker PostgreSQL container (newpt-postgres)..."
        docker start newpt-postgres >/dev/null
    else
        print_info "Creating newpt-postgres from infra/docker-compose.yml (host port 5434)..."
        (cd "$REPO_ROOT/infra" && (docker compose up -d postgres 2>/dev/null || docker-compose up -d postgres)) || {
            print_error "Failed to start Postgres (is host port 5434 already in use?)."
            exit 1
        }
    fi

    print_info "Waiting for PostgreSQL to be ready..."
    for i in {1..30}; do
        if docker exec newpt-postgres pg_isready -U postgres >/dev/null 2>&1; then
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
    print_success "Docker PostgreSQL (newpt-postgres) is already running"
fi

# Verify connection
if docker exec newpt-postgres psql -U postgres -d newpt -c "SELECT 1;" >/dev/null 2>&1; then
    print_success "Database 'newpt' is accessible"
    echo ""
    print_info "Connection details:"
    echo "  Host: localhost"
    echo "  Port: 5434"
    echo "  Database: newpt"
    echo "  User: postgres"
    echo "  Password: postgres"
    echo "  Connection String: postgresql://postgres:postgres@localhost:5434/newpt"
    echo ""
    print_success "✅ Docker PostgreSQL is ready!"
else
    print_warning "Database 'newpt' might not exist yet"
    print_info "Run: ./scripts/setup-newpt-database.sh to create it"
fi


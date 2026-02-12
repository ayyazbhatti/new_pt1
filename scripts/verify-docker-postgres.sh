#!/bin/bash

# Verification script to ensure project is configured for Docker PostgreSQL

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

echo "🔍 Verifying Docker PostgreSQL Configuration"
echo "=============================================="
echo ""

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_ROOT}"

ERRORS=0
WARNINGS=0

# 1. Check Docker Compose Configuration
print_info "1. Checking docker-compose.yml..."
if [ -f "infra/docker-compose.yml" ]; then
    if grep -q "container_name: trading-postgres" infra/docker-compose.yml; then
        print_success "Docker Compose configured with trading-postgres"
    else
        print_error "Docker Compose missing trading-postgres container"
        ((ERRORS++))
    fi
    
    if grep -q "POSTGRES_DB: newpt" infra/docker-compose.yml; then
        print_success "Database name set to 'newpt'"
    else
        print_error "Database name not set to 'newpt'"
        ((ERRORS++))
    fi
else
    print_error "docker-compose.yml not found"
    ((ERRORS++))
fi

# 2. Check Docker PostgreSQL Container
print_info ""
print_info "2. Checking Docker PostgreSQL container..."
if docker ps --format "{{.Names}}" | grep -q "^trading-postgres$"; then
    print_success "Docker PostgreSQL container is running"
    
    # Check if database is accessible
    if docker exec trading-postgres psql -U postgres -d newpt -c "SELECT 1;" >/dev/null 2>&1; then
        print_success "Database 'newpt' is accessible"
    else
        print_warning "Database 'newpt' might not exist"
        ((WARNINGS++))
    fi
else
    print_warning "Docker PostgreSQL container is not running"
    print_info "   Run: docker-compose -f infra/docker-compose.yml up -d postgres"
    ((WARNINGS++))
fi

# 3. Check Scripts Configuration
print_info ""
print_info "3. Checking scripts configuration..."

# Check start-all-servers.sh
if grep -q "postgresql://postgres:postgres@localhost:5432/newpt" scripts/start-all-servers.sh; then
    print_success "start-all-servers.sh uses Docker PostgreSQL connection string"
else
    print_error "start-all-servers.sh missing Docker PostgreSQL connection string"
    ((ERRORS++))
fi

# Check ensure-docker-postgres.sh exists
if [ -f "scripts/ensure-docker-postgres.sh" ]; then
    print_success "ensure-docker-postgres.sh exists"
    
    if grep -q "trading-postgres" scripts/ensure-docker-postgres.sh; then
        print_success "ensure-docker-postgres.sh references trading-postgres"
    else
        print_warning "ensure-docker-postgres.sh might not be configured correctly"
        ((WARNINGS++))
    fi
else
    print_error "ensure-docker-postgres.sh not found"
    ((ERRORS++))
fi

# Check if start-all-servers.sh calls ensure-docker-postgres.sh
if grep -q "ensure-docker-postgres.sh" scripts/start-all-servers.sh; then
    print_success "start-all-servers.sh calls ensure-docker-postgres.sh"
else
    print_warning "start-all-servers.sh doesn't call ensure-docker-postgres.sh"
    ((WARNINGS++))
fi

# 4. Check Backup/Restore Scripts
print_info ""
print_info "4. Checking backup/restore scripts..."

if [ -f "scripts/backup-project.sh" ]; then
    if grep -q "newpt_docker" scripts/backup-project.sh; then
        print_success "backup-project.sh prioritizes Docker PostgreSQL"
    else
        print_warning "backup-project.sh might not prioritize Docker PostgreSQL"
        ((WARNINGS++))
    fi
else
    print_warning "backup-project.sh not found"
    ((WARNINGS++))
fi

if [ -f "scripts/restore-project.sh" ]; then
    if grep -q "trading-postgres" scripts/restore-project.sh; then
        print_success "restore-project.sh uses Docker PostgreSQL"
    else
        print_warning "restore-project.sh might not use Docker PostgreSQL"
        ((WARNINGS++))
    fi
else
    print_warning "restore-project.sh not found"
    ((WARNINGS++))
fi

# 5. Check for Local PostgreSQL Conflicts
print_info ""
print_info "5. Checking for local PostgreSQL conflicts..."

if command -v pg_isready &> /dev/null; then
    if pg_isready -h localhost -U postgres >/dev/null 2>&1; then
        # Check if it's actually Docker PostgreSQL
        if docker ps --format "{{.Names}}" | grep -q "^trading-postgres$"; then
            print_success "Port 5432 is used by Docker PostgreSQL (correct)"
        else
            print_warning "Local PostgreSQL detected on port 5432"
            print_info "   This might conflict with Docker PostgreSQL"
            print_info "   Consider stopping local PostgreSQL: brew services stop postgresql@14"
            ((WARNINGS++))
        fi
    else
        print_success "No PostgreSQL detected on port 5432 (Docker will use it)"
    fi
else
    print_info "pg_isready not available, skipping local PostgreSQL check"
fi

# 6. Check Documentation
print_info ""
print_info "6. Checking documentation..."

if [ -f "DOCKER_POSTGRES_SETUP.md" ]; then
    print_success "DOCKER_POSTGRES_SETUP.md exists"
else
    print_warning "DOCKER_POSTGRES_SETUP.md not found"
    ((WARNINGS++))
fi

# Summary
echo ""
echo "=============================================="
echo "Verification Summary"
echo "=============================================="

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    print_success "All checks passed! Project is configured for Docker PostgreSQL."
    exit 0
elif [ $ERRORS -eq 0 ]; then
    print_warning "Configuration is mostly correct, but there are $WARNINGS warning(s)"
    print_info "Review the warnings above"
    exit 0
else
    print_error "Found $ERRORS error(s) and $WARNINGS warning(s)"
    print_info "Please fix the errors above"
    exit 1
fi


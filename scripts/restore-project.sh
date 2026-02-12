#!/bin/bash

# Project Restore Script
# This script restores a project backup created by backup-project.sh

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
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

# Check if backup name provided
if [ -z "$1" ]; then
    print_error "Usage: $0 <backup_name>"
    echo ""
    echo "Available backups:"
    ls -1 "${BACKUP_DIR}" 2>/dev/null | grep -E "^project_backup_" || echo "  No backups found"
    exit 1
fi

BACKUP_NAME="$1"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

# Check if backup exists
if [ -f "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" ]; then
    print_info "Found compressed backup, extracting..."
    cd "${BACKUP_DIR}"
    tar -xzf "${BACKUP_NAME}.tar.gz" || {
        print_error "Failed to extract backup archive"
        exit 1
    }
    print_success "Backup extracted"
fi

if [ ! -d "${BACKUP_PATH}" ]; then
    print_error "Backup directory not found: ${BACKUP_PATH}"
    exit 1
fi

# Get project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_ROOT}"

print_info "Project root: ${PROJECT_ROOT}"
print_info "Restoring from: ${BACKUP_PATH}"

# ============================================================
# 1. Restore Database
# ============================================================
print_info "Step 1: Restoring database..."

DB_BACKUP_DIR="${BACKUP_PATH}/database"

# Prioritize Docker PostgreSQL (project standard)
# Check which database backup is available
if [ -f "${DB_BACKUP_DIR}/newpt_docker.dump" ]; then
    print_info "Found Docker PostgreSQL backup (custom format)"
    
    if docker ps --format "{{.Names}}" | grep -q "trading-postgres"; then
        print_info "Restoring to Docker PostgreSQL..."
        
        # Copy dump to container
        docker cp "${DB_BACKUP_DIR}/newpt_docker.dump" trading-postgres:/tmp/restore.dump
        
        # Drop and recreate database
        docker exec trading-postgres psql -U postgres -c "DROP DATABASE IF EXISTS newpt;"
        docker exec trading-postgres psql -U postgres -c "CREATE DATABASE newpt;"
        
        # Restore
        docker exec trading-postgres pg_restore -U postgres -d newpt --verbose /tmp/restore.dump || {
            print_error "Failed to restore database"
            exit 1
        }
        
        # Clean up
        docker exec trading-postgres rm -f /tmp/restore.dump
        
        print_success "Database restored to Docker PostgreSQL"
    else
        print_error "Docker PostgreSQL container not running!"
        print_info "Start Docker PostgreSQL: docker-compose -f infra/docker-compose.yml up -d postgres"
        print_warning "Skipping Docker restore - please start Docker PostgreSQL first"
    fi
elif [ -f "${DB_BACKUP_DIR}/newpt_docker.sql" ]; then
    print_info "Found Docker PostgreSQL backup (SQL format)"
    
    if docker ps --format "{{.Names}}" | grep -q "trading-postgres"; then
        print_info "Restoring to Docker PostgreSQL..."
        
        # Drop and recreate database
        docker exec trading-postgres psql -U postgres -c "DROP DATABASE IF EXISTS newpt;"
        docker exec trading-postgres psql -U postgres -c "CREATE DATABASE newpt;"
        
        # Restore
        docker exec -i trading-postgres psql -U postgres -d newpt < "${DB_BACKUP_DIR}/newpt_docker.sql" || {
            print_error "Failed to restore database"
            exit 1
        }
        
        print_success "Database restored to Docker PostgreSQL"
    else
        print_error "Docker PostgreSQL container not running!"
        print_info "Start Docker PostgreSQL: docker-compose -f infra/docker-compose.yml up -d postgres"
        print_warning "Skipping Docker restore - please start Docker PostgreSQL first"
    fi
elif [ -f "${DB_BACKUP_DIR}/newpt_local.dump" ]; then
    print_info "Found local PostgreSQL backup (custom format)"
    
    if command -v pg_restore &> /dev/null; then
        print_info "Restoring to local PostgreSQL..."
        
        # Drop and recreate database
        PGPASSWORD=postgres psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS newpt;" 2>/dev/null || true
        PGPASSWORD=postgres psql -h localhost -U postgres -c "CREATE DATABASE newpt;" 2>/dev/null || true
        
        # Restore
        PGPASSWORD=postgres pg_restore -h localhost -U postgres -d newpt --verbose "${DB_BACKUP_DIR}/newpt_local.dump" || {
            print_error "Failed to restore database"
            exit 1
        }
        
        print_success "Database restored to local PostgreSQL"
    else
        print_warning "pg_restore not available, skipping local restore"
    fi
elif [ -f "${DB_BACKUP_DIR}/newpt_local.sql" ]; then
    print_info "Found local PostgreSQL backup (SQL format)"
    
    if command -v psql &> /dev/null; then
        print_info "Restoring to local PostgreSQL..."
        
        # Drop and recreate database
        PGPASSWORD=postgres psql -h localhost -U postgres -c "DROP DATABASE IF EXISTS newpt;" 2>/dev/null || true
        PGPASSWORD=postgres psql -h localhost -U postgres -c "CREATE DATABASE newpt;" 2>/dev/null || true
        
        # Restore
        PGPASSWORD=postgres psql -h localhost -U postgres -d newpt < "${DB_BACKUP_DIR}/newpt_local.sql" || {
            print_error "Failed to restore database"
            exit 1
        }
        
        print_success "Database restored to local PostgreSQL"
    else
        print_warning "psql not available, skipping local restore"
    fi
else
    print_warning "No database backup found, skipping database restore"
fi

# ============================================================
# 2. Restore Source Code
# ============================================================
print_info "Step 2: Restoring source code..."

CODE_BACKUP_DIR="${BACKUP_PATH}/code"

if [ -d "${CODE_BACKUP_DIR}" ]; then
    print_warning "This will overwrite existing files. Continue? (y/N)"
    read -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Skipping source code restore"
    else
        # Restore directories
        for dir in apps backend crates src database infra scripts; do
            if [ -d "${CODE_BACKUP_DIR}/${dir}" ]; then
                print_info "Restoring ${dir}/..."
                rm -rf "${PROJECT_ROOT}/${dir}" 2>/dev/null || true
                cp -r "${CODE_BACKUP_DIR}/${dir}" "${PROJECT_ROOT}/" 2>/dev/null || {
                    print_warning "Failed to restore ${dir}/"
                }
            fi
        done
        
        # Restore root files
        print_info "Restoring root files..."
        cp "${CODE_BACKUP_DIR}"/*.toml "${PROJECT_ROOT}/" 2>/dev/null || true
        cp "${CODE_BACKUP_DIR}"/*.lock "${PROJECT_ROOT}/" 2>/dev/null || true
        cp "${CODE_BACKUP_DIR}"/*.md "${PROJECT_ROOT}/" 2>/dev/null || true
        
        print_success "Source code restored"
    fi
else
    print_warning "Source code backup not found, skipping"
fi

# ============================================================
# 3. Summary
# ============================================================
print_success "Restore completed!"
echo ""
echo "Next steps:"
echo "1. Review restored files"
echo "2. Update .env files if needed"
echo "3. Run migrations if database was restored:"
echo "   docker exec trading-postgres psql -U postgres -d newpt -f database/schema.sql"
echo "4. Restart services"


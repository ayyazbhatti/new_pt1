#!/bin/bash

# Full Project Backup Script
# This script creates a complete backup of the project including:
# - Database (PostgreSQL dump)
# - All source code
# - Migration files
# - Configuration files
# - Docker volumes (if applicable)

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="project_backup_${TIMESTAMP}"
BACKUP_PATH="${BACKUP_DIR}/${BACKUP_NAME}"

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

# Create backup directory
mkdir -p "${BACKUP_PATH}"
print_info "Created backup directory: ${BACKUP_PATH}"

# Get project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_ROOT}"

print_info "Project root: ${PROJECT_ROOT}"
print_info "Starting backup process..."

# ============================================================
# 1. Database Backup
# ============================================================
print_info "Step 1: Backing up database..."

DB_BACKUP_DIR="${BACKUP_PATH}/database"
mkdir -p "${DB_BACKUP_DIR}"

# Try to backup from Docker PostgreSQL first (project standard)
if docker ps --format "{{.Names}}" | grep -q "trading-postgres"; then
    print_info "Backing up Docker PostgreSQL database 'newpt'..."
    docker exec trading-postgres pg_dump -U postgres -d newpt \
        --format=custom \
        --file="/tmp/newpt_docker.dump" 2>&1 | tee "${DB_BACKUP_DIR}/newpt_docker.log" || {
        print_warning "Custom format failed, trying SQL format..."
        docker exec trading-postgres pg_dump -U postgres -d newpt \
            --format=plain \
            --file="/tmp/newpt_docker.sql" 2>&1 | tee -a "${DB_BACKUP_DIR}/newpt_docker.log"
    }
    
    # Copy dump file from container
    if docker exec trading-postgres test -f "/tmp/newpt_docker.dump"; then
        docker cp trading-postgres:/tmp/newpt_docker.dump "${DB_BACKUP_DIR}/newpt_docker.dump"
        print_success "Docker PostgreSQL backup completed (custom format)"
    elif docker exec trading-postgres test -f "/tmp/newpt_docker.sql"; then
        docker cp trading-postgres:/tmp/newpt_docker.sql "${DB_BACKUP_DIR}/newpt_docker.sql"
        print_success "Docker PostgreSQL backup completed (SQL format)"
    else
        print_warning "Docker PostgreSQL backup file not found"
    fi
    
    # Clean up container temp files
    docker exec trading-postgres rm -f /tmp/newpt_docker.dump /tmp/newpt_docker.sql 2>/dev/null || true
else
    print_warning "Docker PostgreSQL container not running"
    print_info "Attempting to backup from local PostgreSQL as fallback..."
    
    # Fallback to local PostgreSQL if Docker is not available
    if command -v psql &> /dev/null; then
        # Check if local PostgreSQL is accessible
        if PGPASSWORD=postgres psql -h localhost -U postgres -d newpt -c "SELECT 1;" &> /dev/null; then
            print_info "Backing up local PostgreSQL database 'newpt' (fallback)..."
            PGPASSWORD=postgres pg_dump -h localhost -U postgres -d newpt \
                --format=custom \
                --file="${DB_BACKUP_DIR}/newpt_local.dump" \
                --verbose 2>&1 | tee "${DB_BACKUP_DIR}/newpt_local.log" || {
                print_warning "Failed to backup local PostgreSQL, trying SQL format..."
                PGPASSWORD=postgres pg_dump -h localhost -U postgres -d newpt \
                    --format=plain \
                    --file="${DB_BACKUP_DIR}/newpt_local.sql" \
                    --verbose 2>&1 | tee -a "${DB_BACKUP_DIR}/newpt_local.log"
            }
            print_success "Local PostgreSQL backup completed (fallback)"
        else
            print_warning "Local PostgreSQL not accessible"
        fi
    fi
fi

# ============================================================
# 2. Source Code Backup
# ============================================================
print_info "Step 2: Backing up source code..."

CODE_BACKUP_DIR="${BACKUP_PATH}/code"
mkdir -p "${CODE_BACKUP_DIR}"

# Backup all important directories
DIRS_TO_BACKUP=(
    "apps"
    "backend"
    "crates"
    "src"
    "database"
    "infra"
    "scripts"
    "docs"
)

for dir in "${DIRS_TO_BACKUP[@]}"; do
    if [ -d "${PROJECT_ROOT}/${dir}" ]; then
        print_info "Backing up ${dir}/..."
        cp -r "${PROJECT_ROOT}/${dir}" "${CODE_BACKUP_DIR}/" 2>/dev/null || {
            print_warning "Failed to backup ${dir}/"
        }
    fi
done

# Backup root files (workspace, frontend, config)
print_info "Backing up root configuration files..."
ROOT_FILES=(
    "Cargo.toml"
    "Cargo.lock"
    ".env"
    ".env.example"
    "docker-compose.yml"
    "README.md"
    "package.json"
    "package-lock.json"
    "index.html"
    "tsconfig.json"
    "tsconfig.node.json"
    "vite.config.ts"
    "*.md"
)

for pattern in "${ROOT_FILES[@]}"; do
    for file in ${PROJECT_ROOT}/${pattern}; do
        if [ -f "${file}" ]; then
            cp "${file}" "${CODE_BACKUP_DIR}/" 2>/dev/null || true
        fi
    done
done

print_success "Source code backup completed"

# ============================================================
# 3. Migration Files Backup
# ============================================================
print_info "Step 3: Backing up migration files..."

MIGRATION_BACKUP_DIR="${BACKUP_PATH}/migrations"
mkdir -p "${MIGRATION_BACKUP_DIR}"

# Backup infra/migrations (main schema - used by start-all-servers)
if [ -d "${PROJECT_ROOT}/infra/migrations" ]; then
    mkdir -p "${MIGRATION_BACKUP_DIR}/infra_migrations"
    cp -r "${PROJECT_ROOT}/infra/migrations/"*.sql "${MIGRATION_BACKUP_DIR}/infra_migrations/" 2>/dev/null || true
fi
# Backup database/migrations (auth-service and other DB migrations)
if [ -d "${PROJECT_ROOT}/database/migrations" ]; then
    mkdir -p "${MIGRATION_BACKUP_DIR}/database_migrations"
    cp -r "${PROJECT_ROOT}/database/"*.sql "${MIGRATION_BACKUP_DIR}/database_migrations/" 2>/dev/null || true
    cp -r "${PROJECT_ROOT}/database/migrations/"*.sql "${MIGRATION_BACKUP_DIR}/database_migrations/" 2>/dev/null || true
fi
# Backup backend auth-service migrations if present
if [ -d "${PROJECT_ROOT}/backend/auth-service/migrations" ]; then
    mkdir -p "${MIGRATION_BACKUP_DIR}/auth_service_migrations"
    cp -r "${PROJECT_ROOT}/backend/auth-service/migrations/"*.sql "${MIGRATION_BACKUP_DIR}/auth_service_migrations/" 2>/dev/null || true
fi
# Also backup database schema
if [ -f "${PROJECT_ROOT}/database/schema.sql" ]; then
    cp "${PROJECT_ROOT}/database/schema.sql" "${MIGRATION_BACKUP_DIR}/" 2>/dev/null || true
fi
# Any other .sql under any migrations path
find "${PROJECT_ROOT}" -type f -name "*.sql" -path "*/migrations/*" ! -path "${PROJECT_ROOT}/infra/migrations/*" ! -path "${PROJECT_ROOT}/database/migrations/*" ! -path "${PROJECT_ROOT}/backend/auth-service/migrations/*" -exec cp {} "${MIGRATION_BACKUP_DIR}/" \; 2>/dev/null || true

print_success "Migration files backup completed"

# ============================================================
# 4. Configuration Files Backup
# ============================================================
print_info "Step 4: Backing up configuration files..."

CONFIG_BACKUP_DIR="${BACKUP_PATH}/config"
mkdir -p "${CONFIG_BACKUP_DIR}"

# Backup Docker Compose
if [ -f "${PROJECT_ROOT}/infra/docker-compose.yml" ]; then
    cp "${PROJECT_ROOT}/infra/docker-compose.yml" "${CONFIG_BACKUP_DIR}/" 2>/dev/null || true
fi

# Backup environment files
find "${PROJECT_ROOT}" -maxdepth 2 -type f -name ".env*" -exec cp {} "${CONFIG_BACKUP_DIR}/" \; 2>/dev/null || true

# Backup Cargo workspace files
if [ -f "${PROJECT_ROOT}/Cargo.toml" ]; then
    cp "${PROJECT_ROOT}/Cargo.toml" "${CONFIG_BACKUP_DIR}/" 2>/dev/null || true
fi

print_success "Configuration files backup completed"

# ============================================================
# 4b. Redis Backup (optional - cache/positions/summaries)
# ============================================================
print_info "Step 4b: Backing up Redis (optional)..."

REDIS_BACKUP_DIR="${BACKUP_PATH}/redis"
mkdir -p "${REDIS_BACKUP_DIR}"

if docker ps --format "{{.Names}}" | grep -q "trading-redis"; then
    print_info "Triggering Redis SAVE in Docker container..."
    if docker exec trading-redis redis-cli SAVE 2>/dev/null; then
        # Redis 7+ uses appendonly; dump.rdb may still exist for RDB snapshot
        if docker exec trading-redis test -f /data/dump.rdb 2>/dev/null; then
            docker cp trading-redis:/data/dump.rdb "${REDIS_BACKUP_DIR}/dump.rdb" 2>/dev/null && print_success "Redis dump.rdb copied"
        fi
        if docker exec trading-redis test -f /data/appendonly.aof 2>/dev/null; then
            docker cp trading-redis:/data/appendonly.aof "${REDIS_BACKUP_DIR}/appendonly.aof" 2>/dev/null && print_success "Redis appendonly.aof copied"
        fi
    else
        print_warning "Redis SAVE or copy failed (non-fatal)"
    fi
else
    print_warning "Docker Redis container not running; skipping Redis backup"
fi

# ============================================================
# 5. Create Backup Manifest
# ============================================================
print_info "Step 5: Creating backup manifest..."

MANIFEST_FILE="${BACKUP_PATH}/BACKUP_MANIFEST.txt"
cat > "${MANIFEST_FILE}" <<EOF
Project Backup Manifest
======================

Backup Date: $(date)
Backup Name: ${BACKUP_NAME}
Project Root: ${PROJECT_ROOT}

Contents:
---------
1. Database Backups:
   - Local PostgreSQL: newpt_local.dump or newpt_local.sql
   - Docker PostgreSQL: newpt_docker.dump or newpt_docker.sql

2. Source Code:
   - apps/
   - backend/
   - crates/
   - src/
   - database/
   - infra/
   - scripts/

3. Migration Files:
   - All .sql files from database/migrations/
   - schema.sql

4. Configuration Files:
   - docker-compose.yml
   - .env files
   - Cargo.toml

Database Connection Info:
-------------------------
Local PostgreSQL:
  Host: localhost
  Port: 5432
  Database: newpt
  User: postgres

Docker PostgreSQL:
  Container: trading-postgres
  Database: newpt
  User: postgres

Restore Instructions:
---------------------
See RESTORE_README.md in this backup folder for full restore steps.

EOF

# Create RESTORE_README.md for easy recovery
RESTORE_README="${BACKUP_PATH}/RESTORE_README.md"
cat > "${RESTORE_README}" <<'RESTOREEOF'
# Restore Full Project from Backup

## What this backup contains

- **database/** – PostgreSQL dump (newpt) from Docker or local
- **code/** – apps, backend, crates, src, database, infra, scripts, docs + root config (package.json, Cargo.toml, etc.)
- **migrations/** – infra_migrations/, database_migrations/, auth_service_migrations/ + any other .sql
- **config/** – docker-compose, .env*, Cargo.toml
- **redis/** – dump.rdb and/or appendonly.aof (if Redis was running)

## Restore steps

### 1. Restore project files

Copy or extract the backup to a new project directory:

- Copy `code/` contents over your project root (or extract from archive).
- Copy root files from `code/` (Cargo.toml, package.json, index.html, etc.) to project root.
- Ensure `infra/migrations` and `database/migrations` match `migrations/infra_migrations` and `migrations/database_migrations`.

### 2. Start infrastructure

```bash
cd infra && docker-compose up -d
```

### 3. Apply migrations

Using the migrations from this backup:

```bash
# Infra migrations (main schema)
for f in migrations/infra_migrations/*.sql; do PGPASSWORD=postgres psql -h localhost -U postgres -d newpt -f "$f"; done

# Database migrations if you use database/migrations
for f in migrations/database_migrations/*.sql; do PGPASSWORD=postgres psql -h localhost -U postgres -d newpt -f "$f"; done
```

Or copy `migrations/infra_migrations/*.sql` to `infra/migrations/` and run your existing migration script.

### 4. Restore PostgreSQL

**If you have a custom-format dump (.dump):**

```bash
docker exec -i trading-postgres pg_restore -U postgres -d newpt --clean --if-exists < database/newpt_docker.dump
```

**If you have a plain SQL dump (.sql):**

```bash
docker exec -i trading-postgres psql -U postgres -d newpt < database/newpt_docker.sql
```

Use `newpt_local.*` if the backup was from local PostgreSQL.

### 5. (Optional) Restore Redis

If you need to restore Redis cache (positions, account summaries):

```bash
docker cp redis/dump.rdb trading-redis:/data/dump.rdb
docker restart trading-redis
```

Or with appendonly.aof, copy to `/data/appendonly.aof` and restart.

### 6. Start services

Run your normal start script, e.g.:

```bash
./scripts/start-all-servers.sh
```

### 7. Frontend

```bash
npm install && npm run dev
```

## Connection reference

- Postgres: localhost:5432, user=postgres, db=newpt
- Redis: localhost:6379
- NATS: localhost:4222

RESTOREEOF
print_success "RESTORE_README.md created"


print_success "Backup manifest created"

# ============================================================
# 6. Create Compressed Archive
# ============================================================
print_info "Step 6: Creating compressed archive..."

cd "${BACKUP_DIR}"
tar -czf "${BACKUP_NAME}.tar.gz" "${BACKUP_NAME}" 2>/dev/null || {
    print_warning "Failed to create compressed archive (tar not available or error)"
    print_info "Backup is available as uncompressed directory: ${BACKUP_PATH}"
}

if [ -f "${BACKUP_NAME}.tar.gz" ]; then
    ARCHIVE_SIZE=$(du -h "${BACKUP_NAME}.tar.gz" | cut -f1)
    print_success "Compressed archive created: ${BACKUP_NAME}.tar.gz (${ARCHIVE_SIZE})"
    
    # Optionally remove uncompressed directory to save space (only when running interactively)
    if [ -t 0 ]; then
        read -p "Remove uncompressed backup directory to save space? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "${BACKUP_NAME}"
            print_info "Removed uncompressed directory"
        fi
    fi
fi

# ============================================================
# 7. Summary
# ============================================================
print_info "Backup Summary"
echo "=================="
echo "Backup Location: ${BACKUP_PATH}"
if [ -f "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" ]; then
    echo "Archive: ${BACKUP_DIR}/${BACKUP_NAME}.tar.gz"
    echo "Archive Size: $(du -h "${BACKUP_DIR}/${BACKUP_NAME}.tar.gz" | cut -f1)"
fi
echo ""
echo "Database Backups:"
ls -lh "${DB_BACKUP_DIR}/" 2>/dev/null | tail -n +2 || echo "  No database backups found"
echo ""
echo "✅ Backup completed successfully!"
echo ""
echo "To restore this backup, run:"
echo "  ./scripts/restore-project.sh ${BACKUP_NAME}"


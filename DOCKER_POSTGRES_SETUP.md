# Docker PostgreSQL Setup

This project uses **Docker PostgreSQL** as the standard database. This ensures consistency across all environments and aligns with other services (Redis, NATS) that are also in Docker.

## ✅ Why Docker PostgreSQL?

1. **Consistency**: All infrastructure services (PostgreSQL, Redis, NATS) are in Docker
2. **Isolation**: No conflicts with local PostgreSQL or other projects
3. **Easy Management**: Simple to reset, backup, and restore
4. **Team Collaboration**: Same setup for all developers
5. **Version Control**: Database configuration is in `docker-compose.yml`

## 🚀 Quick Start

### Ensure Docker PostgreSQL is Running

```bash
./scripts/ensure-docker-postgres.sh
```

This script will:
- Check if Docker PostgreSQL is running
- Start it if needed
- Warn if local PostgreSQL might interfere
- Verify the connection

### Start All Services (includes Docker PostgreSQL)

```bash
./scripts/start-all-servers.sh
```

This automatically ensures Docker PostgreSQL is ready before starting services.

## 📋 Manual Setup

### Start Docker PostgreSQL

```bash
docker-compose -f infra/docker-compose.yml up -d postgres
```

### Verify It's Running

```bash
docker ps | grep trading-postgres
```

### Check Connection

```bash
docker exec trading-postgres psql -U postgres -d newpt -c "SELECT version();"
```

## 🔧 Configuration

### Connection String

All services use this connection string:
```
postgresql://postgres:postgres@localhost:5432/newpt
```

This works because Docker forwards port 5432 from the container to localhost.

### Environment Variable

Set in your environment or scripts:
```bash
export DATABASE_URL="postgresql://postgres:postgres@localhost:5432/newpt"
```

## ⚠️ Local PostgreSQL Conflict

If you have local PostgreSQL running on port 5432, it might conflict with Docker PostgreSQL.

### Check for Conflict

```bash
# Check if local PostgreSQL is running
pg_isready -h localhost -U postgres

# Check if Docker PostgreSQL is running
docker ps | grep trading-postgres
```

### Solution Options

**Option 1: Stop Local PostgreSQL** (Recommended)
```bash
# macOS (Homebrew)
brew services stop postgresql@14
# or
brew services stop postgresql@15

# Linux (systemd)
sudo systemctl stop postgresql

# Manual
pg_ctl -D /usr/local/var/postgres stop
```

**Option 2: Use Different Port for Local PostgreSQL**

Edit your local PostgreSQL config to use a different port (e.g., 5433).

**Option 3: Use Different Port for Docker PostgreSQL**

Edit `infra/docker-compose.yml`:
```yaml
ports:
  - "5433:5432"  # Change 5432 to 5433
```

Then update connection string:
```
postgresql://postgres:postgres@localhost:5433/newpt
```

## 📦 Database Setup

### Initial Setup

```bash
./scripts/setup-newpt-database.sh
```

This will:
- Start Docker PostgreSQL if needed
- Create `newpt` database
- Apply schema from `database/schema.sql`
- Verify setup

### Verify Database

```bash
docker exec trading-postgres psql -U postgres -d newpt -c "\dt"
```

## 🔄 Backup & Restore

### Backup (Prioritizes Docker PostgreSQL)

```bash
./scripts/backup-project.sh
```

### Restore

```bash
./scripts/restore-project.sh project_backup_YYYYMMDD_HHMMSS
```

## 🛠️ Troubleshooting

### Docker PostgreSQL Not Starting

```bash
# Check Docker logs
docker logs trading-postgres

# Check if port is in use
lsof -i :5432

# Restart container
docker-compose -f infra/docker-compose.yml restart postgres
```

### Connection Refused

1. Verify container is running: `docker ps | grep trading-postgres`
2. Check port forwarding: `docker port trading-postgres`
3. Verify database exists: `docker exec trading-postgres psql -U postgres -l`

### Wrong Database Connected

If services connect to local PostgreSQL instead of Docker:

1. Stop local PostgreSQL
2. Restart Docker PostgreSQL: `docker-compose -f infra/docker-compose.yml restart postgres`
3. Verify: `docker exec trading-postgres psql -U postgres -d newpt -c "SELECT current_database();"`

## 📝 Migration from Local PostgreSQL

If you were using local PostgreSQL and want to migrate:

1. **Backup local database**
   ```bash
   pg_dump -h localhost -U postgres -d newpt > local_backup.sql
   ```

2. **Start Docker PostgreSQL**
   ```bash
   ./scripts/ensure-docker-postgres.sh
   ```

3. **Restore to Docker**
   ```bash
   docker exec -i trading-postgres psql -U postgres -d newpt < local_backup.sql
   ```

4. **Update connection strings** (already done in scripts)

5. **Stop local PostgreSQL** (optional but recommended)

## ✅ Verification Checklist

- [ ] Docker PostgreSQL container is running
- [ ] Port 5432 is forwarded correctly
- [ ] Database `newpt` exists
- [ ] Schema is applied
- [ ] Services can connect
- [ ] Local PostgreSQL is stopped (or using different port)

## 🎯 Best Practices

1. **Always use Docker PostgreSQL** for this project
2. **Stop local PostgreSQL** to avoid conflicts
3. **Use `ensure-docker-postgres.sh`** before starting services
4. **Backup regularly** using the backup script
5. **Keep `docker-compose.yml`** in version control

## 📚 Related Files

- `infra/docker-compose.yml` - Docker PostgreSQL configuration
- `scripts/ensure-docker-postgres.sh` - Ensure Docker PostgreSQL is ready
- `scripts/setup-newpt-database.sh` - Initial database setup
- `scripts/backup-project.sh` - Backup (prioritizes Docker)
- `scripts/restore-project.sh` - Restore (uses Docker)


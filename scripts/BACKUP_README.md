# Project Backup & Restore Guide

This guide explains how to backup and restore the entire project including database, code, and configurations.

## 📦 Creating a Backup

### Quick Backup
```bash
./scripts/backup-project.sh
```

This will create a timestamped backup in `./backups/` directory.

### Custom Backup Location
```bash
BACKUP_DIR=/path/to/backups ./scripts/backup-project.sh
```

## 📋 What Gets Backed Up

### 1. Database
- **Local PostgreSQL**: `newpt` database dump
- **Docker PostgreSQL**: `newpt` database dump
- Both custom format (`.dump`) and SQL format (`.sql`) are attempted

### 2. Source Code
- `apps/` - All application code
- `backend/` - Backend services
- `crates/` - Shared Rust crates
- `src/` - Frontend source code
- `database/` - Database schema and migrations
- `infra/` - Infrastructure configuration
- `scripts/` - Utility scripts

### 3. Configuration Files
- `Cargo.toml` and `Cargo.lock`
- `.env` files
- `docker-compose.yml`
- All `.md` documentation files

### 4. Migration Files
- All SQL migration files from `database/migrations/`
- `database/schema.sql`

## 🔄 Restoring a Backup

### List Available Backups
```bash
ls -lh ./backups/
```

### Restore a Backup
```bash
./scripts/restore-project.sh project_backup_20260212_174530
```

### Restore Process
1. **Extracts** compressed backup if needed
2. **Restores database** (Docker or Local PostgreSQL)
3. **Restores source code** (with confirmation prompt)
4. **Provides next steps**

## ⚠️ Important Notes

### Database Restoration
- **Docker PostgreSQL**: Requires `trading-postgres` container to be running
- **Local PostgreSQL**: Requires PostgreSQL client tools (`psql`, `pg_restore`)
- Database will be **dropped and recreated** during restore
- Make sure you have a backup before restoring!

### Source Code Restoration
- Will **overwrite** existing files
- You'll be prompted for confirmation
- Original files will be lost (unless you backup first)

### Backup Storage
- Backups are stored in `./backups/` by default
- Each backup is timestamped: `project_backup_YYYYMMDD_HHMMSS`
- Compressed archives are created automatically (`.tar.gz`)
- Uncompressed directories can be removed to save space

## 📅 Recommended Backup Schedule

### Development
- **Before major changes**: Always backup before refactoring
- **Before database migrations**: Backup database before running migrations
- **Weekly**: Regular weekly backups

### Production
- **Daily**: Automated daily backups
- **Before deployments**: Backup before each deployment
- **Retention**: Keep at least 7 days of backups

## 🔍 Backup Verification

### Check Backup Contents
```bash
# List backup contents
tar -tzf ./backups/project_backup_*.tar.gz | head -20

# Extract and inspect
tar -xzf ./backups/project_backup_*.tar.gz -C /tmp/
ls -lh /tmp/project_backup_*/
```

### Verify Database Backup
```bash
# Check backup size
ls -lh ./backups/project_backup_*/database/

# Test restore (dry run)
# Extract backup first, then check SQL file
```

## 🚨 Emergency Recovery

### If Project is Damaged

1. **Stop all services**
   ```bash
   ./scripts/stop-all-servers.sh
   ```

2. **Find latest backup**
   ```bash
   ls -lt ./backups/ | head -5
   ```

3. **Restore backup**
   ```bash
   ./scripts/restore-project.sh project_backup_YYYYMMDD_HHMMSS
   ```

4. **Verify restoration**
   ```bash
   # Check database
   docker exec trading-postgres psql -U postgres -d newpt -c "\dt"
   
   # Check code
   ls -la apps/ backend/ crates/
   ```

5. **Restart services**
   ```bash
   ./scripts/start-all-servers.sh
   ```

## 📊 Backup Size Management

### Compress Old Backups
```bash
# Compress uncompressed backups
cd ./backups/
for dir in project_backup_*; do
    if [ -d "$dir" ] && [ ! -f "${dir}.tar.gz" ]; then
        tar -czf "${dir}.tar.gz" "$dir"
        rm -rf "$dir"
    fi
done
```

### Remove Old Backups
```bash
# Keep only last 10 backups
cd ./backups/
ls -t project_backup_*.tar.gz | tail -n +11 | xargs rm -f
```

## 🔐 Security Notes

- **Database backups contain sensitive data** - Store securely
- **Environment files** may contain secrets - Encrypt backups if storing remotely
- **Don't commit backups to git** - Add `backups/` to `.gitignore`

## 📝 Backup Manifest

Each backup includes a `BACKUP_MANIFEST.txt` file with:
- Backup date and timestamp
- Project root path
- Contents list
- Database connection info
- Restore instructions

## 🆘 Troubleshooting

### Backup Fails
- Check PostgreSQL is accessible
- Verify Docker container is running (for Docker backups)
- Check disk space: `df -h`
- Check permissions: `ls -la ./backups/`

### Restore Fails
- Verify backup integrity: `tar -tzf backup.tar.gz`
- Check database connection
- Ensure sufficient disk space
- Review error messages in restore script output

### Database Restore Issues
- Try SQL format if custom format fails
- Check PostgreSQL version compatibility
- Verify database user permissions
- Check for existing connections to database

## 📞 Support

For issues with backup/restore:
1. Check backup manifest for details
2. Review script logs
3. Verify database and file system permissions
4. Ensure all required tools are installed


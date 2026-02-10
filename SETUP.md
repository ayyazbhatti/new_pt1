# Setup Guide - Authentication System

## Prerequisites

1. **PostgreSQL** - Database server
2. **Rust** - For backend compilation
3. **Node.js** - For frontend

## Step 1: Start PostgreSQL

PostgreSQL needs to be running. On macOS:

```bash
# Using Homebrew
brew services start postgresql@14
# or
brew services start postgresql@15

# Or start manually
pg_ctl -D /usr/local/var/postgres start
```

Verify PostgreSQL is running:
```bash
psql -c "SELECT version();"
```

## Step 2: Create Database

```bash
createdb newpt
```

If you get a connection error, make sure PostgreSQL is running (see Step 1).

## Step 3: Run Migrations

```bash
# Run first migration (creates auth tables)
psql newpt < database/migrations/0001_auth_users.sql

# Run second migration (seeds admin user placeholder)
psql newpt < database/migrations/0002_seed_admin_user.sql
```

## Step 4: Configure Backend

The `.env` file has been created at `backend/auth-service/.env`. 

**IMPORTANT**: Update the `DATABASE_URL` if your PostgreSQL setup is different:

```bash
cd backend/auth-service
# Edit .env and update DATABASE_URL if needed
# Default: postgresql://postgres@localhost:5432/newpt
```

If your PostgreSQL requires a password:
```
DATABASE_URL=postgresql://username:password@localhost:5432/newpt
```

## Step 5: Seed Admin User

```bash
cd backend/auth-service
cargo run --bin seed_admin
```

This will create/update the admin user with proper password hash:
- Email: `admin@newpt.local`
- Password: `Admin@12345`

## Step 6: Start Backend Server

```bash
cd backend/auth-service
cargo run
```

The server will start on `http://localhost:3000`

You should see:
```
🚀 Auth service starting on http://0.0.0.0:3000
```

## Step 7: Start Frontend

In a new terminal:

```bash
# From project root
npm run dev
```

The frontend will start on `http://localhost:5173`

## Step 8: Test the System

1. **Open browser**: `http://localhost:5173`
2. **Try to access protected route**: You'll be redirected to `/login`
3. **Login with admin**:
   - Email: `admin@newpt.local`
   - Password: `Admin@12345`
4. **Or register a new user** at `/register`

## Troubleshooting

### PostgreSQL Connection Issues

If you get connection errors:

1. **Check if PostgreSQL is running**:
   ```bash
   brew services list | grep postgresql
   ```

2. **Start PostgreSQL**:
   ```bash
   brew services start postgresql@14
   ```

3. **Check connection**:
   ```bash
   psql -d postgres -c "SELECT 1;"
   ```

4. **Find your PostgreSQL socket**:
   ```bash
   # macOS Homebrew default
   export PGHOST=/tmp
   # Or check your PostgreSQL config
   ```

### Database Already Exists

If database already exists:
```bash
# Drop and recreate (WARNING: deletes all data)
dropdb newpt
createdb newpt
```

### Backend Compilation Errors

If `cargo run` fails:

1. **Update Rust**:
   ```bash
   rustup update
   ```

2. **Check dependencies**:
   ```bash
   cd backend/auth-service
   cargo build
   ```

### Frontend API Connection Issues

1. **Check backend is running**: `curl http://localhost:3000/health`
2. **Verify `.env` file**: `cat .env` should show `VITE_API_URL=http://localhost:3000`
3. **Restart frontend**: Stop and run `npm run dev` again

### CORS Issues

If you see CORS errors, the backend CORS is configured to allow all origins in development. For production, update `backend/auth-service/src/main.rs` to specify exact origins.

## Next Steps

- [ ] Change admin password after first login
- [ ] Configure production JWT_SECRET (use a strong random string)
- [ ] Set up proper CORS for production
- [ ] Add rate limiting
- [ ] Set up SSL/TLS for production

## Default Credentials

**Admin User:**
- Email: `admin@newpt.local`
- Password: `Admin@12345`

⚠️ **CHANGE THESE IN PRODUCTION!**


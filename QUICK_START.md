# Quick Start Guide

## Current Status

✅ Frontend `.env` file created  
✅ Backend `.env` file created  
⚠️ PostgreSQL needs to be started  
⚠️ Database needs to be created  

## Next Steps

### 1. Start PostgreSQL

```bash
# On macOS with Homebrew
brew services start postgresql@14
# or
brew services start postgresql@15

# Verify it's running
psql -c "SELECT version();"
```

### 2. Create Database

```bash
createdb newpt
```

### 3. Run Migrations

```bash
psql newpt < database/migrations/0001_auth_users.sql
psql newpt < database/migrations/0002_seed_admin_user.sql
```

### 4. Seed Admin User

```bash
cd backend/auth-service
cargo run --bin seed_admin
```

### 5. Start Backend

```bash
cd backend/auth-service
cargo run
```

### 6. Start Frontend (in new terminal)

```bash
npm run dev
```

## Configuration Files

### Frontend `.env`
```
VITE_API_URL=http://localhost:3000
```

### Backend `.env` (backend/auth-service/.env)
```
DATABASE_URL=postgresql://postgres@localhost:5432/newpt
JWT_SECRET=dev-jwt-secret-key-change-in-production-minimum-32-characters-long
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000
PORT=3000
```

**Note**: If your PostgreSQL requires authentication, update `DATABASE_URL`:
```
DATABASE_URL=postgresql://username:password@localhost:5432/newpt
```

## Test Login

Once everything is running:
1. Open `http://localhost:5173`
2. Go to `/login`
3. Login with:
   - Email: `admin@newpt.local`
   - Password: `Admin@12345`

See `SETUP.md` for detailed troubleshooting.


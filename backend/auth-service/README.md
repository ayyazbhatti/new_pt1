# Auth Service

Rust-based authentication service for the newpt trading platform.

## Setup

1. Install Rust: https://rustup.rs/
2. Install PostgreSQL and create database:
   ```bash
   createdb newpt
   ```
3. Copy `.env.example` to `.env` and configure:
   ```bash
   cp .env.example .env
   ```
4. Update `.env` with your database URL and JWT secret

## Running

```bash
# Development
cargo run

# Build
cargo build --release
```

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret key for JWT signing
- `ACCESS_TOKEN_TTL_SECONDS`: Access token TTL (default: 900 = 15 minutes)
- `REFRESH_TOKEN_TTL_SECONDS`: Refresh token TTL (default: 2592000 = 30 days)
- `PORT`: Server port (default: 3000)

## API Endpoints

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout (revoke refresh token)
- `GET /api/auth/me` - Get current user (requires auth)

## Database Migrations

Migrations are in `database/migrations/`. Run them manually or use SQLx:

```bash
sqlx migrate run
```

## Seed Admin User

The admin user is created by migration `0002_seed_admin_user.sql`. The password hash will be properly set when the backend service runs for the first time and hashes the password using Argon2id.

Default admin credentials:
- Email: `admin@newpt.local`
- Password: `Admin@12345`

**Important**: Change the admin password after first login in production!


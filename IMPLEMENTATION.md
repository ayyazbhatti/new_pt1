# Authentication Implementation Guide

This document describes the complete authentication system implementation for the newpt trading platform.

## Overview

The authentication system consists of:
- **Backend**: Rust + Axum service with PostgreSQL
- **Frontend**: React + TypeScript with Zustand state management
- **Database**: PostgreSQL with migrations for users, sessions, and audit logs

## Database Setup

### 1. Create Database

```bash
createdb newpt
```

### 2. Run Migrations

The migrations are in `database/migrations/`:

1. `0001_auth_users.sql` - Creates/modifies auth tables
2. `0002_seed_admin_user.sql` - Seeds admin user (placeholder)

Run migrations:

```bash
psql newpt < database/migrations/0001_auth_users.sql
psql newpt < database/migrations/0002_seed_admin_user.sql
```

### 3. Seed Admin User

The admin user needs a proper password hash. You can:

**Option A**: Use the Rust seed script (recommended):
```bash
cd backend/auth-service
cargo run --bin seed_admin
```

**Option B**: Manually update after first backend run (the backend will hash it properly)

Default admin credentials:
- Email: `admin@newpt.local`
- Password: `Admin@12345`

**⚠️ IMPORTANT**: Change the admin password after first login in production!

## Backend Setup

### 1. Install Rust

Follow instructions at https://rustup.rs/

### 2. Configure Environment

```bash
cd backend/auth-service
cp .env.example .env
```

Edit `.env`:
```env
DATABASE_URL=postgresql://user:password@localhost:5432/newpt
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
ACCESS_TOKEN_TTL_SECONDS=900
REFRESH_TOKEN_TTL_SECONDS=2592000
PORT=3000
```

### 3. Run Backend

```bash
cargo run
```

The service will start on `http://localhost:3000`

## Frontend Setup

### 1. Configure API URL

Create `.env` in project root:
```env
VITE_API_URL=http://localhost:3000
```

### 2. Run Frontend

```bash
npm run dev
```

## API Endpoints

### POST /api/auth/register
Register a new user.

**Request:**
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "password": "password123",
  "country": "US",
  "referral_code": "REF123456"
}
```

**Response:**
```json
{
  "access_token": "jwt_token_here",
  "refresh_token": "opaque_refresh_token",
  "user": {
    "id": "uuid",
    "email": "john@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "role": "user",
    "status": "active"
  }
}
```

### POST /api/auth/login
Login with email and password.

**Request:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:** Same as register

### POST /api/auth/refresh
Refresh access token using refresh token.

**Request:**
```json
{
  "refresh_token": "opaque_refresh_token"
}
```

**Response:**
```json
{
  "access_token": "new_jwt_token"
}
```

### POST /api/auth/logout
Logout and revoke refresh token. Requires Authorization header.

**Request:**
```json
{
  "refresh_token": "opaque_refresh_token"
}
```

**Response:** 204 No Content

### GET /api/auth/me
Get current user profile. Requires Authorization header.

**Response:**
```json
{
  "id": "uuid",
  "email": "john@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "role": "user",
  "status": "active"
}
```

## Security Features

- **Password Hashing**: Argon2id (industry standard)
- **JWT Tokens**: Access tokens (short-lived) + Refresh tokens (long-lived, stored hashed)
- **Email Uniqueness**: Enforced at database level
- **Lowercase Emails**: Automatic normalization
- **Token Refresh**: Automatic refresh on 401 errors
- **Session Management**: Refresh tokens stored in database with expiration
- **Audit Logging**: All auth actions logged

## Frontend Integration

### Auth Store

The auth store (`src/shared/store/auth.store.ts`) manages:
- Access token
- Refresh token
- User data
- Authentication state
- Auto-hydration from localStorage

### HTTP Client

The HTTP client (`src/shared/api/http.ts`) provides:
- Automatic Authorization header injection
- Automatic token refresh on 401
- Error handling
- Single-flight refresh (prevents multiple simultaneous refresh requests)

### Guards

- **AuthGuard**: Protects routes requiring authentication
- **AdminGuard**: Protects admin routes (requires `role === 'admin'`)

## Testing

### Test Registration

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "first_name": "Test",
    "last_name": "User",
    "email": "test@example.com",
    "password": "test12345"
  }'
```

### Test Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "test12345"
  }'
```

### Test Me Endpoint

```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Troubleshooting

### Database Connection Issues

- Verify `DATABASE_URL` is correct
- Ensure PostgreSQL is running
- Check database exists: `psql -l | grep newpt`

### JWT Errors

- Verify `JWT_SECRET` is set
- Ensure secret is long enough (recommended: 32+ characters)

### Migration Issues

- Run migrations manually if needed
- Check database schema matches migrations

### Frontend API Errors

- Verify `VITE_API_URL` is set correctly
- Check CORS settings in backend
- Verify backend is running

## Next Steps

- [ ] Add email verification flow
- [ ] Add password reset functionality
- [ ] Add rate limiting
- [ ] Add 2FA support
- [ ] Add session management UI
- [ ] Add password strength meter
- [ ] Add account lockout after failed attempts


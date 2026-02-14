# Auth API - Postman Testing Guide

## Base URL
```
http://localhost:3000
```
(Or check your `.env` file for `VITE_API_URL`)

---

## 1. Login API

### Endpoint
```
POST http://localhost:3000/api/auth/login
```

### Headers
```
Content-Type: application/json
```

### Request Body
```json
{
  "email": "your-email@example.com",
  "password": "your-password"
}
```

### Example Request (Postman)
1. Method: **POST**
2. URL: `http://localhost:3000/api/auth/login`
3. Headers:
   - Key: `Content-Type`
   - Value: `application/json`
4. Body (raw JSON):
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

### Success Response (200 OK)
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "role": "user",
    "status": "active",
    "phone": null,
    "country": "US",
    "created_at": "2024-01-01T00:00:00Z",
    "last_login_at": "2024-01-01T00:00:00Z",
    "referral_code": null,
    "group_id": "123e4567-e89b-12d3-a456-426614174000",
    "group_name": null
  }
}
```

### Error Response (401 Unauthorized)
```json
{
  "error": {
    "code": "INVALID_CREDENTIALS",
    "message": "Invalid credentials"
  }
}
```

---

## 2. Register API

### Endpoint
```
POST http://localhost:3000/api/auth/register
```

### Headers
```
Content-Type: application/json
```

### Request Body
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "email": "newuser@example.com",
  "password": "securePassword123",
  "country": "US",
  "referral_code": "OPTIONAL_REFERRAL_CODE"
}
```

### Example Request (Postman)
1. Method: **POST**
2. URL: `http://localhost:3000/api/auth/register`
3. Headers:
   - Key: `Content-Type`
   - Value: `application/json`
4. Body (raw JSON):
```json
{
  "first_name": "Jane",
  "last_name": "Smith",
  "email": "jane@example.com",
  "password": "securePassword123",
  "country": "US",
  "referral_code": null
}
```

### Success Response (200 OK)
Same format as Login response.

---

## 3. Get Current User (Me)

### Endpoint
```
GET http://localhost:3000/api/auth/me
```

### Headers
```
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json
```

### Example Request (Postman)
1. Method: **GET**
2. URL: `http://localhost:3000/api/auth/me`
3. Headers:
   - Key: `Authorization`
   - Value: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` (your access_token from login)

### Success Response (200 OK)
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "email": "user@example.com",
  "first_name": "John",
  "last_name": "Doe",
  "role": "user",
  "status": "active"
}
```

---

## 4. Refresh Token API

### Endpoint
```
POST http://localhost:3000/api/auth/refresh
```

### Headers
```
Content-Type: application/json
```

### Request Body
```json
{
  "refresh_token": "your-refresh-token-here"
}
```

### Success Response (200 OK)
```json
{
  "access_token": "new-access-token-here"
}
```

---

## 5. Logout API

### Endpoint
```
POST http://localhost:3000/api/auth/logout
```

### Headers
```
Authorization: Bearer YOUR_ACCESS_TOKEN
Content-Type: application/json
```

### Request Body
```json
{
  "refresh_token": "your-refresh-token-here"
}
```

### Success Response (204 No Content)

---

## Quick Test Flow for WebSocket

### Step 1: Login to Get Token
```
POST http://localhost:3000/api/auth/login
Body: {
  "email": "your-email@example.com",
  "password": "your-password"
}
```

### Step 2: Copy the `access_token` from response

### Step 3: Use in WebSocket
- Connect to: `ws://localhost:3003/ws?group=default`
- Send: `{"type":"auth","token":"YOUR_ACCESS_TOKEN_HERE"}`

---

## Postman Collection Setup

### Environment Variables (Optional)
Create a Postman environment with:
- `base_url`: `http://localhost:3000`
- `access_token`: (will be set after login)
- `refresh_token`: (will be set after login)

### Pre-request Script (for Login)
```javascript
// No pre-request needed for login
```

### Tests Script (for Login)
```javascript
// Save tokens to environment
if (pm.response.code === 200) {
    const jsonData = pm.response.json();
    pm.environment.set("access_token", jsonData.access_token);
    pm.environment.set("refresh_token", jsonData.refresh_token);
    pm.environment.set("user_id", jsonData.user.id);
}
```

### Using Environment Variables
- URL: `{{base_url}}/api/auth/login`
- Authorization Header: `Bearer {{access_token}}`

---

## Troubleshooting

### Connection Refused
- Check if auth-service is running on port 3000
- Verify: `lsof -i :3000`

### 401 Unauthorized
- Check email/password are correct
- Verify user exists and is active
- Check token format (should start with `eyJ`)

### 500 Internal Server Error
- Check backend logs
- Verify database connection
- Check if all services are running

---

## Example cURL Commands

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "password123"
  }'
```

### Get Current User
```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json"
```

---

## Notes

- **Access Token**: Use this for WebSocket authentication and protected API calls
- **Refresh Token**: Use to get a new access token when it expires
- **Token Expiry**: Access tokens typically expire after a set time (check JWT config)
- **Base URL**: Default is `http://localhost:3000`, but check your environment variables


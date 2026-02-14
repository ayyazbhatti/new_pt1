# WebSocket Testing in Postman - Balance Updates

## WebSocket Endpoint
```
ws://localhost:3003/ws?group=default
```

## Step-by-Step Testing Guide

### Step 1: Connect to WebSocket
1. Open Postman
2. Click **New** → **WebSocket Request**
3. Enter URL: `ws://localhost:3003/ws?group=default`
4. Click **Connect**

### Step 2: Authenticate
After connecting, send this message (replace `YOUR_JWT_TOKEN` with your actual token):

```json
{
  "type": "auth",
  "token": "YOUR_JWT_TOKEN"
}
```

**Expected Response:**
```json
{
  "type": "auth_success",
  "user_id": "your-user-id",
  "group_id": "default"
}
```

**If authentication fails:**
```json
{
  "type": "auth_error",
  "error": "Invalid token: ..."
}
```

### Step 3: Subscribe to Wallet Balance Channel
After successful authentication, send:

```json
{
  "type": "subscribe",
  "channels": ["balances", "wallet"],
  "symbols": []
}
```

**Expected Response:**
```json
{
  "type": "subscribed",
  "symbols": []
}
```

### Step 4: Wait for Balance Updates
You should receive balance update messages like:

```json
{
  "type": "wallet.balance.updated",
  "payload": {
    "userId": "your-user-id",
    "balance": 1000.00,
    "currency": "USD",
    "available": 1000.00,
    "locked": 0,
    "equity": 1000.00,
    "margin_used": 0,
    "free_margin": 1000.00,
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

## How to Get Your JWT Token

### Option 1: From Browser
1. Open your app in browser
2. Open Developer Tools (F12)
3. Go to **Application** → **Local Storage**
4. Look for `auth-storage` or check `accessToken` in the auth store
5. Copy the token value

### Option 2: From Login API Response
1. Make a POST request to your login endpoint
2. Copy the `accessToken` from the response

### Option 3: Check Network Tab
1. Open Developer Tools → **Network** tab
2. Login to your app
3. Find the login request
4. Check the response for `accessToken`

## Testing Scenarios

### Test 1: Check Connection
- Connect to WebSocket
- Should see connection established

### Test 2: Test Authentication
- Send auth message with valid token
- Should receive `auth_success`
- Send auth message with invalid token
- Should receive `auth_error`

### Test 3: Test Subscription
- After authentication, send subscribe message
- Should receive `subscribed` response

### Test 4: Test Balance Updates
- After subscription, wait for balance updates
- Or trigger a balance change (deposit/withdraw)
- Should receive `wallet.balance.updated` event

## Troubleshooting

### Connection Fails
- Check if ws-gateway is running: `lsof -i :3003`
- Check if port 3003 is accessible
- Verify the URL is correct

### Authentication Fails
- Verify token is valid and not expired
- Check token format (should be JWT)
- Ensure token is from the correct auth service

### No Balance Updates Received
- Verify subscription was successful
- Check if Redis channel `wallet:balance:updated` is being published
- Check backend logs for balance update events
- Verify user_id in balance update matches your user_id

## Message Format Reference

### Client → Server Messages

**Auth:**
```json
{
  "type": "auth",
  "token": "jwt-token-here"
}
```

**Subscribe:**
```json
{
  "type": "subscribe",
  "channels": ["balances", "wallet"],
  "symbols": []
}
```

**Ping:**
```json
{
  "type": "ping"
}
```

### Server → Client Messages

**Auth Success:**
```json
{
  "type": "auth_success",
  "user_id": "uuid",
  "group_id": "default"
}
```

**Wallet Balance Updated:**
```json
{
  "type": "wallet.balance.updated",
  "payload": {
    "userId": "uuid",
    "balance": 1000.00,
    "currency": "USD",
    "available": 1000.00,
    "locked": 0,
    "equity": 1000.00,
    "margin_used": 0,
    "free_margin": 1000.00,
    "updatedAt": "2024-01-01T00:00:00Z"
  }
}
```

## Quick Test Script

1. Connect: `ws://localhost:3003/ws?group=default`
2. Send Auth: `{"type":"auth","token":"YOUR_TOKEN"}`
3. Wait for: `{"type":"auth_success",...}`
4. Send Subscribe: `{"type":"subscribe","channels":["balances","wallet"],"symbols":[]}`
5. Wait for balance updates


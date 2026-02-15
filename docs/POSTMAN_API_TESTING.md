# Postman API testing – Admin Groups & Markup

Use these in Postman to see exactly what each API returns.

**Base URL:** `http://localhost:3000`  
*(If you use Vite proxy in dev, you can also use your app origin and path `/api/...`; the proxy forwards to 3000.)*

---

## 1. Get an access token (required for admin APIs)

**Request**
- **Method:** `POST`
- **URL:** `http://localhost:3000/api/auth/login`
- **Headers:** `Content-Type: application/json`
- **Body (raw JSON):**
```json
{
  "email": "your-admin-email@example.com",
  "password": "your-password"
}
```

**Response (200)** – copy `access_token`:
```json
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "user": { "id": "...", "email": "...", "role": "admin", ... }
}
```

Use an **admin** user so the admin endpoints return 200 instead of 403.

---

## 2. List groups (table data)

**Request**
- **Method:** `GET`
- **URL:** `http://localhost:3000/api/admin/groups`
  - Optional query: `?page=1&page_size=20&status=all&sort=priority_desc&search=`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <paste access_token here>`

**Response (200)** – list of groups with `default_price_profile_id` / `default_leverage_profile_id`:
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "...",
      "description": "...",
      "status": "active",
      "priority": 1,
      "default_price_profile_id": "uuid-or-null",
      "default_leverage_profile_id": "uuid-or-null",
      "created_at": "...",
      "updated_at": "...",
      ...
    }
  ],
  "page": 1,
  "page_size": 20,
  "total": 1
}
```

---

## 3. List markup profiles (Price Stream Profile dropdown)

**Request**
- **Method:** `GET`
- **URL:** `http://localhost:3000/api/admin/markup/profiles`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <paste access_token here>`

**Response (200)** – array of price stream profiles (used for the “Price Stream Profile” dropdown):
```json
[
  {
    "id": "uuid",
    "name": "Default",
    "description": "...",
    "group_id": "uuid-or-null",
    "group_name": "string-or-null",
    "markup_type": "pips",
    "bid_markup": "0",
    "ask_markup": "0",
    "created_at": "...",
    "updated_at": "..."
  }
]
```

If you get **403** → user is not admin.  
If you get **500** → check auth-service logs.  
If you get **200** and `[]` → table `price_stream_profiles` is empty; create a profile via Admin → Markup or run the seed migration.

---

## 4. List leverage profiles (Leverage dropdown)

**Request**
- **Method:** `GET`
- **URL:** `http://localhost:3000/api/admin/leverage-profiles?page=1&page_size=100`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <paste access_token here>`

**Response (200):**
```json
{
  "items": [ { "id": "uuid", "name": "...", ... } ],
  "page": 1,
  "page_size": 100,
  "total": 1
}
```

---

## 5. Update group’s Price Stream Profile

**Request**
- **Method:** `PUT`
- **URL:** `http://localhost:3000/api/admin/groups/<group_id>/price-profile`
- **Headers:**
  - `Content-Type: application/json`
  - `Authorization: Bearer <paste access_token here>`
- **Body (raw JSON):**
```json
{
  "price_profile_id": "uuid-of-markup-profile"
}
```
Use `null` to clear: `"price_profile_id": null`

---

## Quick Postman setup

1. **Environment variable (optional)**  
   - Variable: `base_url` = `http://localhost:3000`  
   - Variable: `token` = (paste after login)

2. **Login**  
   - `POST {{base_url}}/api/auth/login`  
   - Body: `{"email":"admin@...","password":"..."}`  
   - In Tests tab:  
     `pm.environment.set("token", pm.response.json().access_token);`

3. **Markup profiles (dropdown)**  
   - `GET {{base_url}}/api/admin/markup/profiles`  
   - Auth: Bearer Token → `{{token}}`

4. **Groups list**  
   - `GET {{base_url}}/api/admin/groups`  
   - Auth: Bearer Token → `{{token}}`

This lets you confirm in Postman whether `GET /api/admin/markup/profiles` returns 200 and a non-empty array so the dropdown can show options.

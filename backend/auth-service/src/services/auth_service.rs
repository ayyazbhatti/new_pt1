use chrono::{Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::user::{PublicUser, User, UserSession, UserStatus};
use crate::utils::hash::{hash_password, hash_token, verify_password};
use crate::utils::jwt::{generate_access_token, generate_refresh_token, Claims, get_refresh_token_ttl};

/// Result of one row in bulk user creation.
#[derive(Debug, Clone)]
pub struct BulkUserResultItem {
    pub username: String,
    pub email: String,
    pub success: bool,
    pub user_id: Option<Uuid>,
    pub account_id: Option<Uuid>,
    pub error: Option<String>,
}

/// Result of bulk_create_users run.
#[derive(Debug)]
pub struct BulkCreateUsersResult {
    pub total: u32,
    pub success_count: u32,
    pub failed_count: u32,
    pub results: Vec<BulkUserResultItem>,
}

pub struct AuthService {
    pool: PgPool,
}

impl AuthService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn register(
        &self,
        first_name: &str,
        last_name: &str,
        email: &str,
        password: &str,
        country: Option<&str>,
        referral_code: Option<&str>,
        group_id: Option<Uuid>,
    ) -> anyhow::Result<(User, String, String)> {
        // Validate password
        if password.len() < 8 {
            return Err(anyhow::anyhow!("Password must be at least 8 characters"));
        }
        if !password.chars().any(|c| c.is_ascii_digit()) {
            return Err(anyhow::anyhow!("Password must contain at least one number"));
        }

        // Check if email already exists
        let email_lower = email.to_lowercase();
        let existing = sqlx::query_as::<_, User>(
            "SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL",
        )
        .bind(&email_lower)
        .fetch_optional(&self.pool)
        .await?;

        if existing.is_some() {
            return Err(anyhow::anyhow!("Email already registered"));
        }

        // Find referrer if referral code provided
        let referred_by_user_id: Option<Uuid> = if let Some(code) = referral_code {
            let referrer = sqlx::query_as::<_, User>(
                "SELECT * FROM users WHERE referral_code = $1 AND deleted_at IS NULL",
            )
            .bind(code)
            .fetch_optional(&self.pool)
            .await?;
            referrer.map(|u| u.id)
        } else {
            None
        };

        // Hash password
        let password_hash = hash_password(password)?;

        // Generate referral code for new user
        let user_referral_code = format!("REF{}", Uuid::new_v4().to_string().replace("-", "").chars().take(8).collect::<String>());

        // Resolve group: use provided group_id if valid and active, else default
        let default_group_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")
            .map_err(|_| anyhow::anyhow!("Invalid default group ID"))?;

        let assigned_group_id: Uuid = if let Some(gid) = group_id {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM user_groups WHERE id = $1 AND status = 'active')",
            )
            .bind(gid)
            .fetch_one(&self.pool)
            .await?;
            if valid {
                gid
            } else {
                default_group_id
            }
        } else {
            default_group_id
        };

        // Ensure default group exists (for when we use it)
        sqlx::query!(
            r#"
            INSERT INTO user_groups (id, name, description)
            VALUES ($1, 'Default', 'Default user group')
            ON CONFLICT (id) DO NOTHING
            "#,
            default_group_id
        )
        .execute(&self.pool)
        .await?;

        // Insert user
        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (
                email, password_hash, first_name, last_name, country,
                role, status, email_verified, referral_code, referred_by_user_id, group_id
            )
            VALUES ($1, $2, $3, $4, $5, 'user', $6, false, $7, $8, $9)
            RETURNING *
            "#,
        )
        .bind(&email_lower)
        .bind(&password_hash)
        .bind(first_name)
        .bind(last_name)
        .bind(country)
        .bind(UserStatus::Active)
        .bind(&user_referral_code)
        .bind(referred_by_user_id)
        .bind(assigned_group_id)
        .fetch_one(&self.pool)
        .await?;

        // Create session
        let (access_token, refresh_token) = self.create_session(&user).await?;

        // Log audit
        self.log_audit(user.id, "auth.register", serde_json::json!({
            "email": email_lower,
            "country": country,
            "referred_by": referred_by_user_id
        }))
        .await?;

        Ok((user, access_token, refresh_token))
    }

    pub async fn login(
        &self,
        email: &str,
        password: &str,
        user_agent: Option<&str>,
        ip: Option<&str>,
    ) -> anyhow::Result<(User, String, String)> {
        let email_lower = email.to_lowercase();

        // Find user
        let user = match sqlx::query_as::<_, User>(
            "SELECT * FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL",
        )
        .bind(&email_lower)
        .fetch_optional(&self.pool)
        .await?
        {
            Some(u) => u,
            None => {
                tracing::warn!("Login failed: no user found for email (lowercase) {:?}", email_lower);
                return Err(anyhow::anyhow!("Invalid credentials"));
            }
        };

        // Check status
        if user.status != UserStatus::Active {
            tracing::warn!("Login failed: user {} account not active (status: {:?})", user.id, user.status);
            return Err(anyhow::anyhow!("Account is not active"));
        }

        // Verify password
        if !verify_password(password, &user.password_hash)? {
            tracing::warn!("Login failed: password mismatch for user {}", user.id);
            return Err(anyhow::anyhow!("Invalid credentials"));
        }

        // Update last_login_at
        sqlx::query("UPDATE users SET last_login_at = $1 WHERE id = $2")
            .bind(Utc::now())
            .bind(user.id)
            .execute(&self.pool)
            .await?;

        // Create session
        let (access_token, refresh_token) = self.create_session_with_metadata(&user, user_agent, ip).await?;

        // Log audit
        self.log_audit(user.id, "auth.login", serde_json::json!({
            "email": email_lower,
            "ip": ip,
            "user_agent": user_agent
        }))
        .await?;

        Ok((user, access_token, refresh_token))
    }

    pub async fn refresh(&self, refresh_token: &str) -> anyhow::Result<String> {
        let token_hash = hash_token(refresh_token);

        // Find session
        let session = sqlx::query_as::<_, UserSession>(
            r#"
            SELECT * FROM user_sessions
            WHERE refresh_token_hash = $1
            AND is_revoked = false
            AND expires_at > NOW()
            "#,
        )
        .bind(&token_hash)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Invalid refresh token"))?;

        // Get user
        let user = sqlx::query_as::<_, User>(
            "SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(session.user_id)
        .fetch_one(&self.pool)
        .await?;

        // Check user status
        if user.status != UserStatus::Active {
            return Err(anyhow::anyhow!("Account is not active"));
        }

        // Generate new access token
        let claims = Claims::new(user.id, user.email.clone(), user.role.clone(), user.group_id);
        let access_token = generate_access_token(&claims)?;

        Ok(access_token)
    }

    pub async fn logout(&self, user_id: Uuid, refresh_token: &str) -> anyhow::Result<()> {
        let token_hash = hash_token(refresh_token);

        // Revoke session
        sqlx::query(
            r#"
            UPDATE user_sessions
            SET is_revoked = true
            WHERE user_id = $1 AND refresh_token_hash = $2
            "#,
        )
        .bind(user_id)
        .bind(&token_hash)
        .execute(&self.pool)
        .await?;

        // Log audit
        self.log_audit(user_id, "auth.logout", serde_json::json!({}))
            .await?;

        Ok(())
    }

    pub async fn get_user_by_id(&self, user_id: Uuid) -> anyhow::Result<User> {
        let user = sqlx::query_as::<_, User>(
            "SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL",
        )
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("User not found"))?;

        Ok(user)
    }

    /// Create a session for the target user (for admin impersonation). Returns (access_token, refresh_token).
    pub async fn impersonate(&self, target_user_id: Uuid) -> anyhow::Result<(String, String)> {
        let user = self.get_user_by_id(target_user_id).await?;
        self.create_session(&user).await
    }

    async fn create_session(&self, user: &User) -> anyhow::Result<(String, String)> {
        self.create_session_with_metadata(user, None, None).await
    }

    async fn create_session_with_metadata(
        &self,
        user: &User,
        user_agent: Option<&str>,
        ip: Option<&str>,
    ) -> anyhow::Result<(String, String)> {
        // Generate tokens
        let claims = Claims::new(user.id, user.email.clone(), user.role.clone(), user.group_id);
        let access_token = generate_access_token(&claims)?;
        let refresh_token = generate_refresh_token();
        let refresh_token_hash = hash_token(&refresh_token);

        // Calculate expiration
        let expires_at = Utc::now() + Duration::seconds(get_refresh_token_ttl());

        // Store session
        sqlx::query(
            r#"
            INSERT INTO user_sessions (
                user_id, refresh_token_hash, user_agent, ip, expires_at
            )
            VALUES ($1, $2, $3, $4, $5)
            "#,
        )
        .bind(user.id)
        .bind(&refresh_token_hash)
        .bind(user_agent)
        .bind(ip)
        .bind(expires_at)
        .execute(&self.pool)
        .await?;

        Ok((access_token, refresh_token))
    }

    pub async fn list_users(
        &self,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> anyhow::Result<Vec<User>> {
        let limit = limit.unwrap_or(100);
        let offset = offset.unwrap_or(0);

        let users = sqlx::query_as::<_, User>(
            r#"
            SELECT * FROM users
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
            "#,
        )
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok(users)
    }

    /// List users with server-side pagination and optional filters. Returns (users, total_count).
    pub async fn list_users_paginated(
        &self,
        search: Option<&str>,
        status: Option<&str>,
        group_id: Option<Uuid>,
        page: i64,
        page_size: i64,
    ) -> anyhow::Result<(Vec<User>, i64)> {
        let page = page.max(1);
        let page_size = page_size.clamp(1, 100);
        let offset = (page - 1) * page_size;

        let search_pattern = search.map(|s| format!("%{}%", s.trim()));
        let has_search = search_pattern.as_ref().map(|p| !p.is_empty()).unwrap_or(false);
        let status_filter: Option<String> = status
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty() && ["active", "disabled", "suspended"].contains(&s.as_str()));

        // Count total with same filters
        let total_row: (i64,) = sqlx::query_as(
            r#"
            SELECT COUNT(*)::bigint FROM users
            WHERE deleted_at IS NULL
              AND (NOT $1::boolean OR (email ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2))
              AND ($3::text IS NULL OR status::text = $3)
              AND ($4::uuid IS NULL OR group_id = $4)
            "#,
        )
        .bind(has_search)
        .bind(search_pattern.as_deref().unwrap_or("%"))
        .bind(status_filter.as_deref())
        .bind(group_id)
        .fetch_one(&self.pool)
        .await?;
        let total = total_row.0;

        // Fetch page
        let users = sqlx::query_as::<_, User>(
            r#"
            SELECT * FROM users
            WHERE deleted_at IS NULL
              AND (NOT $1::boolean OR (email ILIKE $2 OR first_name ILIKE $2 OR last_name ILIKE $2))
              AND ($3::text IS NULL OR status::text = $3)
              AND ($4::uuid IS NULL OR group_id = $4)
            ORDER BY created_at DESC
            LIMIT $5 OFFSET $6
            "#,
        )
        .bind(has_search)
        .bind(search_pattern.as_deref().unwrap_or("%"))
        .bind(status_filter.as_deref())
        .bind(group_id)
        .bind(page_size)
        .bind(offset)
        .fetch_all(&self.pool)
        .await?;

        Ok((users, total))
    }

    async fn log_audit(
        &self,
        actor_user_id: Uuid,
        action: &str,
        meta: serde_json::Value,
    ) -> anyhow::Result<()> {
        sqlx::query(
            "INSERT INTO audit_logs (actor_user_id, action, meta) VALUES ($1, $2, $3)",
        )
        .bind(actor_user_id)
        .bind(action)
        .bind(meta)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Bulk create users (admin only). One password hash for entire run; chunked inserts.
    /// Does not create sessions or send welcome emails. On email unique violation, records failed row and continues.
    #[allow(clippy::too_many_arguments)]
    pub async fn bulk_create_users(
        &self,
        count: u32,
        username_prefix: &str,
        email_domain: &str,
        password: &str,
        first_name_prefix: &str,
        last_name: &str,
        starting_number: i32,
        group_id: Option<Uuid>,
        account_mode: &str,
        _initial_balance_enabled: bool,
        _initial_balance_amount: Option<rust_decimal::Decimal>,
        _initial_balance_fee: Option<rust_decimal::Decimal>,
        _initial_balance_reference: Option<&str>,
    ) -> anyhow::Result<BulkCreateUsersResult> {
        if password.len() < 8 {
            return Err(anyhow::anyhow!("Password must be at least 8 characters"));
        }
        if !password.chars().any(|c| c.is_ascii_digit()) {
            return Err(anyhow::anyhow!("Password must contain at least one number"));
        }

        let password_hash = hash_password(password)?;

        let default_group_id = Uuid::parse_str("00000000-0000-0000-0000-000000000001")
            .map_err(|_| anyhow::anyhow!("Invalid default group ID"))?;

        let assigned_group_id: Uuid = if let Some(gid) = group_id {
            let valid = sqlx::query_scalar::<_, bool>(
                "SELECT EXISTS(SELECT 1 FROM user_groups WHERE id = $1 AND status = 'active')",
            )
            .bind(gid)
            .fetch_one(&self.pool)
            .await?;
            if valid {
                gid
            } else {
                default_group_id
            }
        } else {
            default_group_id
        };

        sqlx::query!(
            r#"
            INSERT INTO user_groups (id, name, description)
            VALUES ($1, 'Default', 'Default user group')
            ON CONFLICT (id) DO NOTHING
            "#,
            default_group_id
        )
        .execute(&self.pool)
        .await?;

        let mut results = Vec::with_capacity(count as usize);
        let mut success_count = 0u32;
        let mut failed_count = 0u32;

        for i in 0..(count as i32) {
            let num = starting_number + i;
            let username = format!("{}{:03}", username_prefix, num);
            let email = format!("{}@{}", username, email_domain);
            let email_lower = email.to_lowercase();
            let first_name = format!("{}{}", first_name_prefix, num);
            let user_referral_code =
                format!("REF{}", Uuid::new_v4().to_string().replace('-', "").chars().take(8).collect::<String>());

            let row = sqlx::query_as::<_, User>(
                r#"
                INSERT INTO users (
                    email, password_hash, first_name, last_name, country,
                    role, status, email_verified, referral_code, referred_by_user_id, group_id
                )
                VALUES ($1, $2, $3, $4, $5, 'user', $6, false, $7, $8, $9)
                RETURNING *
                "#,
            )
            .bind(&email_lower)
            .bind(&password_hash)
            .bind(&first_name)
            .bind(last_name)
            .bind::<Option<String>>(None)
            .bind(UserStatus::Active)
            .bind(&user_referral_code)
            .bind::<Option<Uuid>>(None)
            .bind(assigned_group_id)
            .fetch_optional(&self.pool)
            .await;

            match row {
                Ok(Some(user)) => {
                    success_count += 1;
                    results.push(BulkUserResultItem {
                        username: username.clone(),
                        email: email_lower,
                        success: true,
                        user_id: Some(user.id),
                        account_id: Some(user.id),
                        error: None,
                    });
                }
                Ok(None) => unreachable!(),
                Err(e) => {
                    let is_dup = e
                        .as_database_error()
                        .map(|d| d.is_unique_violation())
                        .unwrap_or(false);
                    failed_count += 1;
                    results.push(BulkUserResultItem {
                        username: username.clone(),
                        email: email_lower,
                        success: false,
                        user_id: None,
                        account_id: None,
                        error: Some(if is_dup {
                            "Email already exists".to_string()
                        } else {
                            e.to_string()
                        }),
                    });
                }
            }
        }

        Ok(BulkCreateUsersResult {
            total: count,
            success_count,
            failed_count,
            results,
        })
    }
}


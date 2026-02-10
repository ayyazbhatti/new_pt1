use chrono::{Duration, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::user::{PublicUser, User, UserSession, UserStatus};
use crate::utils::hash::{hash_password, hash_token, verify_password};
use crate::utils::jwt::{generate_access_token, generate_refresh_token, Claims, get_refresh_token_ttl};

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

        // Insert user
        let user = sqlx::query_as::<_, User>(
            r#"
            INSERT INTO users (
                email, password_hash, first_name, last_name, country,
                role, status, email_verified, referral_code, referred_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, 'user', $6, false, $7, $8)
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
        let user = sqlx::query_as::<_, User>(
            "SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL",
        )
        .bind(&email_lower)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Invalid credentials"))?;

        // Check status
        if user.status != UserStatus::Active {
            return Err(anyhow::anyhow!("Account is not active"));
        }

        // Verify password
        if !verify_password(password, &user.password_hash)? {
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
        let claims = Claims::new(user.id, user.email.clone(), user.role.clone());
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
        let claims = Claims::new(user.id, user.email.clone(), user.role.clone());
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
}


//! Permission profiles: CRUD and effective-permissions helper.
//! Matches the unified list in docs/PERMISSIONS_DYNAMIC_PLAN.md.

use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

/// All permission keys (single source of truth for backend). Must match frontend permissions.ts and plan.
pub const ALL_PERMISSION_KEYS: &[&str] = &[
    "leads:view_all",
    "leads:view_assigned",
    "leads:create",
    "leads:edit",
    "leads:delete",
    "leads:assign",
    "leads:change_stage",
    "leads:export",
    "leads:settings",
    "leads:templates",
    "leads:assignment",
    "leads:import",
    "trading:view",
    "trading:place_orders",
    "deposits:approve",
    "deposits:reject",
    "finance:view",
    "support:view",
    "support:reply",
    "users:view",
    "users:edit",
    "users:create",
    "groups:view",
    "groups:edit",
    "symbols:view",
    "symbols:edit",
    "markup:view",
    "markup:edit",
    "swap:view",
    "swap:edit",
    "leverage_profiles:view",
    "leverage_profiles:edit",
    "risk:view",
    "risk:edit",
    "reports:view",
    "dashboard:view",
    "bonus:view",
    "bonus:edit",
    "affiliate:view",
    "affiliate:edit",
    "permissions:view",
    "permissions:edit",
    "system:view",
    "settings:view",
    "settings:edit",
];

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PermissionProfile {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PermissionProfileGrant {
    pub profile_id: Uuid,
    pub permission_key: String,
}

pub struct PermissionProfilesService {
    pool: PgPool,
}

impl PermissionProfilesService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list(&self) -> anyhow::Result<Vec<(PermissionProfile, Vec<String>)>> {
        let profiles = sqlx::query_as::<_, PermissionProfile>(
            "SELECT id, name, description, created_at, updated_at FROM permission_profiles ORDER BY name",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut result = Vec::with_capacity(profiles.len());
        for p in profiles {
            let keys = sqlx::query_scalar::<_, String>(
                "SELECT permission_key FROM permission_profile_grants WHERE profile_id = $1 ORDER BY permission_key",
            )
            .bind(p.id)
            .fetch_all(&self.pool)
            .await?;
            result.push((p, keys));
        }
        Ok(result)
    }

    pub async fn get(&self, id: Uuid) -> anyhow::Result<Option<(PermissionProfile, Vec<String>)>> {
        let profile = sqlx::query_as::<_, PermissionProfile>(
            "SELECT id, name, description, created_at, updated_at FROM permission_profiles WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(ref p) = profile else {
            return Ok(None);
        };

        let keys = sqlx::query_scalar::<_, String>(
            "SELECT permission_key FROM permission_profile_grants WHERE profile_id = $1 ORDER BY permission_key",
        )
        .bind(p.id)
        .fetch_all(&self.pool)
        .await?;
        Ok(profile.map(|pr| (pr, keys)))
    }

    pub async fn create(
        &self,
        name: &str,
        description: Option<&str>,
        permission_keys: &[String],
    ) -> anyhow::Result<PermissionProfile> {
        let name_trim = name.trim();
        if name_trim.is_empty() {
            return Err(anyhow::anyhow!("Name is required"));
        }
        self.validate_permission_keys(permission_keys)?;

        let profile = sqlx::query_as::<_, PermissionProfile>(
            r#"
            INSERT INTO permission_profiles (name, description, created_at, updated_at)
            VALUES ($1, $2, NOW(), NOW())
            RETURNING id, name, description, created_at, updated_at
            "#,
        )
        .bind(name_trim)
        .bind(description.map(|s| s.trim()).filter(|s| !s.is_empty()))
        .fetch_one(&self.pool)
        .await?;

        for key in permission_keys {
            let k = key.trim();
            if k.is_empty() {
                continue;
            }
            sqlx::query(
                "INSERT INTO permission_profile_grants (profile_id, permission_key) VALUES ($1, $2) ON CONFLICT (profile_id, permission_key) DO NOTHING",
            )
            .bind(profile.id)
            .bind(k)
            .execute(&self.pool)
            .await?;
        }

        Ok(profile)
    }

    pub async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        description: Option<Option<String>>,
        permission_keys: Option<&[String]>,
    ) -> anyhow::Result<Option<PermissionProfile>> {
        let existing = sqlx::query_as::<_, PermissionProfile>(
            "SELECT id, name, description, created_at, updated_at FROM permission_profiles WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        let Some(profile) = existing else {
            return Ok(None);
        };

        if let Some(n) = name {
            let n = n.trim();
            if !n.is_empty() {
                sqlx::query("UPDATE permission_profiles SET name = $1, updated_at = NOW() WHERE id = $2")
                    .bind(n)
                    .bind(id)
                    .execute(&self.pool)
                    .await?;
            }
        }
        if let Some(desc) = description {
            let val = desc.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()).map(|s| s.to_string());
            sqlx::query("UPDATE permission_profiles SET description = $1, updated_at = NOW() WHERE id = $2")
                .bind(val)
                .bind(id)
                .execute(&self.pool)
                .await?;
        }
        if let Some(keys) = permission_keys {
            self.validate_permission_keys(keys)?;
            sqlx::query("DELETE FROM permission_profile_grants WHERE profile_id = $1")
                .bind(id)
                .execute(&self.pool)
                .await?;
            for key in keys {
                let k = key.trim();
                if k.is_empty() {
                    continue;
                }
                sqlx::query(
                    "INSERT INTO permission_profile_grants (profile_id, permission_key) VALUES ($1, $2)",
                )
                .bind(id)
                .bind(k)
                .execute(&self.pool)
                .await?;
            }
            sqlx::query("UPDATE permission_profiles SET updated_at = NOW() WHERE id = $1")
                .bind(id)
                .execute(&self.pool)
                .await?;
        }

        let updated = sqlx::query_as::<_, PermissionProfile>(
            "SELECT id, name, description, created_at, updated_at FROM permission_profiles WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(updated)
    }

    pub async fn delete(&self, id: Uuid) -> anyhow::Result<bool> {
        let in_use: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM users WHERE permission_profile_id = $1",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        if in_use.0 > 0 {
            return Err(anyhow::anyhow!(
                "Cannot delete profile: {} user(s) are assigned to it",
                in_use.0
            ));
        }

        let result = sqlx::query("DELETE FROM permission_profiles WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    fn validate_permission_keys(&self, keys: &[String]) -> anyhow::Result<()> {
        let set: std::collections::HashSet<&str> = ALL_PERMISSION_KEYS.iter().copied().collect();
        for k in keys {
            let key = k.trim();
            if key.is_empty() {
                continue;
            }
            if !set.contains(key) {
                return Err(anyhow::anyhow!("Unknown permission key: {}", key));
            }
        }
        Ok(())
    }

    /// Returns effective permission keys for a user: from profile if set, else empty for non-admin; admin always gets all keys.
    /// Caller should pass role and permission_profile_id from the user row.
    pub async fn get_effective_permissions(
        &self,
        role: &str,
        permission_profile_id: Option<Uuid>,
    ) -> Vec<String> {
        let role_lower = role.to_lowercase();
        if role_lower == "admin" {
            return ALL_PERMISSION_KEYS.iter().map(|s| (*s).to_string()).collect();
        }

        let Some(profile_id) = permission_profile_id else {
            return Vec::new();
        };

        let keys: Vec<String> = sqlx::query_scalar::<_, String>(
            "SELECT permission_key FROM permission_profile_grants WHERE profile_id = $1 ORDER BY permission_key",
        )
        .bind(profile_id)
        .fetch_all(&self.pool)
        .await
        .unwrap_or_default();
        keys
    }
}

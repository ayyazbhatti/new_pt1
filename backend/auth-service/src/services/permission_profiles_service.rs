//! Permission profiles: CRUD and effective-permissions helper.
//! Permission definitions (categories + permissions) come from DB (permission_categories, permissions).

use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PermissionProfile {
    pub id: Uuid,
    pub name: String,
    pub description: Option<String>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
    /// User (manager/admin/super_admin) who created this profile.
    pub created_by_user_id: Option<Uuid>,
    pub created_by_email: Option<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct PermissionProfileGrant {
    pub profile_id: Uuid,
    pub permission_key: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PermissionDefinition {
    pub id: Uuid,
    pub key: String,
    pub label: String,
    pub sort_order: i32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CategoryWithPermissions {
    pub id: Uuid,
    pub name: String,
    pub sort_order: i32,
    pub permissions: Vec<PermissionDefinition>,
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
            r#"
            SELECT pp.id, pp.name, pp.description, pp.created_at, pp.updated_at,
                   pp.created_by_user_id, creator.email AS created_by_email
            FROM permission_profiles pp
            LEFT JOIN users creator ON creator.id = pp.created_by_user_id
            ORDER BY pp.name
            "#,
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
            r#"
            SELECT pp.id, pp.name, pp.description, pp.created_at, pp.updated_at,
                   pp.created_by_user_id, creator.email AS created_by_email
            FROM permission_profiles pp
            LEFT JOIN users creator ON creator.id = pp.created_by_user_id
            WHERE pp.id = $1
            "#,
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
        created_by_user_id: Option<Uuid>,
    ) -> anyhow::Result<PermissionProfile> {
        let name_trim = name.trim();
        if name_trim.is_empty() {
            return Err(anyhow::anyhow!("Name is required"));
        }
        self.validate_permission_keys(permission_keys).await?;

        let id = sqlx::query_scalar::<_, Uuid>(
            r#"
            INSERT INTO permission_profiles (name, description, created_at, updated_at, created_by_user_id)
            VALUES ($1, $2, NOW(), NOW(), $3)
            RETURNING id
            "#,
        )
        .bind(name_trim)
        .bind(description.map(|s| s.trim()).filter(|s| !s.is_empty()))
        .bind(created_by_user_id)
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
            .bind(id)
            .bind(k)
            .execute(&self.pool)
            .await?;
        }

        let profile = sqlx::query_as::<_, PermissionProfile>(
            r#"
            SELECT pp.id, pp.name, pp.description, pp.created_at, pp.updated_at,
                   pp.created_by_user_id, creator.email AS created_by_email
            FROM permission_profiles pp
            LEFT JOIN users creator ON creator.id = pp.created_by_user_id
            WHERE pp.id = $1
            "#,
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;
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
            r#"
            SELECT pp.id, pp.name, pp.description, pp.created_at, pp.updated_at,
                   pp.created_by_user_id, creator.email AS created_by_email
            FROM permission_profiles pp
            LEFT JOIN users creator ON creator.id = pp.created_by_user_id
            WHERE pp.id = $1
            "#,
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
            self.validate_permission_keys(keys).await?;
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
            r#"
            SELECT pp.id, pp.name, pp.description, pp.created_at, pp.updated_at,
                   pp.created_by_user_id, creator.email AS created_by_email
            FROM permission_profiles pp
            LEFT JOIN users creator ON creator.id = pp.created_by_user_id
            WHERE pp.id = $1
            "#,
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

    async fn validate_permission_keys(&self, keys: &[String]) -> anyhow::Result<()> {
        for k in keys {
            let key = k.trim();
            if key.is_empty() {
                continue;
            }
            let exists: (bool,) = sqlx::query_as(
                "SELECT EXISTS(SELECT 1 FROM permissions WHERE permission_key = $1)",
            )
            .bind(key)
            .fetch_one(&self.pool)
            .await?;
            if !exists.0 {
                return Err(anyhow::anyhow!("Unknown permission key: {}", key));
            }
        }
        Ok(())
    }

    /// List permission categories with their permissions (for admin UI). From DB.
    pub async fn list_categories_with_permissions(
        &self,
    ) -> anyhow::Result<Vec<CategoryWithPermissions>> {
        let categories: Vec<(Uuid, String, i32)> = sqlx::query_as(
            "SELECT id, name, sort_order FROM permission_categories ORDER BY sort_order, name",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut result = Vec::with_capacity(categories.len());
        for (cat_id, name, sort_order) in categories {
            let perms: Vec<(Uuid, String, String, i32)> = sqlx::query_as(
                "SELECT id, permission_key, label, sort_order FROM permissions WHERE category_id = $1 ORDER BY sort_order, permission_key",
            )
            .bind(cat_id)
            .fetch_all(&self.pool)
            .await?;
            let permissions = perms
                .into_iter()
                .map(|(id, permission_key, label, sort_order)| PermissionDefinition {
                    id,
                    key: permission_key,
                    label,
                    sort_order,
                })
                .collect();
            result.push(CategoryWithPermissions {
                id: cat_id,
                name,
                sort_order,
                permissions,
            });
        }
        Ok(result)
    }

    /// Returns effective permission keys for a user from their assigned permission profile.
    /// Admin and manager are treated the same: both get only the permissions granted by their profile.
    /// If no profile is assigned, returns empty (user must have a profile to access admin pages).
    pub async fn get_effective_permissions(
        &self,
        _role: &str,
        permission_profile_id: Option<Uuid>,
    ) -> Vec<String> {
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

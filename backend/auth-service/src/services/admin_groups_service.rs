use std::collections::HashMap;
use chrono::{DateTime, Utc};
use rand::Rng;
use rust_decimal::prelude::FromPrimitive;
use sqlx::PgPool;
use uuid::Uuid;
use crate::models::user_group::UserGroup;

/// Generate a random alphanumeric slug of length 5-7 (lowercase + digits). Used when no custom slug provided.
fn generate_signup_slug() -> String {
    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    let len = rng.gen_range(5..=7);
    (0..len)
        .map(|_| {
            let i = rng.gen_range(0..CHARS.len());
            CHARS[i] as char
        })
        .collect()
}

/// Validate custom signup slug: 3-20 chars, only a-z, A-Z, 0-9. Stored lowercase.
fn normalize_and_validate_slug(slug: &str) -> anyhow::Result<String> {
    let s = slug.trim().to_lowercase();
    if s.len() < 3 || s.len() > 20 {
        return Err(anyhow::anyhow!("Signup slug must be 3–20 characters"));
    }
    if !s.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(anyhow::anyhow!("Signup slug can only contain letters and numbers"));
    }
    Ok(s)
}

/// Group symbol row for list response (symbol_id, symbol_code, leverage_profile_id, leverage_profile_name, enabled).
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct GroupSymbolRow {
    pub symbol_id: Uuid,
    pub symbol_code: String,
    pub leverage_profile_id: Option<Uuid>,
    pub leverage_profile_name: Option<String>,
    pub enabled: bool,
}

/// Input for upserting one symbol's settings for a group.
pub struct GroupSymbolInput {
    pub symbol_id: Uuid,
    pub leverage_profile_id: Option<Uuid>,
    pub enabled: bool,
}

/// Row without profile/signup_slug columns (for DBs that haven't run those migrations).
#[derive(sqlx::FromRow)]
struct UserGroupRowMinimal {
    id: Uuid,
    name: String,
    description: Option<String>,
    status: String,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<UserGroupRowMinimal> for UserGroup {
    fn from(r: UserGroupRowMinimal) -> Self {
        UserGroup {
            id: r.id,
            name: r.name,
            description: r.description,
            status: r.status,
            signup_slug: None,
            default_price_profile_id: None,
            default_leverage_profile_id: None,
            margin_call_level: None,
            stop_out_level: None,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }
    }
}

pub struct AdminGroupsService {
    pool: PgPool,
}

impl AdminGroupsService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_groups(
        &self,
        search: Option<&str>,
        status: Option<&str>,
        page: Option<i64>,
        page_size: Option<i64>,
        sort: Option<&str>,
    ) -> anyhow::Result<(Vec<UserGroup>, i64)> {
        let page = page.unwrap_or(1);
        let page_size = page_size.unwrap_or(20);
        let offset = (page - 1) * page_size;

        let mut count_query = sqlx::QueryBuilder::new(
            "SELECT COUNT(*) FROM user_groups WHERE 1=1"
        );

        if let Some(search) = search {
            if !search.is_empty() {
                count_query.push(" AND name ILIKE ");
                count_query.push_bind(format!("%{}%", search));
            }
        }
        if let Some(status) = status {
            if status != "all" {
                count_query.push(" AND status = ");
                count_query.push_bind(status);
            }
        }

        let total: i64 = count_query
            .build_query_scalar()
            .fetch_one(&self.pool)
            .await?;

        let order_by = match sort {
            Some("name_asc") => "name ASC",
            Some("created_desc") => "created_at DESC",
            _ => "created_at DESC",
        };

        // Try full query with profile columns first; fallback to minimal if columns missing
        let groups = match self
            .list_groups_full(search, status, page_size, offset, order_by)
            .await
        {
            Ok(g) => g,
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("default_price_profile_id")
                    || msg.contains("default_leverage_profile_id")
                    || msg.contains("does not exist")
                {
                    self.list_groups_minimal(search, status, page_size, offset, order_by)
                        .await?
                } else {
                    return Err(e);
                }
            }
        };

        Ok((groups, total))
    }

    async fn list_groups_full(
        &self,
        search: Option<&str>,
        status: Option<&str>,
        page_size: i64,
        offset: i64,
        order_by: &str,
    ) -> anyhow::Result<Vec<UserGroup>> {
        let mut query = sqlx::QueryBuilder::new(
            "SELECT id, name, description, status, signup_slug, default_price_profile_id, \
             default_leverage_profile_id, margin_call_level, stop_out_level, created_at, updated_at FROM user_groups WHERE 1=1"
        );
        if let Some(search) = search {
            if !search.is_empty() {
                query.push(" AND name ILIKE ");
                query.push_bind(format!("%{}%", search));
            }
        }
        if let Some(status) = status {
            if status != "all" {
                query.push(" AND status = ");
                query.push_bind(status);
            }
        }
        query.push(" ORDER BY ");
        query.push(order_by);
        query.push(" LIMIT ");
        query.push_bind(page_size);
        query.push(" OFFSET ");
        query.push_bind(offset);

        let groups = query
            .build_query_as::<UserGroup>()
            .fetch_all(&self.pool)
            .await?;
        Ok(groups)
    }

    async fn list_groups_minimal(
        &self,
        search: Option<&str>,
        status: Option<&str>,
        page_size: i64,
        offset: i64,
        order_by: &str,
    ) -> anyhow::Result<Vec<UserGroup>> {
        let mut query = sqlx::QueryBuilder::new(
            "SELECT id, name, description, status, created_at, updated_at \
             FROM user_groups WHERE 1=1"
        );
        if let Some(search) = search {
            if !search.is_empty() {
                query.push(" AND name ILIKE ");
                query.push_bind(format!("%{}%", search));
            }
        }
        if let Some(status) = status {
            if status != "all" {
                query.push(" AND status = ");
                query.push_bind(status);
            }
        }
        query.push(" ORDER BY ");
        query.push(order_by);
        query.push(" LIMIT ");
        query.push_bind(page_size);
        query.push(" OFFSET ");
        query.push_bind(offset);

        let rows = query
            .build_query_as::<UserGroupRowMinimal>()
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(UserGroup::from).collect())
    }

    pub async fn get_group_by_id(&self, id: Uuid) -> anyhow::Result<UserGroup> {
        let group = sqlx::query_as::<_, UserGroup>(
            "SELECT * FROM user_groups WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Group not found"))?;

        Ok(group)
    }

    /// Resolve signup_slug to group id if group exists and is active. Used at register.
    pub async fn resolve_group_id_by_signup_slug(&self, slug: &str) -> anyhow::Result<Option<Uuid>> {
        let slug = slug.trim().to_lowercase();
        if slug.is_empty() {
            return Ok(None);
        }
        let id: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM user_groups WHERE signup_slug = $1 AND status = 'active'",
        )
        .bind(&slug)
        .fetch_optional(&self.pool)
        .await?;
        Ok(id)
    }

    pub async fn create_group(
        &self,
        name: &str,
        description: Option<&str>,
        status: &str,
        margin_call_level: Option<f64>,
        stop_out_level: Option<f64>,
        signup_slug: Option<&str>,
    ) -> anyhow::Result<UserGroup> {
        // Validate
        if name.len() < 2 || name.len() > 40 {
            return Err(anyhow::anyhow!("Name must be between 2 and 40 characters"));
        }

        let slug: Option<String> = match signup_slug {
            Some(s) if !s.trim().is_empty() => Some(normalize_and_validate_slug(s)?),
            _ => {
                let mut candidate = generate_signup_slug();
                for _ in 0..20 {
                    let exists: bool = sqlx::query_scalar(
                        "SELECT EXISTS(SELECT 1 FROM user_groups WHERE signup_slug = $1)",
                    )
                    .bind(&candidate)
                    .fetch_one(&self.pool)
                    .await?;
                    if !exists {
                        break;
                    }
                    candidate = generate_signup_slug();
                }
                Some(candidate)
            }
        };

        let group = sqlx::query_as::<_, UserGroup>(
            r#"
            INSERT INTO user_groups (
                name, description, status, signup_slug, margin_call_level, stop_out_level
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(name)
        .bind(description)
        .bind(status)
        .bind(&slug)
        .bind(margin_call_level.and_then(rust_decimal::Decimal::from_f64))
        .bind(stop_out_level.and_then(rust_decimal::Decimal::from_f64))
        .fetch_one(&self.pool)
        .await?;

        Ok(group)
    }

    pub async fn update_group(
        &self,
        id: Uuid,
        name: &str,
        description: Option<&str>,
        status: &str,
        margin_call_level: Option<f64>,
        stop_out_level: Option<f64>,
        signup_slug: Option<Option<&str>>,
    ) -> anyhow::Result<UserGroup> {
        // Validate (same as create)
        if name.len() < 2 || name.len() > 40 {
            return Err(anyhow::anyhow!("Name must be between 2 and 40 characters"));
        }

        let slug_value: Option<String> = match signup_slug {
            None => None,
            Some(None) => None,
            Some(Some(s)) if s.trim().is_empty() => None,
            Some(Some(s)) => Some(normalize_and_validate_slug(s)?),
        };

        let group = sqlx::query_as::<_, UserGroup>(
            r#"
            UPDATE user_groups
            SET 
                name = $2,
                description = $3,
                status = $4,
                margin_call_level = $5,
                stop_out_level = $6,
                signup_slug = $7,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(status)
        .bind(margin_call_level.and_then(rust_decimal::Decimal::from_f64))
        .bind(stop_out_level.and_then(rust_decimal::Decimal::from_f64))
        .bind(&slug_value)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Group not found"))?;

        Ok(group)
    }

    pub async fn delete_group(&self, id: Uuid) -> anyhow::Result<()> {
        // Check if group has users
        let user_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM users WHERE group_id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        if user_count > 0 {
            return Err(anyhow::anyhow!("Group has assigned users"));
        }

        sqlx::query("DELETE FROM user_groups WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn get_group_usage(&self, id: Uuid) -> anyhow::Result<i64> {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM users WHERE group_id = $1 AND deleted_at IS NULL",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        Ok(count)
    }

    /// Fetch id -> name for price stream profiles by ids. Used to enrich list_groups response.
    pub async fn get_price_profile_names(&self, ids: &[Uuid]) -> anyhow::Result<HashMap<Uuid, String>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        #[derive(sqlx::FromRow)]
        struct ProfileRow { id: Uuid, name: String }
        let rows = sqlx::query_as::<_, ProfileRow>(
            "SELECT id, name FROM price_stream_profiles WHERE id = ANY($1)",
        )
        .bind(ids)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| (r.id, r.name)).collect())
    }

    /// Fetch id -> name for leverage profiles by ids. Used to enrich list_groups response.
    pub async fn get_leverage_profile_names(&self, ids: &[Uuid]) -> anyhow::Result<HashMap<Uuid, String>> {
        if ids.is_empty() {
            return Ok(HashMap::new());
        }
        #[derive(sqlx::FromRow)]
        struct LeverageRow { id: Uuid, name: String }
        let rows = sqlx::query_as::<_, LeverageRow>(
            "SELECT id, name FROM leverage_profiles WHERE id = ANY($1)",
        )
        .bind(ids)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| (r.id, r.name)).collect())
    }

    /// List all price stream profiles (id, name) for dropdown options in groups UI.
    pub async fn list_all_price_profiles(&self) -> anyhow::Result<Vec<(Uuid, String)>> {
        #[derive(sqlx::FromRow)]
        struct Row { id: Uuid, name: String }
        let rows = sqlx::query_as::<_, Row>(
            "SELECT id, name FROM price_stream_profiles ORDER BY name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|r| (r.id, r.name)).collect())
    }

    /// List all symbols with per-group settings applied. For each symbol: use group_symbols override if present, else group default leverage + symbol default enabled.
    pub async fn list_group_symbols(&self, group_id: Uuid) -> anyhow::Result<Vec<GroupSymbolRow>> {
        let rows = sqlx::query_as::<_, GroupSymbolRow>(
            r#"
            SELECT
                s.id AS symbol_id,
                s.code AS symbol_code,
                COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id) AS leverage_profile_id,
                (SELECT lp2.name FROM leverage_profiles lp2 WHERE lp2.id = COALESCE(gs.leverage_profile_id, ug.default_leverage_profile_id)) AS leverage_profile_name,
                COALESCE(gs.enabled, s.trading_enabled) AS enabled
            FROM symbols s
            CROSS JOIN user_groups ug
            LEFT JOIN group_symbols gs ON gs.symbol_id = s.id AND gs.group_id = ug.id
            WHERE ug.id = $1
            ORDER BY s.code
            "#,
        )
        .bind(group_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// Upsert group symbol settings. Replaces all settings for the group with the given list.
    pub async fn upsert_group_symbols(
        &self,
        group_id: Uuid,
        symbols: &[GroupSymbolInput],
    ) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM group_symbols WHERE group_id = $1")
            .bind(group_id)
            .execute(&mut *tx)
            .await?;
        for s in symbols {
            sqlx::query(
                r#"
                INSERT INTO group_symbols (group_id, symbol_id, leverage_profile_id, enabled)
                VALUES ($1, $2, $3, $4)
                "#,
            )
            .bind(group_id)
            .bind(s.symbol_id)
            .bind(s.leverage_profile_id)
            .bind(s.enabled)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// Get tag IDs assigned to each group (entity_type = 'group'). Returns map group_id -> vec of tag_id.
    pub async fn get_tag_ids_for_groups(&self, group_ids: &[Uuid]) -> anyhow::Result<HashMap<Uuid, Vec<Uuid>>> {
        if group_ids.is_empty() {
            return Ok(HashMap::new());
        }
        #[derive(sqlx::FromRow)]
        struct Row { entity_id: Uuid, tag_id: Uuid }
        let rows = sqlx::query_as::<_, Row>(
            "SELECT entity_id, tag_id FROM tag_assignments WHERE entity_type = 'group' AND entity_id = ANY($1)",
        )
        .bind(group_ids)
        .fetch_all(&self.pool)
        .await?;
        let mut map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
        for r in rows {
            map.entry(r.entity_id).or_default().push(r.tag_id);
        }
        Ok(map)
    }

    /// Replace tag assignments for a group. Removes existing and inserts the given tag_ids.
    pub async fn set_group_tags(&self, group_id: Uuid, tag_ids: &[Uuid]) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM tag_assignments WHERE entity_type = 'group' AND entity_id = $1")
            .bind(group_id)
            .execute(&mut *tx)
            .await?;
        for tag_id in tag_ids {
            sqlx::query(
                "INSERT INTO tag_assignments (tag_id, entity_type, entity_id, created_at) VALUES ($1, 'group', $2, NOW())",
            )
            .bind(tag_id)
            .bind(group_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }
}


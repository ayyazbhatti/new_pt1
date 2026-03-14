use std::collections::HashMap;
use sqlx::{PgPool, postgres::PgRow, Row};
use uuid::Uuid;
use serde::Serialize;
use crate::models::leverage_profile::{LeverageProfile, LeverageProfileTier, LeverageProfileWithCounts};

pub struct AdminLeverageProfilesService {
    pool: PgPool,
}

impl AdminLeverageProfilesService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// List leverage profiles with optional filter by allowed profile IDs (tag-scoped: admin sees only profiles sharing a tag with them).
    /// When `allowed_profile_ids` is `None` (e.g. super_admin), all profiles are returned.
    /// When `Some(ids)` with empty slice, returns 0 profiles. When `Some(ids)` with non-empty, only those profiles.
    pub async fn list_profiles(
        &self,
        search: Option<&str>,
        status: Option<&str>,
        page: Option<i64>,
        page_size: Option<i64>,
        sort: Option<&str>,
        allowed_profile_ids: Option<&[Uuid]>,
    ) -> anyhow::Result<(Vec<LeverageProfileWithCounts>, i64)> {
        let page = page.unwrap_or(1);
        let page_size = page_size.unwrap_or(20);
        let offset = (page - 1) * page_size;

        if let Some(ids) = allowed_profile_ids {
            if ids.is_empty() {
                return Ok((vec![], 0));
            }
        }

        let mut query = sqlx::QueryBuilder::new(
            r#"
            SELECT 
                lp.id,
                lp.name,
                lp.description,
                lp.status::text as status,
                lp.created_at,
                lp.updated_at,
                COALESCE(COUNT(DISTINCT lpt.id), 0)::bigint as tiers_count,
                COALESCE(COUNT(DISTINCT slpa.symbol_id), 0)::bigint as symbols_count,
                lp.created_by_user_id,
                creator.email as created_by_email,
                COALESCE(lp.is_default, false) as is_default
            FROM leverage_profiles lp
            LEFT JOIN leverage_profile_tiers lpt ON lp.id = lpt.profile_id
            LEFT JOIN symbol_leverage_profile_assignments slpa ON lp.id = slpa.profile_id
            LEFT JOIN users creator ON creator.id = lp.created_by_user_id
            WHERE 1=1
            "#
        );
        let mut count_query = sqlx::QueryBuilder::new(
            "SELECT COUNT(*) FROM leverage_profiles WHERE 1=1"
        );

        if let Some(search) = search {
            if !search.is_empty() {
                query.push(" AND lp.name ILIKE ");
                query.push_bind(format!("%{}%", search));
                count_query.push(" AND name ILIKE ");
                count_query.push_bind(format!("%{}%", search));
            }
        }

        if let Some(status) = status {
            if status != "all" {
                query.push(" AND lp.status::text = ");
                query.push_bind(status);
                count_query.push(" AND status::text = ");
                count_query.push_bind(status);
            }
        }

        if let Some(ids) = allowed_profile_ids {
            query.push(" AND lp.id = ANY(");
            query.push_bind(ids);
            query.push(")");
            count_query.push(" AND id = ANY(");
            count_query.push_bind(ids);
            count_query.push(")");
        }

        query.push(" GROUP BY lp.id, lp.name, lp.description, lp.status::text, lp.created_at, lp.updated_at, lp.created_by_user_id, creator.email, lp.is_default");

        let order_by = match sort {
            Some("name_asc") => "lp.name ASC",
            Some("created_desc") => "lp.created_at DESC",
            _ => "lp.updated_at DESC",
        };
        query.push(" ORDER BY ");
        query.push(order_by);

        query.push(" LIMIT ");
        query.push_bind(page_size);
        query.push(" OFFSET ");
        query.push_bind(offset);

        let rows = query
            .build_query_as::<LeverageProfileWithCounts>()
            .fetch_all(&self.pool)
            .await?;

        let total: i64 = count_query
            .build_query_scalar()
            .fetch_one(&self.pool)
            .await?;

        Ok((rows, total))
    }

    pub async fn get_profile_by_id(&self, id: Uuid) -> anyhow::Result<LeverageProfile> {
        let profile = sqlx::query_as::<_, LeverageProfile>(
            "SELECT id, name, description, status::text as status, created_at, updated_at, created_by_user_id, COALESCE(is_default, false) as is_default FROM leverage_profiles WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Profile not found"))?;

        Ok(profile)
    }

    pub async fn create_profile(
        &self,
        name: &str,
        description: Option<&str>,
        status: &str,
        created_by_user_id: Option<Uuid>,
    ) -> anyhow::Result<LeverageProfile> {
        if name.len() < 2 || name.len() > 60 {
            return Err(anyhow::anyhow!("Name must be between 2 and 60 characters"));
        }

        let profile = sqlx::query_as::<_, LeverageProfile>(
            r#"
            INSERT INTO leverage_profiles (name, description, status, created_by_user_id)
            VALUES ($1, $2, $3::user_status, $4)
            RETURNING id, name, description, status::text as status, created_at, updated_at, created_by_user_id, COALESCE(is_default, false) as is_default
            "#,
        )
        .bind(name)
        .bind(description)
        .bind(status)
        .bind(created_by_user_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(profile)
    }

    pub async fn update_profile(
        &self,
        id: Uuid,
        name: &str,
        description: Option<&str>,
        status: &str,
    ) -> anyhow::Result<LeverageProfile> {
        if name.len() < 2 || name.len() > 60 {
            return Err(anyhow::anyhow!("Name must be between 2 and 60 characters"));
        }

        let profile = sqlx::query_as::<_, LeverageProfile>(
            r#"
            UPDATE leverage_profiles
            SET name = $2, description = $3, status = $4::user_status, updated_at = NOW()
            WHERE id = $1
            RETURNING id, name, description, status::text as status, created_at, updated_at, created_by_user_id, COALESCE(is_default, false) as is_default
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(description)
        .bind(status)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Profile not found"))?;

        Ok(profile)
    }

    /// Set this profile as the system default. Clears is_default on all others so only one is default.
    pub async fn set_as_default(&self, id: Uuid) -> anyhow::Result<LeverageProfile> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE leverage_profiles SET is_default = false WHERE is_default = true")
            .execute(&mut *tx)
            .await?;
        let profile = sqlx::query_as::<_, LeverageProfile>(
            "UPDATE leverage_profiles SET is_default = true, updated_at = NOW() WHERE id = $1 RETURNING id, name, description, status::text as status, created_at, updated_at, created_by_user_id, is_default",
        )
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Profile not found"))?;
        tx.commit().await?;
        Ok(profile)
    }

    pub async fn delete_profile(&self, id: Uuid) -> anyhow::Result<()> {
        // Check if profile has symbols assigned
        let symbols_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM symbol_leverage_profile_assignments WHERE profile_id = $1",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await?;

        if symbols_count > 0 {
            return Err(anyhow::anyhow!("Profile has assigned symbols"));
        }

        // Delete profile (tiers cascade via FK)
        sqlx::query("DELETE FROM leverage_profiles WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn list_tiers(&self, profile_id: Uuid) -> anyhow::Result<Vec<LeverageProfileTier>> {
        let tiers = sqlx::query(
            r#"
            SELECT id, profile_id, tier_index, 
                notional_from::text, notional_to::text, 
                max_leverage, initial_margin_percent::text, maintenance_margin_percent::text,
                created_at, updated_at
            FROM leverage_profile_tiers
            WHERE profile_id = $1
            ORDER BY tier_index ASC
            "#,
        )
        .bind(profile_id)
        .map(|row: PgRow| LeverageProfileTier {
            id: row.get(0),
            profile_id: row.get(1),
            tier_index: row.get(2),
            notional_from: row.get(3),
            notional_to: row.get(4),
            max_leverage: row.get(5),
            initial_margin_percent: row.get(6),
            maintenance_margin_percent: row.get(7),
            created_at: row.get(8),
            updated_at: row.get(9),
        })
        .fetch_all(&self.pool)
        .await?;

        Ok(tiers)
    }

    pub async fn create_tier(
        &self,
        profile_id: Uuid,
        tier_index: i32,
        notional_from: String,
        notional_to: Option<String>,
        max_leverage: i32,
        initial_margin_percent: String,
        maintenance_margin_percent: String,
    ) -> anyhow::Result<LeverageProfileTier> {
        // Validate
        if tier_index < 1 {
            return Err(anyhow::anyhow!("Tier index must be >= 1"));
        }
        if max_leverage < 1 {
            return Err(anyhow::anyhow!("Max leverage must be >= 1"));
        }
        
        // Validate notional ranges (using references to avoid move)
        if let Some(ref to) = notional_to {
            if to <= &notional_from {
                return Err(anyhow::anyhow!("notional_to must be > notional_from"));
            }
        }

        // Check for overlapping tiers
        let notional_to_max = notional_to.as_ref().map(|s| s.as_str()).unwrap_or("999999999999");
        let notional_to_opt = notional_to.as_ref().map(|s| s.as_str());
        let overlapping = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*) FROM leverage_profile_tiers
            WHERE profile_id = $1
            AND (
                (notional_from::numeric < $3::numeric AND (notional_to IS NULL OR notional_to::numeric > $2::numeric))
                OR ($4 IS NULL AND notional_from::numeric < $3::numeric)
                OR (notional_from::numeric >= $2::numeric AND (notional_to IS NULL OR notional_to::numeric <= $3::numeric))
            )
            "#,
        )
        .bind(profile_id)
        .bind(&notional_from)
        .bind(notional_to_max)
        .bind(notional_to_opt)
        .fetch_one(&self.pool)
        .await?;

        if overlapping > 0 {
            return Err(anyhow::anyhow!("Tier ranges cannot overlap"));
        }

        // Handle nullable notional_to - use a default large value if null for margin_to
        let notional_to_value = notional_to.as_ref().map(|s| s.as_str());
        let margin_to_value = notional_to.as_ref().map(|s| s.as_str()).unwrap_or("999999999999");
        
        let tier = sqlx::query(
            r#"
            INSERT INTO leverage_profile_tiers (
                profile_id, tier_index, notional_from, notional_to,
                max_leverage, initial_margin_percent, maintenance_margin_percent,
                margin_from, margin_to
            )
            VALUES ($1, $2, $3::numeric, $4::numeric, $5, $6::numeric, $7::numeric, $3::numeric, $8::numeric)
            RETURNING id, profile_id, tier_index, 
                notional_from::text, notional_to::text, 
                max_leverage, initial_margin_percent::text, maintenance_margin_percent::text,
                created_at, updated_at
            "#,
        )
        .bind(profile_id)
        .bind(tier_index)
        .bind(&notional_from)
        .bind(notional_to_value)
        .bind(max_leverage)
        .bind(&initial_margin_percent)
        .bind(&maintenance_margin_percent)
        .bind(margin_to_value)
        .map(|row: PgRow| LeverageProfileTier {
            id: row.get(0),
            profile_id: row.get(1),
            tier_index: row.get(2),
            notional_from: row.get(3),
            notional_to: row.get(4),
            max_leverage: row.get(5),
            initial_margin_percent: row.get(6),
            maintenance_margin_percent: row.get(7),
            created_at: row.get(8),
            updated_at: row.get(9),
        })
        .fetch_one(&self.pool)
        .await?;

        Ok(tier)
    }

    pub async fn update_tier(
        &self,
        tier_id: Uuid,
        profile_id: Uuid,
        tier_index: i32,
        notional_from: String,
        notional_to: Option<String>,
        max_leverage: i32,
        initial_margin_percent: String,
        maintenance_margin_percent: String,
    ) -> anyhow::Result<LeverageProfileTier> {
        // Validate (same as create)
        if tier_index < 1 {
            return Err(anyhow::anyhow!("Tier index must be >= 1"));
        }
        if max_leverage < 1 {
            return Err(anyhow::anyhow!("Max leverage must be >= 1"));
        }
        let notional_from_val: f64 = notional_from.parse()
            .map_err(|_| anyhow::anyhow!("Invalid notional_from value"))?;
        let notional_to_val: Option<f64> = notional_to.as_ref()
            .map(|s| s.parse())
            .transpose()
            .map_err(|_| anyhow::anyhow!("Invalid notional_to value"))?;
        
        if let Some(to) = notional_to_val {
            if to <= notional_from_val {
                return Err(anyhow::anyhow!("notional_to must be > notional_from"));
            }
        }

        // Check for overlapping tiers (excluding current tier)
        let notional_to_max = notional_to.as_ref().map(|s| s.as_str()).unwrap_or("999999999999");
        let notional_to_clone = notional_to.clone();
        let notional_to_opt = notional_to_clone.as_ref().map(|s| s.as_str());
        let overlapping = sqlx::query_scalar::<_, i64>(
            r#"
            SELECT COUNT(*) FROM leverage_profile_tiers
            WHERE profile_id = $1
            AND id != $5
            AND (
                (notional_from::numeric < $3::numeric AND (notional_to IS NULL OR notional_to::numeric > $2::numeric))
                OR ($4 IS NULL AND notional_from::numeric < $3::numeric)
                OR (notional_from::numeric >= $2::numeric AND (notional_to IS NULL OR notional_to::numeric <= $3::numeric))
            )
            "#,
        )
        .bind(profile_id)
        .bind(&notional_from)
        .bind(notional_to_max)
        .bind(notional_to_opt)
        .bind(tier_id)
        .fetch_one(&self.pool)
        .await?;

        if overlapping > 0 {
            return Err(anyhow::anyhow!("Tier ranges cannot overlap"));
        }

        // Handle nullable notional_to - use a default large value if null for margin_to
        let notional_to_value = notional_to.as_ref().map(|s| s.as_str());
        let margin_to_value = notional_to.as_ref().map(|s| s.as_str()).unwrap_or("999999999999");
        
        let tier = sqlx::query(
            r#"
            UPDATE leverage_profile_tiers
            SET 
                tier_index = $2,
                notional_from = $3::numeric,
                notional_to = $4::numeric,
                max_leverage = $5,
                initial_margin_percent = $6::numeric,
                maintenance_margin_percent = $7::numeric,
                margin_from = $3::numeric,
                margin_to = $8::numeric,
                updated_at = NOW()
            WHERE id = $1
            RETURNING id, profile_id, tier_index, 
                notional_from::text, notional_to::text, 
                max_leverage, initial_margin_percent::text, maintenance_margin_percent::text,
                created_at, updated_at
            "#,
        )
        .bind(tier_id)
        .bind(tier_index)
        .bind(&notional_from)
        .bind(notional_to_value)
        .bind(max_leverage)
        .bind(&initial_margin_percent)
        .bind(&maintenance_margin_percent)
        .bind(margin_to_value)
        .map(|row: PgRow| LeverageProfileTier {
            id: row.get(0),
            profile_id: row.get(1),
            tier_index: row.get(2),
            notional_from: row.get(3),
            notional_to: row.get(4),
            max_leverage: row.get(5),
            initial_margin_percent: row.get(6),
            maintenance_margin_percent: row.get(7),
            created_at: row.get(8),
            updated_at: row.get(9),
        })
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Tier not found"))?;

        Ok(tier)
    }

    pub async fn delete_tier(&self, tier_id: Uuid) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM leverage_profile_tiers WHERE id = $1")
            .bind(tier_id)
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    pub async fn get_profile_symbols(
        &self,
        profile_id: Uuid,
    ) -> anyhow::Result<(Vec<SymbolInfo>, Vec<SymbolInfo>)> {
        // Get assigned symbols
        let assigned = sqlx::query_as::<_, SymbolInfo>(
            r#"
            SELECT s.id as symbol_id, s.code as symbol_code, s.name, s.market::text as asset_class
            FROM symbols s
            INNER JOIN symbol_leverage_profile_assignments slpa ON s.id = slpa.symbol_id
            WHERE slpa.profile_id = $1
            ORDER BY s.code
            "#,
        )
        .bind(profile_id)
        .fetch_all(&self.pool)
        .await?;

        // Get unassigned symbols
        let unassigned = sqlx::query_as::<_, SymbolInfo>(
            r#"
            SELECT s.id as symbol_id, s.code as symbol_code, s.name, s.market::text as asset_class
            FROM symbols s
            WHERE s.id NOT IN (
                SELECT symbol_id FROM symbol_leverage_profile_assignments
            )
            ORDER BY s.code
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok((assigned, unassigned))
    }

    pub async fn set_profile_symbols(
        &self,
        profile_id: Uuid,
        symbol_ids: &[Uuid],
    ) -> anyhow::Result<()> {
        // Start transaction
        let mut tx = self.pool.begin().await?;

        // Remove all assignments for these symbols from other profiles
        sqlx::query(
            "DELETE FROM symbol_leverage_profile_assignments WHERE symbol_id = ANY($1)",
        )
        .bind(symbol_ids)
        .execute(&mut *tx)
        .await?;

        // Insert new assignments
        for symbol_id in symbol_ids {
            sqlx::query(
                r#"
                INSERT INTO symbol_leverage_profile_assignments (symbol_id, profile_id)
                VALUES ($1, $2)
                ON CONFLICT (symbol_id) DO UPDATE SET profile_id = $2
                "#,
            )
            .bind(symbol_id)
            .bind(profile_id)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        Ok(())
    }

    /// Get tag IDs assigned to each leverage profile (entity_type = 'leverage_profile').
    pub async fn get_tag_ids_for_leverage_profiles(
        &self,
        profile_ids: &[Uuid],
    ) -> anyhow::Result<HashMap<Uuid, Vec<Uuid>>> {
        if profile_ids.is_empty() {
            return Ok(HashMap::new());
        }
        #[derive(sqlx::FromRow)]
        struct Row {
            entity_id: Uuid,
            tag_id: Uuid,
        }
        let rows = sqlx::query_as::<_, Row>(
            "SELECT entity_id, tag_id FROM tag_assignments WHERE entity_type = 'leverage_profile' AND entity_id = ANY($1)",
        )
        .bind(profile_ids)
        .fetch_all(&self.pool)
        .await?;
        let mut map: HashMap<Uuid, Vec<Uuid>> = HashMap::new();
        for r in rows {
            map.entry(r.entity_id).or_default().push(r.tag_id);
        }
        Ok(map)
    }

    /// Replace tag assignments for a leverage profile.
    pub async fn set_leverage_profile_tags(&self, profile_id: Uuid, tag_ids: &[Uuid]) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM tag_assignments WHERE entity_type = 'leverage_profile' AND entity_id = $1")
            .bind(profile_id)
            .execute(&mut *tx)
            .await?;
        for tag_id in tag_ids {
            sqlx::query(
                "INSERT INTO tag_assignments (tag_id, entity_type, entity_id, created_at) VALUES ($1, 'leverage_profile', $2, NOW())",
            )
            .bind(tag_id)
            .bind(profile_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct SymbolInfo {
    pub symbol_id: Uuid,
    pub symbol_code: String,
    pub name: Option<String>,
    pub asset_class: String,
}


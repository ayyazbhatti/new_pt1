use crate::models::markup_profile::{MarkupProfile, MarkupProfileWithGroup, SymbolMarkupOverride};
use anyhow::Result;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

pub struct AdminMarkupService {
    pool: PgPool,
}

impl AdminMarkupService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// List markup (price stream) profiles. When allowed_profile_ids is None (e.g. super_admin), returns all.
    /// When Some(ids) with empty slice, returns none. When Some(ids) with non-empty, only those profiles.
    pub async fn list_profiles(
        &self,
        allowed_profile_ids: Option<&[Uuid]>,
    ) -> Result<Vec<MarkupProfileWithGroup>> {
        if let Some(ids) = allowed_profile_ids {
            if ids.is_empty() {
                return Ok(vec![]);
            }
        }

        let query_with_group = r#"
            SELECT 
                psp.id,
                psp.name,
                psp.description,
                psp.group_id,
                ug.name as group_name,
                psp.markup_type::text as markup_type,
                psp.bid_markup::text as bid_markup,
                psp.ask_markup::text as ask_markup,
                psp.created_at,
                psp.updated_at,
                psp.created_by_user_id,
                creator.email as created_by_email
            FROM price_stream_profiles psp
            LEFT JOIN user_groups ug ON psp.group_id = ug.id
            LEFT JOIN users creator ON creator.id = psp.created_by_user_id
            "#;
        let query_without_group = r#"
            SELECT 
                psp.id,
                psp.name,
                psp.description,
                NULL::uuid as group_id,
                NULL::text as group_name,
                psp.markup_type::text as markup_type,
                psp.bid_markup::text as bid_markup,
                psp.ask_markup::text as ask_markup,
                psp.created_at,
                psp.updated_at,
                psp.created_by_user_id,
                creator.email as created_by_email
            FROM price_stream_profiles psp
            LEFT JOIN users creator ON creator.id = psp.created_by_user_id
            "#;

        let run_with_group = async {
            if let Some(ids) = allowed_profile_ids {
                let q = format!("{} WHERE psp.id = ANY($1) ORDER BY psp.name", query_with_group);
                sqlx::query_as::<_, MarkupProfileWithGroup>(&q)
                    .bind(ids)
                    .fetch_all(&self.pool)
                    .await
            } else {
                let q = format!("{} ORDER BY psp.name", query_with_group);
                sqlx::query_as::<_, MarkupProfileWithGroup>(&q)
                    .fetch_all(&self.pool)
                    .await
            }
        };
        match run_with_group.await.map_err(anyhow::Error::from) {
            Ok(profiles) => Ok(profiles),
            Err(_) => {
                if let Some(ids) = allowed_profile_ids {
                    let q = format!("{} WHERE psp.id = ANY($1) ORDER BY psp.name", query_without_group);
                    sqlx::query_as::<_, MarkupProfileWithGroup>(&q)
                        .bind(ids)
                        .fetch_all(&self.pool)
                        .await
                } else {
                    let q = format!("{} ORDER BY psp.name", query_without_group);
                    sqlx::query_as::<_, MarkupProfileWithGroup>(&q)
                        .fetch_all(&self.pool)
                        .await
                }
                .map_err(anyhow::Error::from)
            }
        }
    }

    pub async fn create_profile(
        &self,
        name: &str,
        description: Option<&str>,
        group_id: Option<Uuid>,
        markup_type: &str,
        bid_markup: &str,
        ask_markup: &str,
        created_by_user_id: Option<Uuid>,
    ) -> Result<MarkupProfile> {
        let profile = sqlx::query_as::<_, MarkupProfile>(
            r#"
            INSERT INTO price_stream_profiles (
                name, description, group_id, markup_type, bid_markup, ask_markup, created_by_user_id
            )
            VALUES ($1, $2, $3, $4::markup_type, $5::numeric, $6::numeric, $7)
            RETURNING 
                id, name, description, group_id,
                markup_type::text as markup_type,
                bid_markup::text as bid_markup,
                ask_markup::text as ask_markup,
                created_at, updated_at, created_by_user_id
            "#
        )
        .bind(name)
        .bind(description)
        .bind(group_id)
        .bind(markup_type)
        .bind(bid_markup)
        .bind(ask_markup)
        .bind(created_by_user_id)
        .fetch_one(&self.pool)
        .await?;

        Ok(profile)
    }

    pub async fn get_profile_by_id(&self, id: Uuid) -> Result<MarkupProfile> {
        let profile = sqlx::query_as::<_, MarkupProfile>(
            r#"
            SELECT 
                id, name, description, group_id, 
                markup_type::text as markup_type,
                bid_markup::text as bid_markup,
                ask_markup::text as ask_markup,
                created_at, updated_at, created_by_user_id
            FROM price_stream_profiles
            WHERE id = $1
            "#
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Profile not found"))?;

        Ok(profile)
    }

    pub async fn update_profile(
        &self,
        id: Uuid,
        name: &str,
        group_id: Option<Uuid>,
        markup_type: &str,
        bid_markup: &str,
        ask_markup: &str,
    ) -> Result<MarkupProfile> {
        let profile = sqlx::query_as::<_, MarkupProfile>(
            r#"
            UPDATE price_stream_profiles
            SET 
                name = $2,
                group_id = $3,
                markup_type = $4::markup_type,
                bid_markup = $5::numeric,
                ask_markup = $6::numeric,
                updated_at = NOW()
            WHERE id = $1
            RETURNING 
                id, name, description, group_id,
                markup_type::text as markup_type,
                bid_markup::text as bid_markup,
                ask_markup::text as ask_markup,
                created_at, updated_at, created_by_user_id
            "#
        )
        .bind(id)
        .bind(name)
        .bind(group_id)
        .bind(markup_type)
        .bind(bid_markup)
        .bind(ask_markup)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("Profile not found"))?;

        Ok(profile)
    }

    /// Returns group_ids (user_groups.id) that use this profile as default_price_profile_id.
    pub async fn get_group_ids_by_profile_id(&self, profile_id: Uuid) -> Result<Vec<Uuid>> {
        let rows = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM user_groups WHERE default_price_profile_id = $1",
        )
        .bind(profile_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    pub async fn get_symbol_overrides(
        &self,
        profile_id: Uuid,
    ) -> Result<Vec<SymbolMarkupOverride>> {
        let overrides = sqlx::query_as::<_, SymbolMarkupOverride>(
            r#"
            SELECT 
                smo.id,
                smo.profile_id,
                smo.symbol_id,
                s.code as symbol_code,
                smo.bid_markup::text as bid_markup,
                smo.ask_markup::text as ask_markup,
                smo.created_at,
                smo.updated_at
            FROM symbol_markup_overrides smo
            JOIN symbols s ON smo.symbol_id = s.id
            WHERE smo.profile_id = $1
            ORDER BY s.code
            "#
        )
        .bind(profile_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(overrides)
    }

    pub async fn upsert_symbol_override(
        &self,
        profile_id: Uuid,
        symbol_id: Uuid,
        bid_markup: &str,
        ask_markup: &str,
    ) -> Result<SymbolMarkupOverride> {
        let override_data = sqlx::query_as::<_, SymbolMarkupOverride>(
            r#"
            INSERT INTO symbol_markup_overrides (profile_id, symbol_id, bid_markup, ask_markup)
            VALUES ($1, $2, $3::numeric, $4::numeric)
            ON CONFLICT (profile_id, symbol_id)
            DO UPDATE SET
                bid_markup = EXCLUDED.bid_markup,
                ask_markup = EXCLUDED.ask_markup,
                updated_at = NOW()
            RETURNING 
                id, profile_id, symbol_id,
                (SELECT code FROM symbols WHERE id = symbol_id) as symbol_code,
                bid_markup::text as bid_markup,
                ask_markup::text as ask_markup,
                created_at, updated_at
            "#
        )
        .bind(profile_id)
        .bind(symbol_id)
        .bind(bid_markup)
        .bind(ask_markup)
        .fetch_one(&self.pool)
        .await?;

        Ok(override_data)
    }

    pub async fn delete_symbol_override(
        &self,
        profile_id: Uuid,
        symbol_id: Uuid,
    ) -> Result<()> {
        let rows_affected = sqlx::query(
            "DELETE FROM symbol_markup_overrides WHERE profile_id = $1 AND symbol_id = $2"
        )
        .bind(profile_id)
        .bind(symbol_id)
        .execute(&self.pool)
        .await?
        .rows_affected();

        if rows_affected == 0 {
            return Err(anyhow::anyhow!("Override not found"));
        }

        Ok(())
    }

    /// Copy all symbol markup overrides from source profile to target profiles.
    /// When include_markups is true, copies each override to each target; otherwise no-op for markups.
    pub async fn copy_profile_markups_to_profiles(
        &self,
        source_profile_id: Uuid,
        target_profile_ids: &[Uuid],
        include_markups: bool,
    ) -> Result<usize> {
        if !include_markups || target_profile_ids.is_empty() {
            return Ok(0);
        }
        let overrides = self.get_symbol_overrides(source_profile_id).await?;
        let mut copied = 0;
        for &target_id in target_profile_ids {
            if target_id == source_profile_id {
                continue;
            }
            for o in &overrides {
                self.upsert_symbol_override(
                    target_id,
                    o.symbol_id,
                    &o.bid_markup,
                    &o.ask_markup,
                )
                .await?;
                copied += 1;
            }
        }
        Ok(copied)
    }

    /// Returns all symbol codes from the symbols table (for bootstrap).
    pub async fn get_all_symbol_codes(&self) -> Result<Vec<String>> {
        let rows: Vec<(String,)> = sqlx::query_as("SELECT code FROM symbols")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.into_iter().map(|r| r.0).collect())
    }

    /// Bootstrap Redis for per-group price stream: populate price:groups and symbol:markup:* from DB.
    /// All user_groups are added to price:groups so every group receives ticks (place_order can resolve price).
    /// Groups with default_price_profile_id get symbol:markup:*; others get raw prices from data-provider.
    /// Call once at auth-service startup.
    pub async fn bootstrap_price_groups_redis(&self, redis_url: &str) -> Result<()> {
        // All groups: ensure every group is in price:groups so data-provider publishes ticks for them
        #[derive(sqlx::FromRow)]
        struct GroupRow {
            group_id: Uuid,
        }
        let all_groups: Vec<GroupRow> = sqlx::query_as::<_, GroupRow>(
            "SELECT id as group_id FROM user_groups",
        )
        .fetch_all(&self.pool)
        .await?;

        #[derive(sqlx::FromRow)]
        struct Row {
            group_id: Uuid,
            profile_id: Uuid,
        }
        let groups_with_profile: Vec<Row> = sqlx::query_as::<_, Row>(
            r#"
            SELECT id as group_id, default_price_profile_id as profile_id
            FROM user_groups
            WHERE default_price_profile_id IS NOT NULL
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let all_symbols = self.get_all_symbol_codes().await.unwrap_or_default();
        let client = redis::Client::open(redis_url)?;
        let mut conn = client.get_connection()?;

        for row in &all_groups {
            let _: Result<(), _> = redis::cmd("SADD")
                .arg("price:groups")
                .arg(row.group_id.to_string())
                .query(&mut conn);
        }

        for row in &groups_with_profile {

            let profile = self.get_profile_by_id(row.profile_id).await.ok();
            let (default_bid, default_ask) = profile
                .as_ref()
                .map(|p| {
                    (
                        p.bid_markup.parse::<f64>().unwrap_or(0.0),
                        p.ask_markup.parse::<f64>().unwrap_or(0.0),
                    )
                })
                .unwrap_or((0.0, 0.0));

            let overrides = self.get_symbol_overrides(row.profile_id).await?;
            let override_map: std::collections::HashMap<String, (f64, f64)> = overrides
                .iter()
                .map(|o| {
                    (
                        o.symbol_code.clone(),
                        (
                            o.bid_markup.parse::<f64>().unwrap_or(0.0),
                            o.ask_markup.parse::<f64>().unwrap_or(0.0),
                        ),
                    )
                })
                .collect();

            for symbol_code in &all_symbols {
                let (bid_markup, ask_markup) = override_map
                    .get(symbol_code)
                    .copied()
                    .unwrap_or((default_bid, default_ask));
                let markup_value = serde_json::json!({
                    "bid_markup": bid_markup,
                    "ask_markup": ask_markup,
                    "type": "percent",
                })
                .to_string();
                let key = format!("symbol:markup:{}:{}", symbol_code.to_uppercase(), row.group_id);
                let _: Result<(), _> = redis::cmd("SET").arg(&key).arg(&markup_value).query(&mut conn);
            }
        }
        // Notify data-provider to refresh price:groups (e.g. if it started before auth)
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("markup:update")
            .arg("bootstrap")
            .query(&mut conn);

        Ok(())
    }

    /// Sync price:groups set in Redis from DB. Includes all user_groups so every group receives ticks.
    /// Call periodically so that after Redis restart, groups are repopulated without restarting auth-service.
    pub async fn sync_price_groups_set(&self, redis_url: &str) -> Result<()> {
        #[derive(sqlx::FromRow)]
        struct Row {
            group_id: Uuid,
        }
        let groups: Vec<Row> = sqlx::query_as::<_, Row>(
            "SELECT id as group_id FROM user_groups",
        )
        .fetch_all(&self.pool)
        .await?;

        let db_ids: std::collections::HashSet<String> = groups.iter().map(|r| r.group_id.to_string()).collect();
        if db_ids.is_empty() {
            return Ok(());
        }

        let client = redis::Client::open(redis_url)?;
        let mut conn = client.get_connection()?;
        let redis_ids: Vec<String> = redis::cmd("SMEMBERS").arg("price:groups").query(&mut conn)?;
        let redis_set: std::collections::HashSet<String> = redis_ids.into_iter().collect();
        let missing: Vec<&String> = db_ids.iter().filter(|id| !redis_set.contains(*id)).collect();
        let n = missing.len();
        if n == 0 {
            return Ok(());
        }
        for id in &missing {
            let _: Result<(), _> = redis::cmd("SADD").arg("price:groups").arg(*id).query(&mut conn);
        }
        let _: Result<(), _> = redis::cmd("PUBLISH")
            .arg("markup:update")
            .arg("sync")
            .query(&mut conn);
        tracing::debug!("Synced {} group(s) to price:groups", n);
        Ok(())
    }

    /// After a group's default_price_profile_id is changed: clear old markup keys for this group,
    /// SADD price:groups, and if new profile_id is set, write profile default for all symbols (overrides per-symbol).
    pub async fn sync_redis_after_group_profile_change(
        &self,
        group_id: Uuid,
        profile_id: Option<Uuid>,
        redis_url: &str,
    ) -> Result<()> {
        let (default_bid, default_ask) = if let Some(pid) = profile_id {
            self.get_profile_by_id(pid)
                .await
                .map(|p| {
                    (
                        p.bid_markup.parse::<f64>().unwrap_or(0.0),
                        p.ask_markup.parse::<f64>().unwrap_or(0.0),
                    )
                })
                .unwrap_or((0.0, 0.0))
        } else {
            (0.0, 0.0)
        };
        let overrides: Vec<SymbolMarkupOverride> = if let Some(pid) = profile_id {
            self.get_symbol_overrides(pid).await?
        } else {
            Vec::new()
        };
        let all_symbols = self.get_all_symbol_codes().await.unwrap_or_default();
        let override_map: std::collections::HashMap<String, (f64, f64)> = overrides
            .iter()
            .map(|o| {
                (
                    o.symbol_code.clone(),
                    (
                        o.bid_markup.parse::<f64>().unwrap_or(0.0),
                        o.ask_markup.parse::<f64>().unwrap_or(0.0),
                    ),
                )
            })
            .collect();
        let redis_url = redis_url.to_string();
        let group_id = group_id;
        tokio::task::spawn_blocking(move || {
            let client = redis::Client::open(redis_url.as_str())?;
            let mut conn = client.get_connection()?;
            let pattern = format!("symbol:markup:*:{}", group_id);
            let keys: Vec<String> = redis::cmd("KEYS").arg(&pattern).query(&mut conn)?;
            for key in &keys {
                let _: Result<(), _> = redis::cmd("DEL").arg(key).query(&mut conn);
            }
            let _: Result<(), _> = redis::cmd("SADD")
                .arg("price:groups")
                .arg(group_id.to_string())
                .query(&mut conn);
            for symbol_code in &all_symbols {
                let (bid_markup, ask_markup) = override_map
                    .get(symbol_code)
                    .copied()
                    .unwrap_or((default_bid, default_ask));
                let markup_value = serde_json::json!({
                    "bid_markup": bid_markup,
                    "ask_markup": ask_markup,
                    "type": "percent",
                })
                .to_string();
                let key = format!("symbol:markup:{}:{}", symbol_code.to_uppercase(), group_id);
                let _: Result<(), _> = redis::cmd("SET").arg(&key).arg(&markup_value).query(&mut conn);
            }
            // Notify data-provider to refresh price:groups so it includes this group in ticks
            let _: Result<(), _> = redis::cmd("PUBLISH")
                .arg("markup:update")
                .arg(serde_json::json!({ "group_id": group_id.to_string() }).to_string())
                .query(&mut conn);
            Ok::<(), anyhow::Error>(())
        })
        .await
        .map_err(|e| anyhow::anyhow!("join: {}", e))??;
        Ok(())
    }

    /// Get tag IDs assigned to each markup profile (price_stream_profiles; entity_type = 'markup_profile').
    pub async fn get_tag_ids_for_markup_profiles(
        &self,
        profile_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Vec<Uuid>>> {
        if profile_ids.is_empty() {
            return Ok(HashMap::new());
        }
        #[derive(sqlx::FromRow)]
        struct Row {
            entity_id: Uuid,
            tag_id: Uuid,
        }
        let rows = sqlx::query_as::<_, Row>(
            "SELECT entity_id, tag_id FROM tag_assignments WHERE entity_type = 'markup_profile' AND entity_id = ANY($1)",
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

    /// Replace tag assignments for a markup profile.
    pub async fn set_markup_profile_tags(&self, profile_id: Uuid, tag_ids: &[Uuid]) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM tag_assignments WHERE entity_type = 'markup_profile' AND entity_id = $1")
            .bind(profile_id)
            .execute(&mut *tx)
            .await?;
        for tag_id in tag_ids {
            sqlx::query(
                "INSERT INTO tag_assignments (tag_id, entity_type, entity_id, created_at) VALUES ($1, 'markup_profile', $2, NOW())",
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


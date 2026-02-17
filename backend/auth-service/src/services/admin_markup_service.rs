use crate::models::markup_profile::{MarkupProfile, MarkupProfileWithGroup, SymbolMarkupOverride};
use anyhow::Result;
use sqlx::PgPool;
use uuid::Uuid;

pub struct AdminMarkupService {
    pool: PgPool,
}

impl AdminMarkupService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn list_profiles(&self) -> Result<Vec<MarkupProfileWithGroup>> {
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
                psp.updated_at
            FROM price_stream_profiles psp
            LEFT JOIN user_groups ug ON psp.group_id = ug.id
            ORDER BY psp.name
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
                psp.updated_at
            FROM price_stream_profiles psp
            ORDER BY psp.name
            "#;

        match sqlx::query_as::<_, MarkupProfileWithGroup>(query_with_group)
            .fetch_all(&self.pool)
            .await
        {
            Ok(profiles) => Ok(profiles),
            Err(_) => {
                let profiles = sqlx::query_as::<_, MarkupProfileWithGroup>(query_without_group)
                    .fetch_all(&self.pool)
                    .await?;
                Ok(profiles)
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
    ) -> Result<MarkupProfile> {
        let profile = sqlx::query_as::<_, MarkupProfile>(
            r#"
            INSERT INTO price_stream_profiles (
                name, description, group_id, markup_type, bid_markup, ask_markup
            )
            VALUES ($1, $2, $3, $4::markup_type, $5::numeric, $6::numeric)
            RETURNING 
                id, name, description, group_id,
                markup_type::text as markup_type,
                bid_markup::text as bid_markup,
                ask_markup::text as ask_markup,
                created_at, updated_at
            "#
        )
        .bind(name)
        .bind(description)
        .bind(group_id)
        .bind(markup_type)
        .bind(bid_markup)
        .bind(ask_markup)
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
                created_at, updated_at
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
                created_at, updated_at
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

    /// Bootstrap Redis for per-group price stream: populate price:groups and symbol:markup:* from DB.
    /// Call once at auth-service startup.
    pub async fn bootstrap_price_groups_redis(&self, redis_url: &str) -> Result<()> {
        #[derive(sqlx::FromRow)]
        struct Row {
            group_id: Uuid,
            profile_id: Uuid,
        }
        let groups: Vec<Row> = sqlx::query_as::<_, Row>(
            r#"
            SELECT id as group_id, default_price_profile_id as profile_id
            FROM user_groups
            WHERE default_price_profile_id IS NOT NULL
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let client = redis::Client::open(redis_url)?;
        let mut conn = client.get_connection()?;

        for row in &groups {
            let _: Result<(), _> = redis::cmd("SADD")
                .arg("price:groups")
                .arg(row.group_id.to_string())
                .query(&mut conn);

            let overrides = self.get_symbol_overrides(row.profile_id).await?;
            for o in &overrides {
                let markup_value = serde_json::json!({
                    "bid_markup": o.bid_markup.parse::<f64>().unwrap_or(0.0),
                    "ask_markup": o.ask_markup.parse::<f64>().unwrap_or(0.0),
                    "type": "percent",
                })
                .to_string();
                let key = format!("symbol:markup:{}:{}", o.symbol_code, row.group_id);
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

    /// After a group's default_price_profile_id is changed: clear old markup keys for this group,
    /// SADD price:groups, and if new profile_id is set, write that profile's overrides for this group.
    pub async fn sync_redis_after_group_profile_change(
        &self,
        group_id: Uuid,
        profile_id: Option<Uuid>,
        redis_url: &str,
    ) -> Result<()> {
        let overrides: Vec<SymbolMarkupOverride> = if let Some(pid) = profile_id {
            self.get_symbol_overrides(pid).await?
        } else {
            Vec::new()
        };
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
            for o in &overrides {
                let markup_value = serde_json::json!({
                    "bid_markup": o.bid_markup.parse::<f64>().unwrap_or(0.0),
                    "ask_markup": o.ask_markup.parse::<f64>().unwrap_or(0.0),
                    "type": "percent",
                })
                .to_string();
                let key = format!("symbol:markup:{}:{}", o.symbol_code, group_id);
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
}


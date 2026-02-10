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
        let profiles = sqlx::query_as::<_, MarkupProfileWithGroup>(
            r#"
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
            "#
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(profiles)
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
}


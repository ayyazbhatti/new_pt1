use crate::models::market_session::{MarketHolidayDto, MarketSessionTemplateDto, SessionTemplateWindowDto};
use anyhow::{Context, Result};
use chrono::{DateTime, Days, NaiveDate, NaiveTime, Utc};
use sqlx::{PgPool, Postgres, Transaction};
use std::ops::DerefMut;
use uuid::Uuid;

const VALID_MARKETS: &[&str] = &["crypto", "forex", "commodities", "indices", "stocks"];

pub struct AdminSessionsService {
    pool: PgPool,
}

impl AdminSessionsService {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    fn validate_market_default(s: Option<&str>) -> Result<()> {
        match s {
            None => Ok(()),
            Some(m) if VALID_MARKETS.contains(&m) => Ok(()),
            Some(m) => Err(anyhow::anyhow!("Invalid is_default_for_market: {}", m)),
        }
    }

    fn parse_time(s: &str) -> Result<NaiveTime> {
        let t = s.trim();
        NaiveTime::parse_from_str(t, "%H:%M:%S")
            .or_else(|_| NaiveTime::parse_from_str(t, "%H:%M"))
            .map_err(|_| anyhow::anyhow!("Invalid time '{}'", s))
    }

    async fn clear_other_defaults(
        tx: &mut Transaction<'_, Postgres>,
        market: &str,
        except_id: Uuid,
    ) -> Result<()> {
        sqlx::query(
            r#"
            UPDATE market_session_templates
            SET is_default_for_market = NULL, updated_at = NOW()
            WHERE is_default_for_market = $1::market_type AND id <> $2
            "#,
        )
        .bind(market)
        .bind(except_id)
        .execute(tx.deref_mut())
        .await?;
        Ok(())
    }

    pub async fn list_templates(&self) -> Result<Vec<MarketSessionTemplateDto>> {
        let heads: Vec<(Uuid, String, String, Option<String>, bool, Option<String>, DateTime<Utc>, DateTime<Utc>, Option<String>)> = sqlx::query_as(
            r#"
            SELECT id, name, timezone, description, is_24_7,
                   is_default_for_market::text as is_default_for_market,
                   created_at, updated_at, updated_by
            FROM market_session_templates
            ORDER BY name ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        let ids: Vec<Uuid> = heads.iter().map(|h| h.0).collect();
        if ids.is_empty() {
            return Ok(vec![]);
        }

        let win_rows: Vec<(Uuid, Uuid, i16, String, String)> = sqlx::query_as(
            r#"
            SELECT id, template_id, day_of_week,
                   to_char(open_time, 'HH24:MI:SS') as open_time,
                   to_char(close_time, 'HH24:MI:SS') as close_time
            FROM session_template_windows
            WHERE template_id = ANY($1)
            ORDER BY template_id, day_of_week, open_time
            "#,
        )
        .bind(&ids)
        .fetch_all(&self.pool)
        .await?;

        let mut by_t: std::collections::HashMap<Uuid, Vec<SessionTemplateWindowDto>> =
            std::collections::HashMap::new();
        for (id, tid, dow, o, c) in win_rows {
            by_t.entry(tid).or_default().push(SessionTemplateWindowDto {
                id: Some(id),
                day_of_week: dow,
                open_time: trim_hms(o),
                close_time: trim_hms(c),
            });
        }

        let mut out = Vec::with_capacity(heads.len());
        for (id, name, timezone, description, is_24_7, is_default_for_market, created_at, updated_at, updated_by) in heads {
            let windows = by_t.remove(&id).unwrap_or_default();
            out.push(MarketSessionTemplateDto {
                id,
                name,
                timezone,
                description,
                is_24_7,
                is_default_for_market,
                windows,
                created_at,
                updated_at,
                updated_by,
            });
        }
        Ok(out)
    }

    pub async fn get_template(&self, id: Uuid) -> Result<Option<MarketSessionTemplateDto>> {
        let head: Option<(Uuid, String, String, Option<String>, bool, Option<String>, DateTime<Utc>, DateTime<Utc>, Option<String>)> = sqlx::query_as(
            r#"
            SELECT id, name, timezone, description, is_24_7,
                   is_default_for_market::text as is_default_for_market,
                   created_at, updated_at, updated_by
            FROM market_session_templates
            WHERE id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;

        let Some((tid, name, timezone, description, is_24_7, is_default_for_market, created_at, updated_at, updated_by)) = head else {
            return Ok(None);
        };

        let win_rows: Vec<(Uuid, Uuid, i16, String, String)> = sqlx::query_as(
            r#"
            SELECT id, template_id, day_of_week,
                   to_char(open_time, 'HH24:MI:SS') as open_time,
                   to_char(close_time, 'HH24:MI:SS') as close_time
            FROM session_template_windows
            WHERE template_id = $1
            ORDER BY day_of_week, open_time
            "#,
        )
        .bind(tid)
        .fetch_all(&self.pool)
        .await?;

        let windows: Vec<SessionTemplateWindowDto> = win_rows
            .into_iter()
            .map(|(wid, _, dow, o, c)| SessionTemplateWindowDto {
                id: Some(wid),
                day_of_week: dow,
                open_time: trim_hms(o),
                close_time: trim_hms(c),
            })
            .collect();

        Ok(Some(MarketSessionTemplateDto {
            id: tid,
            name,
            timezone,
            description,
            is_24_7,
            is_default_for_market,
            windows,
            created_at,
            updated_at,
            updated_by,
        }))
    }

    pub async fn create_template(
        &self,
        name: &str,
        timezone: &str,
        description: Option<&str>,
        is_24_7: bool,
        is_default_for_market: Option<&str>,
        windows: &[SessionTemplateWindowDto],
        updated_by: Option<&str>,
    ) -> Result<MarketSessionTemplateDto> {
        Self::validate_market_default(is_default_for_market)?;
        if !is_24_7 {
            Self::validate_windows(windows)?;
        }

        let mut tx = self.pool.begin().await?;

        let new_id: Uuid = if let Some(m) = is_default_for_market {
            let row: (Uuid,) = sqlx::query_as(
                r#"
                INSERT INTO market_session_templates
                    (name, timezone, description, is_24_7, is_default_for_market, updated_by)
                VALUES ($1, $2, $3, $4, $5::market_type, $6)
                RETURNING id
                "#,
            )
            .bind(name)
            .bind(timezone)
            .bind(description)
            .bind(is_24_7)
            .bind(m)
            .bind(updated_by)
            .fetch_one(tx.deref_mut())
            .await?;
            let new_id = row.0;
            Self::clear_other_defaults(&mut tx, m, new_id).await?;
            if !is_24_7 {
                Self::insert_windows(&mut tx, new_id, windows).await?;
            }
            new_id
        } else {
            let row: (Uuid,) = sqlx::query_as(
                r#"
                INSERT INTO market_session_templates
                    (name, timezone, description, is_24_7, is_default_for_market, updated_by)
                VALUES ($1, $2, $3, $4, NULL, $5)
                RETURNING id
                "#,
            )
            .bind(name)
            .bind(timezone)
            .bind(description)
            .bind(is_24_7)
            .bind(updated_by)
            .fetch_one(tx.deref_mut())
            .await?;
            let new_id = row.0;
            if !is_24_7 {
                Self::insert_windows(&mut tx, new_id, windows).await?;
            }
            new_id
        };

        tx.commit().await?;
        self.get_template(new_id)
            .await?
            .context("template missing after insert")
    }

    async fn insert_windows(
        tx: &mut Transaction<'_, Postgres>,
        template_id: Uuid,
        windows: &[SessionTemplateWindowDto],
    ) -> Result<()> {
        for w in windows {
            let o = Self::parse_time(&w.open_time)?;
            let c = Self::parse_time(&w.close_time)?;
            if o >= c {
                return Err(anyhow::anyhow!(
                    "Each window must have open_time < close_time (day {})",
                    w.day_of_week
                ));
            }
            sqlx::query(
                r#"
                INSERT INTO session_template_windows (template_id, day_of_week, open_time, close_time)
                VALUES ($1, $2, $3::time, $4::time)
                "#,
            )
            .bind(template_id)
            .bind(w.day_of_week)
            .bind(o)
            .bind(c)
            .execute(tx.deref_mut())
            .await?;
        }
        Ok(())
    }

    fn validate_windows(windows: &[SessionTemplateWindowDto]) -> Result<()> {
        if windows.is_empty() {
            return Err(anyhow::anyhow!("Non 24/7 templates require at least one window"));
        }
        for w in windows {
            if !(0..=6).contains(&w.day_of_week) {
                return Err(anyhow::anyhow!("day_of_week must be 0–6"));
            }
            let o = Self::parse_time(&w.open_time)?;
            let c = Self::parse_time(&w.close_time)?;
            if o >= c {
                return Err(anyhow::anyhow!("open_time must be before close_time"));
            }
        }
        Ok(())
    }

    pub async fn update_template(
        &self,
        id: Uuid,
        name: &str,
        timezone: &str,
        description: Option<&str>,
        is_24_7: bool,
        is_default_for_market: Option<&str>,
        windows: &[SessionTemplateWindowDto],
        updated_by: Option<&str>,
    ) -> Result<MarketSessionTemplateDto> {
        Self::validate_market_default(is_default_for_market)?;
        if !is_24_7 {
            Self::validate_windows(windows)?;
        }

        let mut tx = self.pool.begin().await?;

        if let Some(m) = is_default_for_market {
            Self::clear_other_defaults(&mut tx, m, id).await?;
        }

        sqlx::query(
            r#"
            UPDATE market_session_templates
            SET name = $2,
                timezone = $3,
                description = $4,
                is_24_7 = $5,
                is_default_for_market = ($6::text)::market_type,
                updated_by = $7,
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(name)
        .bind(timezone)
        .bind(description)
        .bind(is_24_7)
        .bind(is_default_for_market)
        .bind(updated_by)
        .execute(tx.deref_mut())
        .await?;

        sqlx::query("DELETE FROM session_template_windows WHERE template_id = $1")
            .bind(id)
            .execute(tx.deref_mut())
            .await?;

        if !is_24_7 {
            Self::insert_windows(&mut tx, id, windows).await?;
        }

        tx.commit().await?;
        self.get_template(id)
            .await?
            .context("template missing after update")
    }

    pub async fn delete_template(&self, id: Uuid) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE symbols SET session_template_id = NULL WHERE session_template_id = $1")
            .bind(id)
            .execute(tx.deref_mut())
            .await?;
        let r = sqlx::query("DELETE FROM market_session_templates WHERE id = $1")
            .bind(id)
            .execute(tx.deref_mut())
            .await?;
        if r.rows_affected() == 0 {
            return Err(anyhow::anyhow!("Template not found"));
        }
        tx.commit().await?;
        Ok(())
    }

    fn validate_holiday_type(t: &str) -> Result<()> {
        match t {
            "closed" | "half_day" => Ok(()),
            _ => Err(anyhow::anyhow!("Invalid holiday type: must be 'closed' or 'half_day'")),
        }
    }

    fn format_time_opt(t: Option<NaiveTime>) -> Option<String> {
        t.map(|x| x.format("%H:%M:%S").to_string())
    }

    /// List holidays for a template in `[from, to)` when `year` is set (calendar year),
    /// else a rolling window around today.
    pub async fn list_holidays(
        &self,
        template_id: Uuid,
        year: Option<i32>,
    ) -> Result<Vec<MarketHolidayDto>> {
        let (from, to_exclusive) = match year {
            Some(y) => {
                let from = NaiveDate::from_ymd_opt(y, 1, 1).context("invalid year")?;
                let to = NaiveDate::from_ymd_opt(y + 1, 1, 1).context("invalid year")?;
                (from, to)
            }
            None => {
                let today = Utc::now().date_naive();
                let from = today
                    .checked_sub_days(Days::new(30))
                    .context("date underflow")?;
                let to_exclusive = today
                    .checked_add_days(Days::new(366))
                    .context("date overflow")?;
                (from, to_exclusive)
            }
        };

        let rows: Vec<(
            Uuid,
            Uuid,
            NaiveDate,
            String,
            String,
            Option<NaiveTime>,
            Option<String>,
            DateTime<Utc>,
        )> = sqlx::query_as(
            r#"
            SELECT id, template_id, holiday_date, name, "type",
                   half_day_close_time, notes, created_at
            FROM market_holidays
            WHERE template_id = $1
              AND holiday_date >= $2
              AND holiday_date < $3
            ORDER BY holiday_date ASC
            "#,
        )
        .bind(template_id)
        .bind(from)
        .bind(to_exclusive)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(
                |(id, template_id, holiday_date, name, holiday_type, half_day_close_time, notes, created_at)| {
                    MarketHolidayDto {
                        id,
                        template_id,
                        holiday_date,
                        name,
                        holiday_type,
                        half_day_close_time: Self::format_time_opt(half_day_close_time),
                        notes,
                        created_at,
                    }
                },
            )
            .collect())
    }

    pub async fn create_holiday(
        &self,
        template_id: Uuid,
        holiday_date: NaiveDate,
        name: &str,
        holiday_type: &str,
        half_day_close_time: Option<NaiveTime>,
        notes: Option<&str>,
    ) -> Result<MarketHolidayDto> {
        Self::validate_holiday_type(holiday_type)?;
        if holiday_type == "half_day" && half_day_close_time.is_none() {
            return Err(anyhow::anyhow!(
                "half_day holidays require half_day_close_time"
            ));
        }
        if holiday_type == "closed" && half_day_close_time.is_some() {
            return Err(anyhow::anyhow!(
                "closed holidays must not set half_day_close_time"
            ));
        }

        let row: (
            Uuid,
            Uuid,
            NaiveDate,
            String,
            String,
            Option<NaiveTime>,
            Option<String>,
            DateTime<Utc>,
        ) = sqlx::query_as(
            r#"
            INSERT INTO market_holidays (template_id, holiday_date, name, "type", half_day_close_time, notes)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, template_id, holiday_date, name, "type",
                      half_day_close_time, notes, created_at
            "#,
        )
        .bind(template_id)
        .bind(holiday_date)
        .bind(name)
        .bind(holiday_type)
        .bind(half_day_close_time)
        .bind(notes)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("duplicate key") || msg.contains("unique constraint") {
                anyhow::anyhow!("A holiday already exists on this date for this template")
            } else {
                anyhow::Error::from(e)
            }
        })?;

        let (id, template_id, holiday_date, name, holiday_type, half_day_close_time, notes, created_at) = row;
        Ok(MarketHolidayDto {
            id,
            template_id,
            holiday_date,
            name,
            holiday_type,
            half_day_close_time: Self::format_time_opt(half_day_close_time),
            notes,
            created_at,
        })
    }

    pub async fn update_holiday(
        &self,
        id: Uuid,
        holiday_date: NaiveDate,
        name: &str,
        holiday_type: &str,
        half_day_close_time: Option<NaiveTime>,
        notes: Option<&str>,
    ) -> Result<MarketHolidayDto> {
        Self::validate_holiday_type(holiday_type)?;
        if holiday_type == "half_day" && half_day_close_time.is_none() {
            return Err(anyhow::anyhow!(
                "half_day holidays require half_day_close_time"
            ));
        }
        if holiday_type == "closed" && half_day_close_time.is_some() {
            return Err(anyhow::anyhow!(
                "closed holidays must not set half_day_close_time"
            ));
        }

        let row: Option<(
            Uuid,
            Uuid,
            NaiveDate,
            String,
            String,
            Option<NaiveTime>,
            Option<String>,
            DateTime<Utc>,
        )> = sqlx::query_as(
            r#"
            UPDATE market_holidays
            SET holiday_date = $2, name = $3, "type" = $4,
                half_day_close_time = $5, notes = $6
            WHERE id = $1
            RETURNING id, template_id, holiday_date, name, "type",
                      half_day_close_time, notes, created_at
            "#,
        )
        .bind(id)
        .bind(holiday_date)
        .bind(name)
        .bind(holiday_type)
        .bind(half_day_close_time)
        .bind(notes)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| {
            let msg = e.to_string();
            if msg.contains("duplicate key") || msg.contains("unique constraint") {
                anyhow::anyhow!("A holiday already exists on this date for this template")
            } else {
                anyhow::Error::from(e)
            }
        })?;

        let Some((id, template_id, holiday_date, name, holiday_type, half_day_close_time, notes, created_at)) = row
        else {
            return Err(anyhow::anyhow!("Holiday not found"));
        };

        Ok(MarketHolidayDto {
            id,
            template_id,
            holiday_date,
            name,
            holiday_type,
            half_day_close_time: Self::format_time_opt(half_day_close_time),
            notes,
            created_at,
        })
    }

    pub async fn delete_holiday(&self, id: Uuid) -> Result<()> {
        let r = sqlx::query("DELETE FROM market_holidays WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if r.rows_affected() == 0 {
            return Err(anyhow::anyhow!("Holiday not found"));
        }
        Ok(())
    }
}

fn trim_hms(s: String) -> String {
    let t = s.trim();
    if t.ends_with(":00") && t.matches(':').count() == 2 {
        t.trim_end_matches(":00").to_string()
    } else {
        t.to_string()
    }
}

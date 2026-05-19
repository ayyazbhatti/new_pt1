//! Per-section SQL/Redis fetchers for AI user reports.

use anyhow::Result;
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use sqlx::PgPool;
use tracing::warn;
use uuid::Uuid;

use crate::models::user::User;
use crate::redis_pool::RedisPool;
use crate::services::open_positions_redis;

pub const SECTION_PROFILE: &str = "profile";
pub const SECTION_TRADING_PERFORMANCE: &str = "trading_performance";
pub const SECTION_OPEN_POSITIONS: &str = "open_positions";
pub const SECTION_CLOSED_TRADES: &str = "closed_trades";
pub const SECTION_FINANCIAL_ACTIVITY: &str = "financial_activity";
pub const SECTION_RISK_PROFILE: &str = "risk_profile";
pub const SECTION_KYC: &str = "kyc";
pub const SECTION_ENGAGEMENT: &str = "engagement";
pub const SECTION_AFFILIATE: &str = "affiliate";
pub const SECTION_ADMIN_ACTIVITY: &str = "admin_activity";

const OPEN_POSITIONS_REPORT_CAP: usize = 50;

#[derive(Debug, Clone, Serialize, Default)]
pub struct ReportData {
    pub profile: Option<serde_json::Value>,
    pub trading_performance: Option<serde_json::Value>,
    pub open_positions: Option<serde_json::Value>,
    pub closed_trades: Option<serde_json::Value>,
    pub financial_activity: Option<serde_json::Value>,
    pub risk_profile: Option<serde_json::Value>,
    pub kyc: Option<serde_json::Value>,
    pub engagement: Option<serde_json::Value>,
    pub affiliate: Option<serde_json::Value>,
    pub admin_activity: Option<serde_json::Value>,
}

/// Normalize section list: always includes `profile`.
pub fn normalize_sections(sections: &[String]) -> Vec<String> {
    let mut out: Vec<String> = sections
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if !out.iter().any(|s| s == SECTION_PROFILE) {
        out.insert(0, SECTION_PROFILE.to_string());
    }
    out.sort();
    out.dedup();
    out
}

pub async fn gather_report_data(
    pool: &PgPool,
    redis: &RedisPool,
    subject_user_id: Uuid,
    sections: &[String],
) -> Result<ReportData> {
    let sections = normalize_sections(sections);
    let mut data = ReportData::default();

    for section in &sections {
        let value = match section.as_str() {
            SECTION_PROFILE => fetch_profile(pool, subject_user_id).await,
            SECTION_TRADING_PERFORMANCE => fetch_trading_performance(pool, subject_user_id).await,
            SECTION_OPEN_POSITIONS => Ok(open_positions_redis::fetch_open_positions_json(
                redis,
                subject_user_id,
                OPEN_POSITIONS_REPORT_CAP,
            )
            .await),
            SECTION_CLOSED_TRADES => fetch_closed_trades(pool, subject_user_id).await,
            SECTION_FINANCIAL_ACTIVITY => fetch_financial_activity(pool, subject_user_id).await,
            SECTION_RISK_PROFILE => fetch_risk_profile(pool, subject_user_id).await,
            SECTION_KYC => fetch_kyc(pool, subject_user_id).await,
            SECTION_ENGAGEMENT => fetch_engagement(pool, subject_user_id).await,
            SECTION_AFFILIATE => fetch_affiliate(pool, subject_user_id).await,
            SECTION_ADMIN_ACTIVITY => fetch_admin_activity(pool, subject_user_id).await,
            other => {
                warn!(
                    subject_user_id = %subject_user_id,
                    section = %other,
                    "unknown report section key"
                );
                Ok(empty_section())
            }
        };

        match value {
            Ok(v) => set_section(&mut data, section.as_str(), Some(v)),
            Err(e) => {
                warn!(
                    subject_user_id = %subject_user_id,
                    section = %section,
                    error = %e,
                    "report section fetch failed"
                );
                set_section(&mut data, section.as_str(), Some(empty_section()));
            }
        }
    }

    Ok(data)
}

fn set_section(data: &mut ReportData, key: &str, value: Option<serde_json::Value>) {
    match key {
        SECTION_PROFILE => data.profile = value,
        SECTION_TRADING_PERFORMANCE => data.trading_performance = value,
        SECTION_OPEN_POSITIONS => data.open_positions = value,
        SECTION_CLOSED_TRADES => data.closed_trades = value,
        SECTION_FINANCIAL_ACTIVITY => data.financial_activity = value,
        SECTION_RISK_PROFILE => data.risk_profile = value,
        SECTION_KYC => data.kyc = value,
        SECTION_ENGAGEMENT => data.engagement = value,
        SECTION_AFFILIATE => data.affiliate = value,
        SECTION_ADMIN_ACTIVITY => data.admin_activity = value,
        _ => {}
    }
}

fn empty_section() -> serde_json::Value {
    serde_json::json!({})
}

async fn fetch_profile(pool: &PgPool, user_id: Uuid) -> Result<serde_json::Value> {
    let user = sqlx::query_as::<_, User>(
        "SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("User not found"))?;

    let group_row = sqlx::query_as::<_, (Option<String>,)>(
        r#"
        SELECT ug.name
        FROM users u
        LEFT JOIN user_groups ug ON u.group_id = ug.id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let kyc_status: Option<String> = sqlx::query_scalar(
        "SELECT status::text FROM kyc_submissions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let group_name = group_row.and_then(|(n,)| n);

    Ok(serde_json::json!({
        "id": user.id,
        "email": user.email,
        "firstName": user.first_name,
        "lastName": user.last_name,
        "phone": user.phone,
        "country": user.country,
        "role": user.role,
        "status": user.status,
        "groupId": user.group_id,
        "groupName": group_name,
        "accountType": user.account_type,
        "marginCalculationType": user.margin_calculation_type,
        "tradingAccess": user.trading_access,
        "minLeverage": user.min_leverage,
        "maxLeverage": user.max_leverage,
        "referralCode": user.referral_code,
        "referredByUserId": user.referred_by_user_id,
        "emailVerified": user.email_verified,
        "kycStatus": kyc_status,
        "createdAt": user.created_at,
        "lastLoginAt": user.last_login_at,
        "permissionProfileId": user.permission_profile_id,
    }))
}

async fn fetch_trading_performance(pool: &PgPool, user_id: Uuid) -> Result<serde_json::Value> {
    let rows = sqlx::query_as::<_, (String, i64, Option<Decimal>)>(
        r#"
        SELECT status::text, COUNT(*)::bigint, AVG(size::numeric)
        FROM orders
        WHERE user_id = $1
        GROUP BY status
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let filled_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*)::bigint
        FROM orders
        WHERE user_id = $1 AND status::text = 'filled'
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let by_status: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(status, count, avg_size)| {
            serde_json::json!({
                "status": status,
                "count": count,
                "avgSize": avg_size.map(decimal_to_f64),
            })
        })
        .collect();

    Ok(serde_json::json!({
        "byStatus": by_status,
        "totalFilled": filled_count,
    }))
}

async fn fetch_closed_trades(pool: &PgPool, user_id: Uuid) -> Result<serde_json::Value> {
    let row = sqlx::query_as::<_, (
        Option<i64>,
        Option<i64>,
        Option<Decimal>,
        Option<Decimal>,
        Option<Decimal>,
        Option<Decimal>,
    )>(
        r#"
        SELECT
          COUNT(*) FILTER (WHERE realized_pnl > 0) AS wins,
          COUNT(*) FILTER (WHERE realized_pnl < 0) AS losses,
          SUM(realized_pnl),
          MAX(realized_pnl),
          MIN(realized_pnl),
          AVG(realized_pnl)
        FROM positions
        WHERE user_id = $1 AND status::text = 'closed'
        "#,
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(serde_json::json!({
        "wins": row.0.unwrap_or(0),
        "losses": row.1.unwrap_or(0),
        "totalRealizedPnl": row.2.map(decimal_to_f64),
        "bestTrade": row.3.map(decimal_to_f64),
        "worstTrade": row.4.map(decimal_to_f64),
        "avgRealizedPnl": row.5.map(decimal_to_f64),
    }))
}

async fn fetch_financial_activity(pool: &PgPool, user_id: Uuid) -> Result<serde_json::Value> {
    let rows = sqlx::query_as::<_, (String, String, Option<Decimal>, i64)>(
        r#"
        SELECT type::text, status::text, SUM(amount), COUNT(*)::bigint
        FROM transactions
        WHERE user_id = $1
        GROUP BY type, status
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let net_flow: Option<Decimal> = sqlx::query_scalar(
        r#"
        SELECT SUM(
          CASE
            WHEN type::text = 'deposit' THEN amount
            WHEN type::text = 'withdrawal' THEN -amount
            ELSE 0
          END
        )
        FROM transactions
        WHERE user_id = $1 AND status::text IN ('completed', 'approved')
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let groups: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(t, s, sum_amt, count)| {
            serde_json::json!({
                "type": t,
                "status": s,
                "sumAmount": sum_amt.map(decimal_to_f64),
                "count": count,
            })
        })
        .collect();

    Ok(serde_json::json!({
        "byTypeStatus": groups,
        "netFlow": net_flow.map(decimal_to_f64),
    }))
}

async fn fetch_risk_profile(pool: &PgPool, user_id: Uuid) -> Result<serde_json::Value> {
    let margin_events = sqlx::query_as::<_, (
        Uuid,
        String,
        String,
        Decimal,
        Decimal,
        Decimal,
        Decimal,
        Option<String>,
        DateTime<Utc>,
    )>(
        r#"
        SELECT id, type::text, severity::text, equity, margin, free_margin,
               maintenance_margin, message, created_at
        FROM margin_events
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 20
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let user_caps = sqlx::query_as::<_, (Option<i32>, Option<i32>, Option<i32>)>(
        r#"
        SELECT min_leverage, max_leverage, NULL::int
        FROM users
        WHERE id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let group_caps = sqlx::query_as::<_, (Option<Decimal>, Option<Decimal>)>(
        r#"
        SELECT ug.margin_call_level, ug.stop_out_level
        FROM users u
        JOIN user_groups ug ON u.group_id = ug.id
        WHERE u.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let events: Vec<serde_json::Value> = margin_events
        .into_iter()
        .map(|(id, t, sev, eq, mg, fm, mm, msg, at)| {
            serde_json::json!({
                "id": id,
                "type": t,
                "severity": sev,
                "equity": decimal_to_f64(eq),
                "margin": decimal_to_f64(mg),
                "freeMargin": decimal_to_f64(fm),
                "maintenanceMargin": decimal_to_f64(mm),
                "message": msg,
                "createdAt": at,
            })
        })
        .collect();

    let (min_lev, max_lev, _) = user_caps.unwrap_or((None, None, None));
    let (g_mc, g_so) = group_caps.unwrap_or((None, None));

    Ok(serde_json::json!({
        "marginEvents": events,
        "userLeverage": { "min": min_lev, "max": max_lev },
        "groupCaps": {
            "marginCallLevel": g_mc.map(decimal_to_f64),
            "stopOutLevel": g_so.map(decimal_to_f64),
        },
    }))
}

async fn fetch_kyc(pool: &PgPool, user_id: Uuid) -> Result<serde_json::Value> {
    let rows = sqlx::query_as::<_, (String, DateTime<Utc>, Option<DateTime<Utc>>, Option<String>)>(
        r#"
        SELECT status::text, submitted_at, reviewed_at, rejection_reason
        FROM kyc_submissions
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT 5
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let submissions: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(status, submitted_at, reviewed_at, rejection_reason)| {
            serde_json::json!({
                "status": status,
                "submittedAt": submitted_at,
                "reviewedAt": reviewed_at,
                "rejectionReason": rejection_reason,
            })
        })
        .collect();

    Ok(serde_json::json!({ "submissions": submissions }))
}

async fn fetch_engagement(pool: &PgPool, user_id: Uuid) -> Result<serde_json::Value> {
    let rows = sqlx::query_as::<_, (String, i64, Option<DateTime<Utc>>)>(
        r#"
        SELECT event_type, COUNT(*)::bigint, MAX(created_at) AS last_at
        FROM user_events
        WHERE subject_user_id = $1
          AND created_at >= NOW() - INTERVAL '90 days'
        GROUP BY event_type
        ORDER BY last_at DESC NULLS LAST
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let events: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(event_type, count, last_at)| {
            serde_json::json!({
                "eventType": event_type,
                "count": count,
                "lastAt": last_at,
            })
        })
        .collect();

    Ok(serde_json::json!({ "last90Days": events }))
}

async fn fetch_affiliate(pool: &PgPool, user_id: Uuid) -> Result<serde_json::Value> {
    let referred_by: Option<(Uuid, String)> = sqlx::query_as::<_, (Uuid, String)>(
        r#"
        SELECT u.id, u.email
        FROM users subject
        JOIN users u ON u.id = subject.referred_by_user_id
        WHERE subject.id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let referred_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*)::bigint FROM users WHERE referred_by_user_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await
    .unwrap_or(0);

    let commission_total: Option<Decimal> = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(ac.amount), 0)
        FROM affiliate_commissions ac
        JOIN affiliates a ON a.id = ac.affiliate_id
        WHERE a.user_id = $1
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(serde_json::json!({
        "referrer": referred_by.map(|(id, email)| serde_json::json!({ "id": id, "email": email })),
        "referredUsersCount": referred_count,
        "commissionTotalEarned": commission_total.map(decimal_to_f64),
    }))
}

async fn fetch_admin_activity(pool: &PgPool, user_id: Uuid) -> Result<serde_json::Value> {
    let rows = sqlx::query_as::<_, (String, Option<Uuid>, DateTime<Utc>, serde_json::Value)>(
        r#"
        SELECT event_type, actor_user_id, created_at, meta
        FROM user_events
        WHERE subject_user_id = $1
          AND category IN ('admin', 'finance')
        ORDER BY created_at DESC
        LIMIT 50
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let events: Vec<serde_json::Value> = rows
        .into_iter()
        .map(|(event_type, actor_user_id, created_at, meta)| {
            serde_json::json!({
                "eventType": event_type,
                "actorUserId": actor_user_id,
                "createdAt": created_at,
                "meta": meta,
            })
        })
        .collect();

    Ok(serde_json::json!({ "events": events }))
}

fn decimal_to_f64(d: Decimal) -> f64 {
    use rust_decimal::prelude::ToPrimitive;
    d.to_f64().unwrap_or(0.0)
}

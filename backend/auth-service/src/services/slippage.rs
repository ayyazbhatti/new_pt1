//! Slippage tolerance resolution (Phase 1: storage + defaults only; no fill enforcement).
//!
//! **SL/TP-triggered fills** are exempt from slippage checks — enforcement is Phase 2; behaviour is documented here.

use rust_decimal::Decimal;
use sqlx::PgPool;
use uuid::Uuid;

/// Platform-wide hard cap on **per-order user** slippage override (basis points).
/// Group defaults via `user_groups.default_slippage_bps` may exceed this (admin override).
pub const PLATFORM_SLIPPAGE_CAP_BPS: i32 = 500; // 5%

/// Fallback when platform row is missing or misconfigured.
pub const HARDCODED_FALLBACK_BPS: i32 = 50; // 0.5%

#[derive(Debug, Clone)]
pub struct ResolvedSlippage {
    pub bps: i32,
    pub source: SlippageSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SlippageSource {
    UserOverride,
    GroupDefault,
    PlatformDefault,
    HardcodedFallback,
}

/// Resolve effective slippage for an order (or `/me` default when `requested_bps` is `None`).
///
/// Resolution order:
/// 1. User-provided `requested_bps` — clamped to \[0, `PLATFORM_SLIPPAGE_CAP_BPS`\]
/// 2. Group `default_slippage_bps` when non-NULL — **not** capped by platform cap
/// 3. Platform `default_slippage_bps`
/// 4. `HARDCODED_FALLBACK_BPS` with WARN log
pub async fn resolve_slippage(
    pool: &PgPool,
    group_id: Option<Uuid>,
    requested_bps: Option<i32>,
) -> Result<ResolvedSlippage, sqlx::Error> {
    if let Some(req) = requested_bps {
        let capped = req.max(0).min(PLATFORM_SLIPPAGE_CAP_BPS);
        return Ok(ResolvedSlippage {
            bps: capped,
            source: SlippageSource::UserOverride,
        });
    }

    if let Some(gid) = group_id {
        let group_val: Option<Option<i32>> = sqlx::query_scalar(
            "SELECT default_slippage_bps FROM user_groups WHERE id = $1",
        )
        .bind(gid)
        .fetch_optional(pool)
        .await?;

        if let Some(maybe_bps) = group_val {
            if let Some(bps) = maybe_bps {
                return Ok(ResolvedSlippage {
                    bps: bps.max(0),
                    source: SlippageSource::GroupDefault,
                });
            }
        }
    }

    let platform_bps: Option<i32> = sqlx::query_scalar(
        "SELECT default_slippage_bps FROM platform_general_settings WHERE singleton_id = 1",
    )
    .fetch_optional(pool)
    .await?;

    if let Some(bps) = platform_bps {
        return Ok(ResolvedSlippage {
            bps: bps.max(0),
            source: SlippageSource::PlatformDefault,
        });
    }

    tracing::warn!(
        "Slippage resolution: no platform_general_settings row or default_slippage_bps missing. \
         Using hardcoded fallback of {} bps.",
        HARDCODED_FALLBACK_BPS
    );
    Ok(ResolvedSlippage {
        bps: HARDCODED_FALLBACK_BPS,
        source: SlippageSource::HardcodedFallback,
    })
}

/// Convert basis points to fractional decimal (e.g. 50 → 0.005).
pub fn bps_to_fraction(bps: i32) -> Decimal {
    Decimal::from(bps) / Decimal::from(10_000)
}

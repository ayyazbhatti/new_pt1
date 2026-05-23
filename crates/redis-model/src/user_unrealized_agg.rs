//! Redis-side aggregation of per-user unrealized PnL (micro-USD).
//!
//! Auth-service writes `unrealized_pnl_usd_e6` on each open `pos:by_id:{id}` hash when it
//! computes position-level unrealized in USD. **Order-engine** refreshes the same field on each
//! price tick (see `apps/order-engine`). This module runs a Lua script that sums those
//! fields for all OPEN positions in `pos:{user_id}`, subtracts open swap (micro-USD), and
//! stores the result on `pos:agg:unrealized_usd_e6:{user_id}`.

use redis::{AsyncCommands, Script};
use rust_decimal::Decimal;
use std::sync::OnceLock;
use uuid::Uuid;

use crate::keys::Keys;

/// Hash field on `pos:by_id:{position_id}`: open position unrealized PnL in **micro-USD** (1 USD = 1_000_000).
pub const FIELD_UNREALIZED_PNL_USD_E6: &str = "unrealized_pnl_usd_e6";

/// Redis string key: aggregated net unrealized PnL for the user in **micro-USD** (after swap subtraction).
pub fn key_user_unrealized_agg_e6(user_id: Uuid) -> String {
    format!("pos:agg:unrealized_usd_e6:{user_id}")
}

/// Last known open-swap total in micro-USD (written by auth-service when account summary runs).
/// Order-engine reads this when refreshing `pos:agg:unrealized_usd_e6` on ticks so the aggregate stays net-of-swap without Postgres.
pub fn key_swap_open_usd_e6_cache(user_id: Uuid) -> String {
    format!("pos:cache:swap_open_usd_e6:{user_id}")
}

fn aggregate_script() -> &'static Script {
    static SCRIPT: OnceLock<Script> = OnceLock::new();
    SCRIPT.get_or_init(|| Script::new(include_str!("../lua/aggregate_user_unrealized_usd_e6.lua")))
}

/// Convert a USD [`Decimal`] to micro-USD (truncated toward zero).
pub fn decimal_usd_to_micro_e6(d: Decimal) -> i64 {
    use rust_decimal::prelude::ToPrimitive;
    let scaled = (d * Decimal::from(1_000_000i64)).trunc();
    scaled.to_i64().unwrap_or(0)
}

/// Run Lua: sum `unrealized_pnl_usd_e6` for OPEN positions under `pos:{user}`, subtract `swap_open_usd_e6`, SET aggregate key.
pub async fn aggregate_user_unrealized_usd_e6_in_redis<C: AsyncCommands + Send>(
    conn: &mut C,
    user_id: Uuid,
    swap_open_usd_e6: i64,
) -> redis::RedisResult<i64> {
    let script = aggregate_script();
    script
        .arg(user_id.to_string())
        .arg(swap_open_usd_e6.to_string())
        .invoke_async(conn)
        .await
}

/// Clear `FIELD_UNREALIZED_PNL_USD_E6` on each `pos:by_id:{id}` for the given position id strings.
pub async fn clear_position_unrealized_usd_e6_for_ids<C: AsyncCommands + Send>(
    conn: &mut C,
    position_ids: &[String],
) -> redis::RedisResult<()> {
    if position_ids.is_empty() {
        return Ok(());
    }
    let mut pipe = redis::pipe();
    for pos_id_str in position_ids {
        if let Ok(pid) = Uuid::parse_str(pos_id_str) {
            pipe.hdel(Keys::position_by_id(pid), FIELD_UNREALIZED_PNL_USD_E6);
        }
    }
    pipe.query_async(conn).await
}

#[cfg(test)]
mod tests {
    use super::decimal_usd_to_micro_e6;
    use rust_decimal::Decimal;

    #[test]
    fn micro_e6_truncates_toward_zero() {
        assert_eq!(
            decimal_usd_to_micro_e6(Decimal::from_str_exact("1.5").unwrap()),
            1_500_000
        );
        assert_eq!(
            decimal_usd_to_micro_e6(Decimal::from_str_exact("-0.000001").unwrap()),
            -1
        );
        assert_eq!(decimal_usd_to_micro_e6(Decimal::ZERO), 0);
    }
}

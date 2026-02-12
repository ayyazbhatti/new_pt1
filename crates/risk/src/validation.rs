use rust_decimal::Decimal;
use contracts::enums::{OrderType, Side};

/// Validate leverage is within allowed range
pub fn validate_leverage(leverage: Decimal, min_leverage: Decimal, max_leverage: Decimal) -> Result<(), String> {
    if leverage < min_leverage || leverage > max_leverage {
        return Err(format!(
            "Leverage {} must be between {} and {}",
            leverage, min_leverage, max_leverage
        ));
    }
    Ok(())
}

/// Validate order size
pub fn validate_order_size(size: Decimal, min_size: Decimal, step_size: Decimal) -> Result<(), String> {
    if size < min_size {
        return Err(format!("Order size {} is below minimum {}", size, min_size));
    }
    
    // Check if size is aligned to step_size
    let remainder = size % step_size;
    if remainder != Decimal::ZERO {
        return Err(format!(
            "Order size {} must be a multiple of step size {}",
            size, step_size
        ));
    }
    
    Ok(())
}

/// Validate limit price alignment
pub fn validate_limit_price(price: Decimal, price_tick: Decimal) -> Result<(), String> {
    let remainder = price % price_tick;
    if remainder != Decimal::ZERO {
        return Err(format!(
            "Limit price {} must be aligned to price tick {}",
            price, price_tick
        ));
    }
    Ok(())
}

/// Validate SL/TP for BUY order
pub fn validate_sl_tp_buy(
    sl: Option<Decimal>,
    tp: Option<Decimal>,
    expected_entry: Decimal,
) -> Result<(), String> {
    if let Some(sl_price) = sl {
        if sl_price >= expected_entry {
            return Err(format!(
                "Stop loss {} must be below expected entry {} for BUY order",
                sl_price, expected_entry
            ));
        }
    }
    
    if let Some(tp_price) = tp {
        if tp_price <= expected_entry {
            return Err(format!(
                "Take profit {} must be above expected entry {} for BUY order",
                tp_price, expected_entry
            ));
        }
    }
    
    Ok(())
}

/// Validate SL/TP for SELL order
pub fn validate_sl_tp_sell(
    sl: Option<Decimal>,
    tp: Option<Decimal>,
    expected_entry: Decimal,
) -> Result<(), String> {
    if let Some(sl_price) = sl {
        if sl_price <= expected_entry {
            return Err(format!(
                "Stop loss {} must be above expected entry {} for SELL order",
                sl_price, expected_entry
            ));
        }
    }
    
    if let Some(tp_price) = tp {
        if tp_price >= expected_entry {
            return Err(format!(
                "Take profit {} must be below expected entry {} for SELL order",
                tp_price, expected_entry
            ));
        }
    }
    
    Ok(())
}

/// Validate order type and price consistency
pub fn validate_order_type_price(order_type: OrderType, limit_price: Option<Decimal>) -> Result<(), String> {
    match order_type {
        OrderType::Market => {
            if limit_price.is_some() {
                return Err("Market order must not include limit_price".to_string());
            }
        }
        OrderType::Limit => {
            if limit_price.is_none() {
                return Err("Limit order must include limit_price".to_string());
            }
        }
    }
    Ok(())
}


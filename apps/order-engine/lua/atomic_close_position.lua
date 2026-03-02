-- Atomic position close script
-- Args: position_id, exit_price, close_size (0 = full), timestamp_ms, [close_reason] (optional: "liquidated" => status LIQUIDATED)
-- Returns: JSON with close result
-- Supports both old format (JSON) and new format (Hash)

local position_key = KEYS[1]
local position_id = ARGV[1]
local exit_price = ARGV[2]
local close_size = ARGV[3]
local timestamp_ms = ARGV[4]
local close_reason_raw = (ARGV[5] and ARGV[5] ~= "") and ARGV[5] or nil
local close_reason_lower = (close_reason_raw and type(close_reason_raw) == "string") and string.lower(close_reason_raw) or ""
local full_close_status = (close_reason_lower == "liquidated") and "LIQUIDATED" or "CLOSED"

-- Try new format first (Hash)
local pos_key_new = 'pos:by_id:' .. position_id
local position = nil
local is_new_format = false
local symbol = nil
local side = nil
local user_id = nil

-- Check new format (Hash)
if redis.call('EXISTS', pos_key_new) == 1 then
    is_new_format = true
    symbol = redis.call('HGET', pos_key_new, 'symbol')
    side = redis.call('HGET', pos_key_new, 'side')
    user_id = redis.call('HGET', pos_key_new, 'user_id')
    local status = redis.call('HGET', pos_key_new, 'status')
    if status and status:upper() ~= "OPEN" then
        return '{"error":"position_not_open","status":"' .. (status or "unknown") .. '"}'
    end
    if not status or status == "" then
        return '{"error":"position_not_open","status":"unknown"}'
    end
    -- Convert Hash to table-like structure for compatibility
    position = {
        symbol = symbol,
        side = side,
        user_id = user_id,
        status = status,
        size = redis.call('HGET', pos_key_new, 'size') or "0",
        entry_price = redis.call('HGET', pos_key_new, 'entry_price') or "0",
        realized_pnl = redis.call('HGET', pos_key_new, 'realized_pnl') or "0"
    }
else
    -- Try old format (JSON)
local position_json = redis.call('GET', position_key)
if not position_json then
    return '{"error":"position_not_found"}'
end
    position = cjson.decode(position_json)
    symbol = position.symbol
    side = position.side
    user_id = position.user_id
end

-- Status already checked above for new format
if not is_new_format then
    local status_old = position.status or ""
    if status_old:upper() ~= "OPEN" then
        return '{"error":"position_not_open","status":"' .. status_old .. '"}'
    end
end

local current_size = tonumber(position.size)
local close_size_num = tonumber(close_size)

-- Determine actual close size
local actual_close_size = close_size_num
if close_size_num == 0 or close_size_num >= current_size then
    actual_close_size = current_size
end

if actual_close_size > current_size then
    return '{"error":"close_size_exceeds_position"}'
end

-- Calculate PnL
local entry_price = tonumber(position.entry_price)
local pnl = 0
if position.side == "LONG" then
    pnl = (tonumber(exit_price) - entry_price) * actual_close_size
else
    pnl = (entry_price - tonumber(exit_price)) * actual_close_size
end

-- Update position
if actual_close_size >= current_size then
    -- Full close
    if is_new_format then
        redis.call('HSET', pos_key_new, 'status', full_close_status)
        redis.call('HSET', pos_key_new, 'size', '0')
        -- Preserve original size for position history display
        redis.call('HSET', pos_key_new, 'original_size', tostring(current_size))
        -- Store exit price for position history
        redis.call('HSET', pos_key_new, 'exit_price', tostring(exit_price))
        redis.call('HSET', pos_key_new, 'closed_at', timestamp_ms)
        redis.call('HSET', pos_key_new, 'updated_at', timestamp_ms)
        local new_realized_pnl = tonumber(position.realized_pnl or "0") + pnl
        redis.call('HSET', pos_key_new, 'realized_pnl', tostring(new_realized_pnl))
        
        -- Remove from symbol indexes (full close)
        local symbol_open_key = 'pos:open:' .. symbol
        redis.call('ZREM', symbol_open_key, position_id)
        local sl_key = 'pos:sl:' .. symbol
        redis.call('ZREM', sl_key, position_id)
        local tp_key = 'pos:tp:' .. symbol
        redis.call('ZREM', tp_key, position_id)
    else
    position.status = full_close_status
    position.size = "0"
    -- Preserve original size for position history display
    position.original_size = tostring(current_size)
    -- Store exit price for position history
    position.exit_price = tostring(exit_price)
    position.closed_at = timestamp_ms
        position.realized_pnl = tostring(tonumber(position.realized_pnl or "0") + pnl)
        position.updated_at = timestamp_ms
        redis.call('SET', position_key, cjson.encode(position))
        
        -- Remove from symbol indexes (full close)
        local symbol_open_key = 'pos:open:' .. symbol
        redis.call('ZREM', symbol_open_key, position_id)
        local sl_key = 'pos:sl:' .. symbol
        redis.call('ZREM', sl_key, position_id)
        local tp_key = 'pos:tp:' .. symbol
        redis.call('ZREM', tp_key, position_id)
    end
else
    -- Partial close
    if is_new_format then
        local new_size = current_size - actual_close_size
        redis.call('HSET', pos_key_new, 'size', tostring(new_size))
        redis.call('HSET', pos_key_new, 'updated_at', timestamp_ms)
        local new_realized_pnl = tonumber(position.realized_pnl or "0") + pnl
        redis.call('HSET', pos_key_new, 'realized_pnl', tostring(new_realized_pnl))
        -- Indexes remain (position still open)
    else
    position.size = tostring(current_size - actual_close_size)
position.realized_pnl = tostring(tonumber(position.realized_pnl or "0") + pnl)
position.updated_at = timestamp_ms
redis.call('SET', position_key, cjson.encode(position))
        -- Indexes remain (position still open)
    end
end

-- Keep closed positions in the user's position set (don't remove them)
-- This allows the API to return both open and closed positions
-- The status field will indicate whether the position is OPEN or CLOSED
-- if actual_close_size >= current_size then
--     local positions_key = 'pos:' .. user_id
--     local old_positions_key = 'user:' .. user_id .. ':positions'
--     redis.call('SREM', positions_key, position_id)
--     redis.call('SREM', old_positions_key, position_id)
-- end

-- Update balance
local user_id = position.user_id
local balance_key = 'user:' .. user_id .. ':balance'
local balance_json = redis.call('GET', balance_key)
local balance = balance_json and cjson.decode(balance_json) or {
    currency = "USD",
    available = "10000.0",
    locked = "0",
    equity = "10000.0",
    margin_used = "0",
    free_margin = "10000.0"
}

balance.available = tostring(tonumber(balance.available) + pnl)
balance.equity = tostring(tonumber(balance.equity) + pnl)
balance.free_margin = tostring(tonumber(balance.equity) - tonumber(balance.margin_used))
balance.updated_at = timestamp_ms

redis.call('SET', balance_key, cjson.encode(balance))

-- Return result
local result = {
    success = true,
    position_id = position_id,
    closed_size = tostring(actual_close_size),
    exit_price = exit_price,
    realized_pnl = tostring(pnl),
    is_full_close = (actual_close_size >= current_size)
}

return cjson.encode(result)


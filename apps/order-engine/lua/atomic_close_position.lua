-- Atomic position close script
-- Args: position_id, exit_price, close_size (0 = full), timestamp_ms
-- Returns: JSON with close result

local position_key = KEYS[1]
local position_id = ARGV[1]
local exit_price = ARGV[2]
local close_size = ARGV[3]
local timestamp_ms = ARGV[4]

-- Get position
local position_json = redis.call('GET', position_key)
if not position_json then
    return '{"error":"position_not_found"}'
end

local position = cjson.decode(position_json)

-- Verify status is OPEN
if position.status ~= "OPEN" then
    return '{"error":"position_not_open","status":"' .. position.status .. '"}'
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
    position.status = "CLOSED"
    position.size = "0"
    position.closed_at = timestamp_ms
else
    -- Partial close
    position.size = tostring(current_size - actual_close_size)
end

position.realized_pnl = tostring(tonumber(position.realized_pnl or "0") + pnl)
position.updated_at = timestamp_ms

-- Save position
redis.call('SET', position_key, cjson.encode(position))

-- Remove from user positions if fully closed
if position.status == "CLOSED" then
    local user_id = position.user_id
    redis.call('SREM', 'user:' .. user_id .. ':positions', position_id)
end

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


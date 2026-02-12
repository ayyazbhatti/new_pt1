-- Atomic order cancel script
-- Args: order_id, timestamp_ms
-- Returns: "1" if canceled, "0" if not found or not pending

local order_key = KEYS[1]
local order_id = ARGV[1]
local timestamp_ms = ARGV[2]

-- Get order
local order_json = redis.call('GET', order_key)
if not order_json then
    return "0"
end

local order = cjson.decode(order_json)

-- Verify status is PENDING
if order.status ~= "PENDING" then
    return "0"
end

-- Update order
order.status = "CANCELED"
order.updated_at = timestamp_ms
order.canceled_at = timestamp_ms

-- Save order
redis.call('SET', order_key, cjson.encode(order))

-- Remove from pending zset
local symbol = order.symbol
redis.call('ZREM', 'orders:pending:' .. symbol, order_id)

return "1"


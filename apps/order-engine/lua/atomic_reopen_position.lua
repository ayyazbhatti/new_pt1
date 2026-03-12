-- Atomic position reopen script: restore the same position record to OPEN.
-- Args: position_id, timestamp_ms
-- Returns: JSON with success or error
-- Only supports new format (Hash pos:by_id:{id}). Requires status CLOSED or LIQUIDATED and original_size.

local position_id = ARGV[1]
local timestamp_ms = ARGV[2]

local pos_key = 'pos:by_id:' .. position_id
if redis.call('EXISTS', pos_key) == 0 then
    return '{"error":"position_not_found"}'
end

local status = redis.call('HGET', pos_key, 'status')
if not status or (status:upper() ~= "CLOSED" and status:upper() ~= "LIQUIDATED") then
    return '{"error":"position_not_closed","status":"' .. (status or "unknown") .. '"}'
end

local original_size = redis.call('HGET', pos_key, 'original_size')
local size_fallback = redis.call('HGET', pos_key, 'size')
local restore_size = original_size or size_fallback or "0"
if tonumber(restore_size) == 0 then
    return '{"error":"cannot_reopen","message":"original_size missing or zero"}'
end

local symbol = redis.call('HGET', pos_key, 'symbol')
local entry_price = redis.call('HGET', pos_key, 'entry_price') or "0"
local user_id = redis.call('HGET', pos_key, 'user_id')
if not symbol or not user_id then
    return '{"error":"invalid_position","message":"missing symbol or user_id"}'
end

-- Restore position to OPEN (same record)
redis.call('HSET', pos_key, 'status', 'OPEN')
redis.call('HSET', pos_key, 'size', restore_size)
redis.call('HSET', pos_key, 'updated_at', timestamp_ms)
-- Clear closed-only fields so position is treated as open
redis.call('HDEL', pos_key, 'exit_price')
redis.call('HDEL', pos_key, 'closed_at')

-- Re-add to symbol open index (score = entry price for consistency with fill script)
local symbol_open_key = 'pos:open:' .. symbol
redis.call('ZADD', symbol_open_key, entry_price, position_id)

-- Re-add SL/TP indexes if position has them
local sl = redis.call('HGET', pos_key, 'sl')
if sl and sl ~= '' and sl ~= 'null' then
    local sl_key = 'pos:sl:' .. symbol
    redis.call('ZADD', sl_key, tonumber(sl), position_id)
end
local tp = redis.call('HGET', pos_key, 'tp')
if tp and tp ~= '' and tp ~= 'null' then
    local tp_key = 'pos:tp:' .. symbol
    redis.call('ZADD', tp_key, tonumber(tp), position_id)
end

-- pos:{user_id} already contains position_id (we don't remove it on close)
-- Balance margin will be recomputed by account summary / tick handler from open positions

return cjson.encode({
    success = true,
    position_id = position_id,
    symbol = symbol,
    size = restore_size,
    entry_price = entry_price
})

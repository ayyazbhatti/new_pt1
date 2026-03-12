-- Reopen the same position with optional overrides: size, entry_price, side, sl, tp.
-- Args: position_id, timestamp_ms, size_override (or ""), entry_override (or ""), side_override (or ""), sl_override (or ""), tp_override (or "")
-- Only supports Hash pos:by_id:{id}. Requires status CLOSED or LIQUIDATED.

local position_id = ARGV[1]
local timestamp_ms = ARGV[2]
local size_override = ARGV[3] or ''
local entry_override = ARGV[4] or ''
local side_override = ARGV[5] or ''
local sl_override = ARGV[6] or ''
local tp_override = ARGV[7] or ''

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
local restore_size
if size_override ~= '' and tonumber(size_override) and tonumber(size_override) > 0 then
    restore_size = size_override
else
    restore_size = original_size or size_fallback or "0"
end
if tonumber(restore_size) == 0 then
    return '{"error":"cannot_reopen","message":"size missing or zero"}'
end

local symbol = redis.call('HGET', pos_key, 'symbol')
local entry_existing = redis.call('HGET', pos_key, 'entry_price') or "0"
local restore_entry
if entry_override ~= '' and tonumber(entry_override) and tonumber(entry_override) > 0 then
    restore_entry = entry_override
else
    restore_entry = entry_existing
end

local user_id = redis.call('HGET', pos_key, 'user_id')
if not symbol or not user_id then
    return '{"error":"invalid_position","message":"missing symbol or user_id"}'
end

local side_existing = redis.call('HGET', pos_key, 'side') or "LONG"
local restore_side = (side_override == "SHORT" or side_override == "LONG") and side_override or side_existing

-- Restore position to OPEN (same record)
redis.call('HSET', pos_key, 'status', 'OPEN')
redis.call('HSET', pos_key, 'size', restore_size)
redis.call('HSET', pos_key, 'entry_price', restore_entry)
redis.call('HSET', pos_key, 'side', restore_side)
redis.call('HSET', pos_key, 'updated_at', timestamp_ms)
redis.call('HDEL', pos_key, 'exit_price')
redis.call('HDEL', pos_key, 'closed_at')

-- Remove from SL/TP indexes (we may set new values below)
local sl_key = 'pos:sl:' .. symbol
local tp_key = 'pos:tp:' .. symbol
redis.call('ZREM', sl_key, position_id)
redis.call('ZREM', tp_key, position_id)
redis.call('HDEL', pos_key, 'sl')
redis.call('HDEL', pos_key, 'tp')

if sl_override ~= '' and tonumber(sl_override) then
    redis.call('HSET', pos_key, 'sl', sl_override)
    redis.call('ZADD', sl_key, tonumber(sl_override), position_id)
end
if tp_override ~= '' and tonumber(tp_override) then
    redis.call('HSET', pos_key, 'tp', tp_override)
    redis.call('ZADD', tp_key, tonumber(tp_override), position_id)
end

-- Re-add to symbol open index (score = entry price)
local symbol_open_key = 'pos:open:' .. symbol
redis.call('ZADD', symbol_open_key, restore_entry, position_id)

return cjson.encode({
    success = true,
    position_id = position_id,
    symbol = symbol,
    size = restore_size,
    entry_price = restore_entry,
    side = restore_side
})

-- Update an OPEN position's size, entry_price, sl, tp. Only for status=OPEN.
-- Args: position_id, timestamp_ms, size_override (or ""), entry_override (or ""), sl_override (or ""), tp_override (or "")
-- Empty string = keep existing for size/entry; for sl/tp empty = clear.

local position_id = ARGV[1]
local timestamp_ms = ARGV[2]
local size_override = ARGV[3] or ''
local entry_override = ARGV[4] or ''
local sl_override = ARGV[5] or ''
local tp_override = ARGV[6] or ''

local pos_key = 'pos:by_id:' .. position_id
if redis.call('EXISTS', pos_key) == 0 then
    return '{"error":"position_not_found"}'
end

local status = redis.call('HGET', pos_key, 'status')
if not status or status:upper() ~= "OPEN" then
    return '{"error":"position_not_open","status":"' .. (status or "unknown") .. '"}'
end

local symbol = redis.call('HGET', pos_key, 'symbol')
local user_id = redis.call('HGET', pos_key, 'user_id')
if not symbol or not user_id then
    return '{"error":"invalid_position","message":"missing symbol or user_id"}'
end

local size_current = redis.call('HGET', pos_key, 'size') or "0"
local entry_current = redis.call('HGET', pos_key, 'entry_price') or redis.call('HGET', pos_key, 'avg_price') or "0"
local new_size = size_current
local new_entry = entry_current

if size_override ~= '' and tonumber(size_override) and tonumber(size_override) > 0 then
    new_size = size_override
end
if entry_override ~= '' and tonumber(entry_override) and tonumber(entry_override) > 0 then
    new_entry = entry_override
end

-- Update size, entry_price, avg_price
redis.call('HSET', pos_key, 'size', new_size)
redis.call('HSET', pos_key, 'entry_price', new_entry)
redis.call('HSET', pos_key, 'avg_price', new_entry)
redis.call('HSET', pos_key, 'updated_at', timestamp_ms)

-- Recalculate margin: (size * entry_price) / leverage
local leverage = tonumber(redis.call('HGET', pos_key, 'leverage') or '100')
local margin = (tonumber(new_size) * tonumber(new_entry)) / leverage
redis.call('HSET', pos_key, 'margin', tostring(margin))

-- SL/TP: remove from indexes, then set new or clear
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

-- Update pos:open index (score = entry price)
local symbol_open_key = 'pos:open:' .. symbol
redis.call('ZADD', symbol_open_key, new_entry, position_id)

return cjson.encode({
    success = true,
    position_id = position_id,
    symbol = symbol,
    size = new_size,
    entry_price = new_entry
})

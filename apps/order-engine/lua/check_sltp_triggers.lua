-- Check SL/TP triggers for a symbol using price range queries
-- Args: symbol, current_bid, current_ask
-- Returns: JSON array of triggered positions with trigger reason
-- Optimized for 1M+ positions using range queries (O(log N + M))

local symbol = ARGV[1]
local current_bid = tonumber(ARGV[2])
local current_ask = tonumber(ARGV[3])

local triggered = {}

-- Helper function to verify position and add to triggered list
local function add_triggered(pos_id, reason, trigger_price)
    local pos_key = 'pos:by_id:' .. pos_id
    -- Verify position exists and is OPEN
    local status = redis.call('HGET', pos_key, 'status')
    if status == 'OPEN' then
        -- Check if position was just created (grace period of 2 seconds)
        -- This prevents immediate SL/TP triggering right after order fill
        local opened_at = redis.call('HGET', pos_key, 'opened_at')
        if opened_at then
            local current_time = redis.call('TIME')
            -- TIME returns [seconds, microseconds], convert to milliseconds
            -- microseconds is 0-999999, so divide by 1000 to get milliseconds
            local current_timestamp_ms = tonumber(current_time[1]) * 1000 + math.floor(tonumber(current_time[2]) / 1000)
            local opened_timestamp_ms = tonumber(opened_at)
            
            -- Handle case where opened_at might be in seconds instead of milliseconds
            -- Check if it's a reasonable timestamp in seconds (e.g., > year 2000 but < year 2100)
            if opened_timestamp_ms > 946684800 and opened_timestamp_ms < 4102444800 then
                -- It's in seconds (Unix timestamp), convert to milliseconds
                opened_timestamp_ms = opened_timestamp_ms * 1000
            end
            
            local age_ms = current_timestamp_ms - opened_timestamp_ms
            
            -- Grace period: 2 seconds (2000ms) - don't trigger SL/TP immediately after creation
            if age_ms >= 0 and age_ms < 2000 then
                return -- Skip triggering for positions created less than 2 seconds ago
            end
        end
        
        table.insert(triggered, {
            position_id = pos_id,
            reason = reason,
            trigger_price = trigger_price
        })
    end
end

-- Check LONG positions for SL trigger (bid <= sl)
-- Range query: positions with SL >= current_bid (might trigger)
-- If SL >= current_bid, then current_bid <= SL, which means SL can trigger
local long_sl_key = 'pos:sl:' .. symbol
local long_sl_positions = redis.call('ZRANGEBYSCORE', long_sl_key, current_bid, '+inf', 'WITHSCORES')
for i = 1, #long_sl_positions, 2 do
    local pos_id = long_sl_positions[i]
    local sl_price = tonumber(long_sl_positions[i+1])
    local pos_key = 'pos:by_id:' .. pos_id
    local side = redis.call('HGET', pos_key, 'side')
    if side == 'LONG' then
        add_triggered(pos_id, 'SL', sl_price)
    end
end

-- Check LONG positions for TP trigger (bid >= tp)
-- Range query: positions with TP <= current_bid (might trigger)
-- If TP <= current_bid, then current_bid >= TP, which means TP can trigger
local long_tp_key = 'pos:tp:' .. symbol
local long_tp_positions = redis.call('ZRANGEBYSCORE', long_tp_key, '-inf', current_bid, 'WITHSCORES')
for i = 1, #long_tp_positions, 2 do
    local pos_id = long_tp_positions[i]
    local tp_price = tonumber(long_tp_positions[i+1])
    local pos_key = 'pos:by_id:' .. pos_id
    local side = redis.call('HGET', pos_key, 'side')
    if side == 'LONG' then
        add_triggered(pos_id, 'TP', tp_price)
    end
end

-- Check SHORT positions for SL trigger (ask >= sl)
-- Range query: positions with SL <= current_ask (might trigger)
-- If SL <= current_ask, then current_ask >= SL, which means SL can trigger
local short_sl_key = 'pos:sl:' .. symbol
local short_sl_positions = redis.call('ZRANGEBYSCORE', short_sl_key, '-inf', current_ask, 'WITHSCORES')
for i = 1, #short_sl_positions, 2 do
    local pos_id = short_sl_positions[i]
    local sl_price = tonumber(short_sl_positions[i+1])
    local pos_key = 'pos:by_id:' .. pos_id
    local side = redis.call('HGET', pos_key, 'side')
    if side == 'SHORT' then
        add_triggered(pos_id, 'SL', sl_price)
    end
end

-- Check SHORT positions for TP trigger (ask <= tp)
-- Range query: positions with TP >= current_ask (might trigger)
-- If TP >= current_ask, then current_ask <= TP, which means TP can trigger
local short_tp_key = 'pos:tp:' .. symbol
local short_tp_positions = redis.call('ZRANGEBYSCORE', short_tp_key, current_ask, '+inf', 'WITHSCORES')
for i = 1, #short_tp_positions, 2 do
    local pos_id = short_tp_positions[i]
    local tp_price = tonumber(short_tp_positions[i+1])
    local pos_key = 'pos:by_id:' .. pos_id
    local side = redis.call('HGET', pos_key, 'side')
    if side == 'SHORT' then
        add_triggered(pos_id, 'TP', tp_price)
    end
end

return cjson.encode(triggered)


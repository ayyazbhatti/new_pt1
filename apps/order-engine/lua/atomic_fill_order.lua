-- Atomic order fill script
-- Args: order_id, fill_price, fill_size, timestamp_ms, position_uuid
-- Returns: JSON with fill result

local order_key = KEYS[1]
local order_id = ARGV[1]
local fill_price = ARGV[2]
local fill_size = ARGV[3]
local timestamp_ms = ARGV[4]
local position_uuid = ARGV[5]

-- Get order
local order_json = redis.call('GET', order_key)
if not order_json then
    return '{"error":"order_not_found"}'
end

local order = cjson.decode(order_json)

-- Verify status is PENDING
if order.status ~= "PENDING" then
    return '{"error":"order_not_pending","status":"' .. order.status .. '"}'
end

-- For limit orders, verify price condition
if order.order_type == "LIMIT" and order.limit_price then
    if order.side == "BUY" and tonumber(fill_price) > tonumber(order.limit_price) then
        return '{"error":"limit_price_not_met"}'
    end
    if order.side == "SELL" and tonumber(fill_price) < tonumber(order.limit_price) then
        return '{"error":"limit_price_not_met"}'
    end
end

-- Update order
order.status = "FILLED"
order.filled_size = fill_size
order.average_fill_price = fill_price
order.updated_at = timestamp_ms
order.filled_at = timestamp_ms

-- Save order
redis.call('SET', order_key, cjson.encode(order))

-- Remove from pending zset
local symbol = order.symbol
redis.call('ZREM', 'orders:pending:' .. symbol, order_id)

-- Get or create position
local user_id = order.user_id
-- Use correct key format: pos:{user_id} (matches backend Keys::positions_set)
local positions_key = 'pos:' .. user_id
local old_positions_key = 'user:' .. user_id .. ':positions'
local position_id = nil
-- Check both new and old format for backward compatibility
local existing_positions = redis.call('SMEMBERS', positions_key)
local old_positions = redis.call('SMEMBERS', old_positions_key)
-- Merge both sets (Lua doesn't have set union, so we'll check both)

-- Check for existing position (new format)
for _, pos_id in ipairs(existing_positions) do
    -- Try both old format (position:pos-X) and new format (pos:by_id:{uuid})
    local pos_key_old = 'position:' .. pos_id
    local pos_key_new = 'pos:by_id:' .. pos_id
    
    -- Check new format first (Hash)
    local pos_exists = redis.call('EXISTS', pos_key_new)
    if pos_exists == 1 then
        local pos_symbol = redis.call('HGET', pos_key_new, 'symbol')
        local pos_status = redis.call('HGET', pos_key_new, 'status')
        local pos_side = redis.call('HGET', pos_key_new, 'side')
        
        if pos_symbol == symbol and pos_status == "OPEN" then
            if (order.side == "BUY" and pos_side == "LONG") or
               (order.side == "SELL" and pos_side == "SHORT") then
                position_id = pos_id
                -- Update position (Hash format)
                local pos_size = tonumber(redis.call('HGET', pos_key_new, 'size') or '0')
                local pos_entry_price = tonumber(redis.call('HGET', pos_key_new, 'entry_price') or '0')
                local total_size = pos_size + tonumber(fill_size)
                local total_notional = (pos_entry_price * pos_size) + (tonumber(fill_price) * tonumber(fill_size))
                local new_entry_price = total_notional / total_size
                
                -- Calculate margin: (size * entry_price) / leverage
                local pos_leverage = tonumber(redis.call('HGET', pos_key_new, 'leverage') or '100.0')
                local new_margin = (total_size * new_entry_price) / pos_leverage
                
                redis.call('HSET', pos_key_new, 'size', tostring(total_size))
                redis.call('HSET', pos_key_new, 'entry_price', tostring(new_entry_price))
                redis.call('HSET', pos_key_new, 'avg_price', tostring(new_entry_price))
                redis.call('HSET', pos_key_new, 'margin', tostring(new_margin))
                redis.call('HSET', pos_key_new, 'updated_at', timestamp_ms)
                
                -- Update symbol indexes (position already exists, just update entry price in index)
                local symbol_open_key = 'pos:open:' .. symbol
                redis.call('ZADD', symbol_open_key, new_entry_price, position_id)
                -- SL/TP indexes remain the same unless order has new SL/TP
                if order.stop_loss then
                    local sl_key = 'pos:sl:' .. symbol
                    redis.call('ZADD', sl_key, tonumber(order.stop_loss), position_id)
                end
                if order.take_profit then
                    local tp_key = 'pos:tp:' .. symbol
                    redis.call('ZADD', tp_key, tonumber(order.take_profit), position_id)
                end
                break
            end
        end
    else
        -- Check old format (JSON) for backward compatibility
        local pos_json = redis.call('GET', pos_key_old)
    if pos_json then
        local pos = cjson.decode(pos_json)
        if pos.symbol == symbol and pos.status == "OPEN" then
            if (order.side == "BUY" and pos.side == "LONG") or
               (order.side == "SELL" and pos.side == "SHORT") then
                position_id = pos_id
                    -- Migrate to new format and update
                    local pos_size = tonumber(pos.size or '0')
                    local pos_entry_price = tonumber(pos.entry_price or '0')
                    local total_size = pos_size + tonumber(fill_size)
                    local total_notional = (pos_entry_price * pos_size) + (tonumber(fill_price) * tonumber(fill_size))
                    local new_entry_price = total_notional / total_size
                    
                    -- Migrate old position to new format using UUID
                    -- If position ID is old format (pos-X), migrate to UUID
                    if string.find(pos_id, 'pos%-') then
                        -- Use UUID for new format
                        position_id = position_uuid
                        -- Calculate margin: (size * entry_price) / leverage
                        local pos_leverage = tonumber(pos.leverage or "100.0")
                        local new_margin = (total_size * new_entry_price) / pos_leverage
                        
                        local new_pos_key = 'pos:by_id:' .. position_id
                        redis.call('HSET', new_pos_key, 'user_id', user_id)
                        redis.call('HSET', new_pos_key, 'symbol', symbol)
                        redis.call('HSET', new_pos_key, 'group_id', order.group_id or '')
                        redis.call('HSET', new_pos_key, 'side', (order.side == "BUY") and "LONG" or "SHORT")
                        redis.call('HSET', new_pos_key, 'size', tostring(total_size))
                        redis.call('HSET', new_pos_key, 'entry_price', tostring(new_entry_price))
                        redis.call('HSET', new_pos_key, 'avg_price', tostring(new_entry_price))
                        redis.call('HSET', new_pos_key, 'leverage', tostring(pos_leverage))
                        redis.call('HSET', new_pos_key, 'margin', tostring(new_margin))
                        redis.call('HSET', new_pos_key, 'unrealized_pnl', pos.unrealized_pnl or "0")
                        redis.call('HSET', new_pos_key, 'realized_pnl', pos.realized_pnl or "0")
                        redis.call('HSET', new_pos_key, 'status', "OPEN")
                        redis.call('HSET', new_pos_key, 'opened_at', pos.opened_at or timestamp_ms)
                        redis.call('HSET', new_pos_key, 'updated_at', timestamp_ms)
                        if pos.stop_loss then
                            redis.call('HSET', new_pos_key, 'sl', tostring(pos.stop_loss))
                        else
                            redis.call('HSET', new_pos_key, 'sl', 'null')
                        end
                        if pos.take_profit then
                            redis.call('HSET', new_pos_key, 'tp', tostring(pos.take_profit))
                        else
                            redis.call('HSET', new_pos_key, 'tp', 'null')
                        end
                        
                        -- Remove old ID from set and add UUID
                        redis.call('SREM', positions_key, pos_id)
                        redis.call('SADD', positions_key, position_id)
                        
                        -- Add to symbol indexes for SL/TP trigger system
                        local symbol_open_key = 'pos:open:' .. symbol
                        redis.call('ZADD', symbol_open_key, new_entry_price, position_id)
                        
                        if pos.stop_loss then
                            local sl_key = 'pos:sl:' .. symbol
                            redis.call('ZADD', sl_key, tonumber(pos.stop_loss), position_id)
                        end
                        if pos.take_profit then
                            local tp_key = 'pos:tp:' .. symbol
                            redis.call('ZADD', tp_key, tonumber(pos.take_profit), position_id)
                        end
                    else
                        -- Already UUID format, just update
                        position_id = pos_id
                        local new_pos_key = 'pos:by_id:' .. position_id
                        -- Calculate margin: (size * entry_price) / leverage
                        local pos_leverage = tonumber(redis.call('HGET', new_pos_key, 'leverage') or '100.0')
                        local new_margin = (total_size * new_entry_price) / pos_leverage
                        
                        redis.call('HSET', new_pos_key, 'size', tostring(total_size))
                        redis.call('HSET', new_pos_key, 'entry_price', tostring(new_entry_price))
                        redis.call('HSET', new_pos_key, 'avg_price', tostring(new_entry_price))
                        redis.call('HSET', new_pos_key, 'margin', tostring(new_margin))
                        redis.call('HSET', new_pos_key, 'updated_at', timestamp_ms)
                        
                        -- Update symbol indexes
                        local symbol_open_key = 'pos:open:' .. symbol
                        redis.call('ZADD', symbol_open_key, new_entry_price, position_id)
                        -- SL/TP indexes remain the same unless order has new SL/TP
                        if order.stop_loss then
                            local sl_key = 'pos:sl:' .. symbol
                            redis.call('ZADD', sl_key, tonumber(order.stop_loss), position_id)
                        end
                        if order.take_profit then
                            local tp_key = 'pos:tp:' .. symbol
                            redis.call('ZADD', tp_key, tonumber(order.take_profit), position_id)
                        end
                    end
                break
                end
            end
        end
    end
end

-- Check old format positions set for backward compatibility
if not position_id then
    for _, pos_id in ipairs(old_positions) do
        -- Skip if already checked in new format
        local already_checked = false
        for _, checked_id in ipairs(existing_positions) do
            if checked_id == pos_id then
                already_checked = true
                break
            end
        end
        if not already_checked then
            -- Check old format (JSON)
            local pos_key_old = 'position:' .. pos_id
            local pos_json = redis.call('GET', pos_key_old)
            if pos_json then
                local pos = cjson.decode(pos_json)
                if pos.symbol == symbol and pos.status == "OPEN" then
                    if (order.side == "BUY" and pos.side == "LONG") or
                       (order.side == "SELL" and pos.side == "SHORT") then
                        -- Migrate old position to new format using UUID
                        position_id = position_uuid
                        local pos_size = tonumber(pos.size or '0')
                        local pos_entry_price = tonumber(pos.entry_price or '0')
                        local total_size = pos_size + tonumber(fill_size)
                        local total_notional = (pos_entry_price * pos_size) + (tonumber(fill_price) * tonumber(fill_size))
                        local new_entry_price = total_notional / total_size
                        
                        -- Store in new format
                        -- Calculate margin: (size * entry_price) / leverage
                        local pos_leverage = tonumber(pos.leverage or "100.0")
                        local new_margin = (total_size * new_entry_price) / pos_leverage
                        
                        local new_pos_key = 'pos:by_id:' .. position_id
                        redis.call('HSET', new_pos_key, 'user_id', user_id)
                        redis.call('HSET', new_pos_key, 'symbol', symbol)
                        redis.call('HSET', new_pos_key, 'group_id', order.group_id or '')
                        redis.call('HSET', new_pos_key, 'side', (order.side == "BUY") and "LONG" or "SHORT")
                        redis.call('HSET', new_pos_key, 'size', tostring(total_size))
                        redis.call('HSET', new_pos_key, 'entry_price', tostring(new_entry_price))
                        redis.call('HSET', new_pos_key, 'avg_price', tostring(new_entry_price))
                        redis.call('HSET', new_pos_key, 'leverage', tostring(pos_leverage))
                        redis.call('HSET', new_pos_key, 'margin', tostring(new_margin))
                        redis.call('HSET', new_pos_key, 'unrealized_pnl', pos.unrealized_pnl or "0")
                        redis.call('HSET', new_pos_key, 'realized_pnl', pos.realized_pnl or "0")
                        redis.call('HSET', new_pos_key, 'status', "OPEN")
                        redis.call('HSET', new_pos_key, 'opened_at', pos.opened_at or timestamp_ms)
                        redis.call('HSET', new_pos_key, 'updated_at', timestamp_ms)
                        if pos.stop_loss then
                            redis.call('HSET', new_pos_key, 'sl', tostring(pos.stop_loss))
                        else
                            redis.call('HSET', new_pos_key, 'sl', 'null')
                        end
                        if pos.take_profit then
                            redis.call('HSET', new_pos_key, 'tp', tostring(pos.take_profit))
                        else
                            redis.call('HSET', new_pos_key, 'tp', 'null')
                        end
                        
                        -- Migrate from old set to new set
                        redis.call('SREM', old_positions_key, pos_id)
                        redis.call('SADD', positions_key, position_id)
                        
                        -- Add to symbol indexes for SL/TP trigger system
                        local symbol_open_key = 'pos:open:' .. symbol
                        redis.call('ZADD', symbol_open_key, new_entry_price, position_id)
                        
                        if pos.stop_loss then
                            local sl_key = 'pos:sl:' .. symbol
                            redis.call('ZADD', sl_key, tonumber(pos.stop_loss), position_id)
                        end
                        if pos.take_profit then
                            local tp_key = 'pos:tp:' .. symbol
                            redis.call('ZADD', tp_key, tonumber(pos.take_profit), position_id)
                        end
                        break
                    end
                end
            end
        end
    end
end

-- Create new position if needed
if not position_id then
    position_id = position_uuid
    
    -- Store position as Hash (matches backend format)
    local pos_key = 'pos:by_id:' .. position_id
    -- Calculate margin: (size * entry_price) / leverage
    local leverage = 100.0
    local margin = (tonumber(fill_size) * tonumber(fill_price)) / leverage
    
    redis.call('HSET', pos_key, 'user_id', user_id)
    redis.call('HSET', pos_key, 'symbol', symbol)
    redis.call('HSET', pos_key, 'group_id', order.group_id or '')
    redis.call('HSET', pos_key, 'side', (order.side == "BUY") and "LONG" or "SHORT")
    redis.call('HSET', pos_key, 'size', fill_size)
    redis.call('HSET', pos_key, 'entry_price', fill_price)
    redis.call('HSET', pos_key, 'avg_price', fill_price)
    redis.call('HSET', pos_key, 'leverage', tostring(leverage))
    redis.call('HSET', pos_key, 'margin', tostring(margin))
    redis.call('HSET', pos_key, 'unrealized_pnl', '0')
    redis.call('HSET', pos_key, 'realized_pnl', '0')
    redis.call('HSET', pos_key, 'status', 'OPEN')
    redis.call('HSET', pos_key, 'opened_at', timestamp_ms)
    redis.call('HSET', pos_key, 'updated_at', timestamp_ms)
    if order.stop_loss then
        redis.call('HSET', pos_key, 'sl', tostring(order.stop_loss))
    else
        redis.call('HSET', pos_key, 'sl', 'null')
    end
    if order.take_profit then
        redis.call('HSET', pos_key, 'tp', tostring(order.take_profit))
    else
        redis.call('HSET', pos_key, 'tp', 'null')
    end
    
    -- Add to positions set using correct key format
    redis.call('SADD', positions_key, position_id)
    
    -- Add to symbol indexes for SL/TP trigger system
    local symbol_open_key = 'pos:open:' .. symbol
    redis.call('ZADD', symbol_open_key, tonumber(fill_price), position_id)
    
    -- Add to SL index if stop_loss exists
    if order.stop_loss then
        local sl_key = 'pos:sl:' .. symbol
        redis.call('ZADD', sl_key, tonumber(order.stop_loss), position_id)
    end
    
    -- Add to TP index if take_profit exists
    if order.take_profit then
        local tp_key = 'pos:tp:' .. symbol
        redis.call('ZADD', tp_key, tonumber(order.take_profit), position_id)
    end
end

-- Update balance (simplified - would need proper margin calculation)
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

-- For now, just update timestamp
balance.updated_at = timestamp_ms
redis.call('SET', balance_key, cjson.encode(balance))

-- Return result
local result = {
    success = true,
    order_id = order_id,
    position_id = position_id,
    fill_price = fill_price,
    fill_size = fill_size
}

return cjson.encode(result)


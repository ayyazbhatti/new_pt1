-- Per-user unrealized PnL (micro-USD, 1e6 scale) aggregated in Redis.
-- ARGV[1]: user_id (UUID string)
-- ARGV[2]: swap_open_usd_e6 (integer string) subtracted from sum of open positions (matches auth-service net unrealized)
local uid = ARGV[1]
if not uid or uid == '' then
  return redis.error_reply('ARGV[1] user_id required')
end
local swap_e6 = tonumber(ARGV[2] or '0') or 0

local set_key = 'pos:' .. uid
local agg_key = 'pos:agg:unrealized_usd_e6:' .. uid
local field = 'unrealized_pnl_usd_e6'

local ids = redis.call('SMEMBERS', set_key)
local sum = 0
for _, pid in ipairs(ids) do
  local pk = 'pos:by_id:' .. pid
  local st = redis.call('HGET', pk, 'status')
  if st then
    local u = string.upper(st)
    if u == 'OPEN' then
      local e6 = redis.call('HGET', pk, field)
      if e6 and e6 ~= '' then
        local n = tonumber(e6)
        if n then
          sum = sum + n
        end
      end
    end
  end
end

local final = sum - swap_e6
redis.call('SET', agg_key, tostring(final))
return final

#!/usr/bin/env bash
# Collect system stats JSON for Admin → System (same schema as collect-system-stats.sh).
# - Linux: delegates to deploy/scripts/collect-system-stats.sh (uses /proc, df -B1, …).
# - macOS: host disk + rough memory + Docker; CPU sample omitted (null) unless you extend.
#
# Usage:
#   ./deploy/scripts/collect-system-stats-local.sh [output.json]
# Default output: deploy/stats/system-stats.json
#
# Point auth-service at the file, e.g. in backend/auth-service/.env:
#   SYSTEM_STATS_FILE=/absolute/path/to/deploy/stats/system-stats.json

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_OUT="$DEPLOY_DIR/stats/system-stats.json"
OUTPUT="${1:-$DEFAULT_OUT}"
mkdir -p "$(dirname "$OUTPUT")"

if [ "$(uname -s)" = "Linux" ] && [ -r /proc/uptime ]; then
  exec "$SCRIPT_DIR/collect-system-stats.sh" "$OUTPUT"
fi

TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Uptime (seconds since boot) — macOS
UPTIME_SEC=0
if boot=$(sysctl -n kern.boottime 2>/dev/null); then
  boot_sec=$(echo "$boot" | sed -n 's/{ sec = \([0-9][0-9]*\).*/\1/p')
  now_sec=$(date +%s)
  if [ -n "$boot_sec" ] && [ "$boot_sec" -le "$now_sec" ] 2>/dev/null; then
    UPTIME_SEC=$((now_sec - boot_sec))
  fi
fi

# Root disk — df -k (1024-byte blocks); mount is last column on macOS/BSD
DISK_JSON=$(df -k / 2>/dev/null | awk 'NR==2 {
  size=$2*1024; used=$3*1024; avail=$4*1024
  mount=$NF
  pct=(size>0) ? (used*100/size) : 0
  printf "{\"mount\":\"%s\",\"size\":%.0f,\"used\":%.0f,\"avail\":%.0f,\"usePct\":%.1f}", mount, size, used, avail, pct
}' 2>/dev/null || echo "{}")

VOL_JSON="null"

# Memory (MB) — macOS vm_stat + hw.memsize
MEM_JSON="{}"
total_bytes=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
pagesize=$(sysctl -n hw.pagesize 2>/dev/null || echo 4096)
if [ "${total_bytes:-0}" -gt 0 ] 2>/dev/null && command -v vm_stat >/dev/null 2>&1; then
  # Sum "wired down", "active", "inactive", "speculative", "compressed" as approx used; remainder ~ free
  # vm_stat labels vary; extract all page counts and use MemFree-style if present
  free_pages=$(vm_stat 2>/dev/null | sed -n 's/^Pages free:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)
  inactive_pages=$(vm_stat 2>/dev/null | sed -n 's/^Pages inactive:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)
  speculative_pages=$(vm_stat 2>/dev/null | sed -n 's/^Pages speculative:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -1)
  free_pages=${free_pages:-0}
  inactive_pages=${inactive_pages:-0}
  speculative_pages=${speculative_pages:-0}
  reclaimable=$((inactive_pages + speculative_pages))
  avail_pages=$((free_pages + reclaimable))
  total_pages=$((total_bytes / pagesize))
  if [ "$total_pages" -gt 0 ] 2>/dev/null; then
    used_pages=$((total_pages - avail_pages))
    if [ "$used_pages" -lt 0 ]; then used_pages=0; fi
    total_mb=$((total_bytes / 1024 / 1024))
    used_mb=$((used_pages * pagesize / 1024 / 1024))
    avail_mb=$((total_mb - used_mb))
    if [ "$avail_mb" -lt 0 ]; then avail_mb=0; fi
    pct=$(awk -v u="$used_mb" -v t="$total_mb" 'BEGIN { if (t>0) printf "%.1f", (u*100)/t; else print "0" }')
    MEM_JSON=$(printf '{"totalMb":%d,"usedMb":%d,"availMb":%d,"usePct":%s}' "$total_mb" "$used_mb" "$avail_mb" "$pct")
  fi
fi

CPU_PCT="null"

DOCKER_PS=$(docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}' 2>/dev/null | while IFS='|' read -r name state status; do
  status="${status//\"/\\\"}"
  printf '{"name":"%s","state":"%s","status":"%s"},' "$name" "$state" "$status"
done | sed 's/,$//')
DOCKER_PS="[${DOCKER_PS}]"

DOCKER_STATS=$(docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' 2>/dev/null | while IFS='|' read -r name cpu mem; do
  cpu="${cpu//\"/\\\"}"
  mem="${mem//\"/\\\"}"
  printf '{"name":"%s","cpuPerc":"%s","memUsage":"%s"},' "$name" "$cpu" "$mem"
done | sed 's/,$//')
DOCKER_STATS="[${DOCKER_STATS}]"

printf '{"timestamp":"%s","uptimeSeconds":%s,"cpuUsePct":%s,"disk":%s,"volume":%s,"memory":%s,"containers":%s,"containerStats":%s}\n' \
  "$TS" "$UPTIME_SEC" "$CPU_PCT" "$DISK_JSON" "$VOL_JSON" "$MEM_JSON" "$DOCKER_PS" "$DOCKER_STATS" > "$OUTPUT.tmp"
mv "$OUTPUT.tmp" "$OUTPUT"
echo "Wrote $OUTPUT"

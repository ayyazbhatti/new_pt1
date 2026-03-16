#!/usr/bin/env bash
# Collect system stats (disk, memory, Docker) and write JSON to a file.
# Run from cron on the host, e.g. every 2 minutes:
#   */2 * * * * /opt/newpt/deploy/scripts/collect-system-stats.sh
# Output: deploy/stats/system-stats.json (mount this read-only into auth container).

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEPLOY_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT="${1:-$DEPLOY_DIR/stats/system-stats.json}"
mkdir -p "$(dirname "$OUTPUT")"

# Timestamp
TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Uptime (seconds)
UPTIME_SEC=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)

# Disk: root
DISK_JSON=$(df -B1 / 2>/dev/null | awk 'NR==2 {
  pct = ($2>0) ? ($3*100/$2) : 0
  printf "{\"mount\":\"%s\",\"size\":%s,\"used\":%s,\"avail\":%s,\"usePct\":%.1f}", $6, $2, $3, $4, pct
}' 2>/dev/null || echo "{}")

# Volume (if exists)
VOL_JSON="null"
for d in /mnt/HC_Volume_*; do
  [ -d "$d" ] || continue
  VOL_JSON=$(df -B1 "$d" 2>/dev/null | awk 'NR==2 {
    pct = ($2>0) ? ($3*100/$2) : 0
    printf "{\"mount\":\"%s\",\"size\":%s,\"used\":%s,\"avail\":%s,\"usePct\":%.1f}", $6, $2, $3, $4, pct
  }' 2>/dev/null)
  break
done

# Memory (MB)
MEM_JSON=$(awk '
  /MemTotal:/     { total=$2 }
  /MemAvailable:/ { avail=$2 }
  END {
    used=total-avail
    pct=(total>0) ? (used*100/total) : 0
    printf "{\"totalMb\":%d,\"usedMb\":%d,\"availMb\":%d,\"usePct\":%.1f}", total/1024, used/1024, avail/1024, pct
  }
' /proc/meminfo 2>/dev/null || echo "{}")

# Host CPU % (1-second average: sample /proc/stat, sleep 1, sample again)
CPU_PCT="null"
if [ -r /proc/stat ]; then
  _read_cpu() { grep '^cpu ' /proc/stat | awk '{used=$2+$3+$4+$6+$7+$8; idle=$5; total=used+idle; print used, idle, total }'; }
  read u1 i1 t1 <<< "$(_read_cpu)"
  sleep 1
  read u2 i2 t2 <<< "$(_read_cpu)"
  if [ -n "$t2" ] && [ "$t2" != "$t1" ] && [ "$t2" -gt "$t1" ]; then
    total_d=$((t2 - t1))
    idle_d=$((i2 - i1))
    used_d=$((total_d - idle_d))
    CPU_PCT=$(awk "BEGIN { printf \"%.1f\", ($used_d * 100) / $total_d }")
  fi
fi

# Docker containers: name, state, status (one JSON array)
DOCKER_PS=$(docker ps -a --format '{{.Names}}|{{.State}}|{{.Status}}' 2>/dev/null | while IFS='|' read -r name state status; do
  # Escape quotes in status
  status="${status//\"/\\\"}"
  printf '{"name":"%s","state":"%s","status":"%s"},' "$name" "$state" "$status"
done | sed 's/,$//')
DOCKER_PS="[${DOCKER_PS}]"

# Docker stats: name, cpuPerc, memUsage
DOCKER_STATS=$(docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}' 2>/dev/null | while IFS='|' read -r name cpu mem; do
  cpu="${cpu//\"/\\\"}"
  mem="${mem//\"/\\\"}"
  printf '{"name":"%s","cpuPerc":"%s","memUsage":"%s"},' "$name" "$cpu" "$mem"
done | sed 's/,$//')
DOCKER_STATS="[${DOCKER_STATS}]"

# Write JSON (single line for easy parsing; keys match frontend expectations)
printf '{"timestamp":"%s","uptimeSeconds":%s,"cpuUsePct":%s,"disk":%s,"volume":%s,"memory":%s,"containers":%s,"containerStats":%s}\n' \
  "$TS" "$UPTIME_SEC" "$CPU_PCT" "$DISK_JSON" "$VOL_JSON" "$MEM_JSON" "$DOCKER_PS" "$DOCKER_STATS" > "$OUTPUT.tmp"
mv "$OUTPUT.tmp" "$OUTPUT"

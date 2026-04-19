#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
USER_ID="${USER_ID:-13}"
RUNS="${RUNS:-10}"
LEDGER_DATE="${LEDGER_DATE:-$(date +%F)}"
RANGE_START="${RANGE_START:-$LEDGER_DATE}"
RANGE_END="${RANGE_END:-$LEDGER_DATE}"

ENDPOINTS=(
  "/api/tables"
  "/api/bill/unpaid"
  "/api/sessions/completed"
  "/api/sessions/all?scope=current"
  "/api/sessions/all?scope=day&date=$LEDGER_DATE"
  "/api/sessions/all?scope=range&startDate=$RANGE_START&endDate=$RANGE_END"
  "/api/dashboard-live?scope=current"
  "/api/dashboard-live?scope=day&date=$LEDGER_DATE"
  "/api/dashboard-live?scope=range&startDate=$RANGE_START&endDate=$RANGE_END"
  "/api/payment/due-report"
  "/api/payment/due-report-by-bill"
  "/api/reports/analytics?scope=current"
  "/api/reports/daily?scope=current"
  "/api/customer-insights"
)

echo "Benchmarking APIs..."
echo "BASE_URL=$BASE_URL | USER_ID=$USER_ID | RUNS=$RUNS"
echo "LEDGER_DATE=$LEDGER_DATE | RANGE_START=$RANGE_START | RANGE_END=$RANGE_END"
echo

for ep in "${ENDPOINTS[@]}"; do
  total=0
  min=999999999
  max=0

  for _ in $(seq 1 "$RUNS"); do
    t="$(curl -s -o /dev/null -w "%{time_total}" -H "x-user-id: $USER_ID" "$BASE_URL$ep")"
    ms="$(awk "BEGIN {print int($t*1000)}")"
    total=$((total + ms))
    if [ "$ms" -lt "$min" ]; then min="$ms"; fi
    if [ "$ms" -gt "$max" ]; then max="$ms"; fi
  done

  avg=$((total / RUNS))
  echo "$avg|$min|$max|$ep"
done | sort -n | awk -F'|' '{printf "%4d ms | min %4d | max %4d | %s\n", $1, $2, $3, $4}'

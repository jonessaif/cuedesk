#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
USER_ID="${USER_ID:-13}"
CONCURRENCY="${CONCURRENCY:-5}"
ROUNDS="${ROUNDS:-20}"
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

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "Concurrent API Benchmark"
echo "BASE_URL=$BASE_URL | USER_ID=$USER_ID | CONCURRENCY=$CONCURRENCY | ROUNDS=$ROUNDS"
echo "LEDGER_DATE=$LEDGER_DATE | RANGE_START=$RANGE_START | RANGE_END=$RANGE_END"
echo

calc_percentile() {
  # args: file percentile
  # percentile as integer, e.g. 50, 95, 99
  awk -v p="$2" '
    {
      values[NR] = $1
    }
    END {
      n = NR
      if (n == 0) {
        print 0
        exit
      }
      idx = int((p / 100) * n)
      if (idx < 1) idx = 1
      if (idx > n) idx = n
      print values[idx]
    }
  ' "$1"
}

for ep in "${ENDPOINTS[@]}"; do
  samples_file="$TMP_DIR/samples.txt"
  : > "$samples_file"

  for _ in $(seq 1 "$ROUNDS"); do
    pids=()
    out_files=()
    for c in $(seq 1 "$CONCURRENCY"); do
      out="$TMP_DIR/out_${c}.txt"
      out_files+=("$out")
      (
        curl -s -o /dev/null -w "%{time_total}" -H "x-user-id: $USER_ID" "$BASE_URL$ep" > "$out"
      ) &
      pids+=("$!")
    done

    for pid in "${pids[@]}"; do
      wait "$pid"
    done

    for out in "${out_files[@]}"; do
      ms="$(awk '{print int($1*1000)}' "$out")"
      echo "$ms" >> "$samples_file"
    done
  done

  sorted_file="$TMP_DIR/sorted.txt"
  sort -n "$samples_file" > "$sorted_file"

  count="$(wc -l < "$sorted_file" | tr -d ' ')"
  avg="$(awk '{sum+=$1} END { if (NR==0) print 0; else print int(sum/NR) }' "$sorted_file")"
  min="$(head -n 1 "$sorted_file")"
  max="$(tail -n 1 "$sorted_file")"
  p50="$(calc_percentile "$sorted_file" 50)"
  p95="$(calc_percentile "$sorted_file" 95)"
  p99="$(calc_percentile "$sorted_file" 99)"

  echo "$avg|$min|$max|$p50|$p95|$p99|$count|$ep"
done | sort -n | awk -F'|' '{
  printf "%4d ms avg | min %4d | p50 %4d | p95 %4d | p99 %4d | max %4d | n=%-4d | %s\n",
    $1, $2, $4, $5, $6, $3, $7, $8
}'

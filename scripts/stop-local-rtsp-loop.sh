#!/usr/bin/env bash
set -euo pipefail

STREAM_NAME="${1:-}"
MEDIA_CONTAINER="cuedesk-mediamtx"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found in PATH."
  exit 1
fi

if [[ -n "${STREAM_NAME}" ]]; then
  TARGET="cuedesk-ffmpeg-${STREAM_NAME}"
  if docker ps -a --format '{{.Names}}' | grep -qx "${TARGET}"; then
    echo "Stopping/removing publisher: ${TARGET}"
    docker rm -f "${TARGET}" >/dev/null
  else
    echo "Publisher not found: ${TARGET}"
  fi
  exit 0
fi

echo "Stopping all RTSP publishers (cuedesk-ffmpeg-*)..."
PUBLISHERS="$(docker ps -a --format '{{.Names}}' | grep '^cuedesk-ffmpeg-' || true)"
if [[ -n "${PUBLISHERS}" ]]; then
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    docker rm -f "$name" >/dev/null
    echo "Removed $name"
  done <<< "${PUBLISHERS}"
else
  echo "No publisher containers found."
fi

if docker ps -a --format '{{.Names}}' | grep -qx "${MEDIA_CONTAINER}"; then
  echo "Stopping mediamtx: ${MEDIA_CONTAINER}"
  docker rm -f "${MEDIA_CONTAINER}" >/dev/null
else
  echo "mediamtx container not found."
fi

echo "Done."

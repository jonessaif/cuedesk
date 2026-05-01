#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <video-file-path> [stream-name]"
  echo "Example: $0 ./sample.mp4 table-cam-1"
  exit 1
fi

VIDEO_INPUT="$1"
STREAM_NAME="${2:-testcam}"

if [[ ! -f "$VIDEO_INPUT" ]]; then
  echo "Video file not found: $VIDEO_INPUT"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required but was not found in PATH."
  exit 1
fi

ABS_VIDEO_PATH="$(cd "$(dirname "$VIDEO_INPUT")" && pwd)/$(basename "$VIDEO_INPUT")"
NETWORK_NAME="cuedesk-rtsp-net"
MEDIA_CONTAINER="cuedesk-mediamtx"
PUBLISHER_CONTAINER="cuedesk-ffmpeg-${STREAM_NAME}"

echo "Creating docker network (if missing): ${NETWORK_NAME}"
docker network create "${NETWORK_NAME}" >/dev/null 2>&1 || true

if ! docker ps --format '{{.Names}}' | grep -qx "${MEDIA_CONTAINER}"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "${MEDIA_CONTAINER}"; then
    echo "Starting existing mediamtx container: ${MEDIA_CONTAINER}"
    docker start "${MEDIA_CONTAINER}" >/dev/null
  else
    echo "Starting mediamtx container: ${MEDIA_CONTAINER}"
    docker run -d \
      --name "${MEDIA_CONTAINER}" \
      --network "${NETWORK_NAME}" \
      -p 8554:8554 \
      -p 8888:8888 \
      bluenviron/mediamtx:latest >/dev/null
  fi
else
  echo "mediamtx already running: ${MEDIA_CONTAINER}"
fi

if docker ps -a --format '{{.Names}}' | grep -qx "${PUBLISHER_CONTAINER}"; then
  echo "Removing existing publisher container: ${PUBLISHER_CONTAINER}"
  docker rm -f "${PUBLISHER_CONTAINER}" >/dev/null
fi

echo "Starting ffmpeg publisher: ${PUBLISHER_CONTAINER}"
docker run -d \
  --name "${PUBLISHER_CONTAINER}" \
  --restart unless-stopped \
  --network "${NETWORK_NAME}" \
  -v "${ABS_VIDEO_PATH}:/input-video:ro" \
  jrottenberg/ffmpeg:6.0-alpine \
  -re \
  -stream_loop -1 \
  -i /input-video \
  -c copy \
  -f rtsp \
  -rtsp_transport tcp \
  "rtsp://${MEDIA_CONTAINER}:8554/${STREAM_NAME}" >/dev/null

echo
echo "RTSP stream is ready."
echo "URL (for CueDesk camera config): rtsp://127.0.0.1:8554/${STREAM_NAME}"
echo
echo "Quick verify:"
echo "  ffplay -rtsp_transport tcp \"rtsp://127.0.0.1:8554/${STREAM_NAME}\""
echo
echo "Container logs:"
echo "  docker logs -f ${PUBLISHER_CONTAINER}"

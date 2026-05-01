# Local RTSP Stream (Looped Video)

Use this when you want a stable local test camera feed for CueDesk.

## What this setup does

- Runs an RTSP server (`mediamtx`) in Docker.
- Publishes your local video file in an infinite loop via `ffmpeg`.
- Gives you an RTSP URL you can use in the Camera page.

## Start a looped RTSP stream

```bash
bash scripts/start-local-rtsp-loop.sh <video-file-path> [stream-name]
```

Examples:

```bash
bash scripts/start-local-rtsp-loop.sh ./sample.mp4
bash scripts/start-local-rtsp-loop.sh ./sample.mp4 table-cam-1
```

Output URL format:

```text
rtsp://127.0.0.1:8554/<stream-name>
```

Default stream name: `testcam`

## Verify stream

```bash
ffplay -rtsp_transport tcp "rtsp://127.0.0.1:8554/testcam"
```

## Use in CueDesk

On `/management/cameras`, add camera URL like:

```text
rtsp://127.0.0.1:8554/testcam
```

## Stop streams

Stop one stream publisher:

```bash
bash scripts/stop-local-rtsp-loop.sh testcam
```

Stop all publishers and RTSP server:

```bash
bash scripts/stop-local-rtsp-loop.sh
```

## Notes

- Requires Docker.
- For remote devices, replace `127.0.0.1` with your machine IP.
- Snapshot preview in the current UI needs an HTTP image URL; RTSP is for worker-side/live stream consumers.

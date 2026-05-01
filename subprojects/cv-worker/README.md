# CueDesk CV Worker (OpenCV)

This is the Python OpenCV worker that:

1. Reads exported camera config (`dist/cv-worker-config.json`)
2. Connects to camera streams
3. Detects motion/activity inside configured ROI points
4. Sends `start` / `end` events to CueDesk backend (`/api/vision/events`)

## ROI Contract

The worker expects a standard ROI shape from backend config:

- `roi.points`: exactly 4 points `[[x, y], ...]`
- `roi.bbox`: `{ x, y, width, height }`
- `roi.coordinateSpace`: `"pixels"`
- optional `roi.sourceResolution`: `{ width, height }` from UI snapshot/probe frame used to draw ROI

No rectangle/quadrilateral branching is needed in worker code.

## Setup

```bash
cd subprojects/cv-worker
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python -m cv_worker.worker \
  --config ../../dist/cv-worker-config.json \
  --backend-url http://localhost:3000 \
  --poll-interval-ms 200
```

Optional:

- `--cv-token <token>`: sets `x-cv-token` header when posting events
- `--start-threshold 0.04`: peak motion ratio threshold for active window
- `--stop-threshold 0.02`: per-frame motion ratio counted as activity hit
- `--eval-interval-min-seconds 15`: minimum evaluation window
- `--eval-interval-max-seconds 30`: maximum evaluation window
- `--end-idle-seconds 120`: emit `end` only after this much idle time since last detected activity
- `--min-running-hold-seconds 180`: running state must be held this long before `end` is allowed
- `--post-start-end-cooldown-seconds 90`: blocks `end` immediately after `start`
- `--post-end-start-cooldown-seconds 60`: blocks immediate `start` after `end`
- `--detector-mode session|light|ball|table|both`: run session detector, dedicated light detector, ball-motion detector, table-event detector, or both(session+light)
- `--light-confirm-seconds 2`: require consistent evidence over this many seconds before light state flips
- `--ball-idle-seconds 8`: emit `ball_motion_end` after this many seconds without ball motion evidence
- `--frame-setup-idle-seconds 20`: emit `frame_setup_start` after quiet period since light-on or last shot end
- `--session-idle-seconds 900`: emit `session_end` after long quiet period while light remains on
- `--shot-min-active-seconds 0.25`: minimum shot duration before finalized `shot` event is emitted
- `--shot-min-peak-motion-ratio 0.0012`: minimum peak motion ratio for finalized `shot` event
- `--shot-min-peak-candidate-count 1`: minimum moving-ball candidate count for finalized `shot` event
- `--enable-object-evidence`: enable YOLO-based person/cue/ball evidence in table detector
- `--require-object-evidence-for-shot`: require person+cue+ball evidence for finalized `shot` event
- `--object-model-path`: optional YOLO model path/name (default: `yolov8n.pt`)
- `--object-confidence 0.25`: confidence threshold for object detections
- `--cue-ball-near-px 48`: cue-to-ball center distance threshold for cue-hit evidence
- `--table-idle-eval-seconds 60`: in table mode, evaluate once per minute when table is not running
- `--table-running-eval-seconds 3`: in table mode, evaluate every few seconds when table is running
- `--light-bootstrap-off-table-names S1,Table-2`: optional calibration hint for first frame; these table names are treated as OFF exemplars
- `--disable-light-bootstrap`: skip first-frame heuristic bootstrap for light detector
- `--freeze-light-thresholds`: keep runtime ON/OFF level anchors fixed (default: enabled)
- `--allow-light-threshold-updates`: allow small adaptive runtime level updates
- `--stdout-only`: print events only, skip POST to backend
- `--debug-all-loops`: print per-loop diagnostic rows for each table mapping
- `--debug-log-file ../../dist/cv-worker-debug.jsonl`: append debug/event logs as JSONL
- `--append-debug-log`: append log file (default behavior is overwrite per run)
- `--light-memory-file ../../dist/cv-light-memory.json`: used by session detector light-gate memory; light-only detector now runs heuristic/runtime-only
- `--event-snapshot-dir ../../dist/cv-event-snapshots`: save one JPEG frame for each emitted event
- `--startup-roi-snapshot-dir ../../dist/cv-startup-roi-snapshots`: save one startup overlay + ROI crops per camera
- `--keep-snapshot-dirs`: keep existing snapshot files (default behavior is clear dirs on startup)
- `--roi-calibration-file ../../dist/cv-roi-calibration.json`: optional per-camera ROI scale/offset correction if slight drift remains
- `--max-loops 200`: stop automatically after fixed number of loops

Detection strategy:

- Each window first checks table-presence (cloth-like dominant uniform region) in ROI.
- Worker continuously samples motion inside ROI.
- For each mapping, it evaluates activity in periodic windows (default 15-30s).
- If currently free and window is active, emits `start`.
- If currently running, `end` requires all of:
  - inactive window
  - idle >= `end-idle-seconds`
  - running duration >= `min-running-hold-seconds`
  - outside post-start end cooldown
- `pool` uses a stricter profile than `snooker` and requires consecutive active windows before `start` to reduce false positives.

If table-presence fails (for example light off or table covered), that window is treated as inactive.

Initial light bootstrap (heuristic, runtime-only):

- On first processed frame per camera, light detector bootstraps same-camera light priors from current frame.
- Dimmest table ROI is treated as OFF exemplar; remaining tables are treated as ON exemplars.
- These priors are not persisted by light detector and are re-evaluated each run.

Timestamp behavior:

- Worker sends `eventAt` in every event.
- For `end`, `eventAt` is the **last active timestamp** (not detection time).

Example dry verification (stdout only):

```bash
python -m cv_worker.worker \
  --config ../../dist/cv-worker-config.json \
  --backend-url http://localhost:3000 \
  --eval-interval-min-seconds 5 \
  --eval-interval-max-seconds 5 \
  --stdout-only \
  --max-loops 400
```

Stdout event logs include both `tableId` and `tableName` (when available from config export).
Debug/event logs also include monotonic stream timeline fields:
- `cameraFrameIndex`
- `streamEpoch` (increments when stream reconnects)
- `streamTimeMs` (decoder-reported position when available)

Light detector mode:

- Emits `light_on` and `light_off` events per table mapping.
- Uses ROI brightness, adaptive ON/OFF baseline memory, and vote-based hysteresis.
- Bootstrap on first camera frame: dimmest table is treated as OFF exemplar; other tables as ON exemplars.
- If one table is missing ON/OFF baseline, same-camera table references are used to seed it.

Ball detector mode (MVP):

- Emits `ball_motion_start` and `ball_motion_end` events per table mapping.
- Uses frame-to-frame ROI motion with small circular blob filtering (good for early tuning).
- Designed for stdout/debug tuning before final scoring pipeline integration.

Table-event detector mode (MVP state machine):

- Emits higher-level events: `light_on`, `light_off`, `shot_start`, `shot_end`, `shot`, `frame_setup_start`, `frame_setup_end`, `break_start`, `break_end`, `session_start`, `session_end`.
- Uses light detector + ball motion detector as low-level signals.
- `shot_end` is aligned to ball-motion stop.
- Finalized `shot` event includes: `shotStartAt`, `shotEndAt`, `durationSeconds`, `lightOn`, and peak evidence fields.
- Optional object evidence adds `personCount`, `cueCount`, `ballCount`, `cueNearBall`, `objectConfidence`.
- Table mode uses adaptive scheduling: slower checks when idle, faster checks when running.
- `break_start` is first shot after `frame_setup_start`.
- `session_end` can happen on `light_off` or long idle timeout.

Object evidence dependencies (optional):

- Install `ultralytics` only if you want YOLO-backed evidence:
  - `pip install ultralytics`

Output behavior (testing-friendly defaults):

- Events are always printed to stdout.
- If `--debug-log-file` is set, event/debug lines are written to JSONL.
- By default, debug log is overwritten each run (use `--append-debug-log` to append).
- By default, snapshot directories are cleared on startup (use `--keep-snapshot-dirs` to keep old files).
- Session and light events both include per-event `snapshotPath` when `--event-snapshot-dir` is configured.

## Scenario Evaluation

As you test with multiple videos, you can validate expected outcomes from the debug log automatically.

Example:

```bash
python tools/evaluate_debug_log.py \
  --log ../../dist/cv-worker-debug.jsonl \
  --expectations tests/scenario-expectations.example.json
```

You can run a single scenario:

```bash
python tools/evaluate_debug_log.py \
  --log ../../dist/cv-worker-debug.jsonl \
  --expectations tests/scenario-expectations.example.json \
  --scenario snooker_active_pool_idle
```

Expectation format supports:
- `loopStart` / `loopEnd`: scope checks to part of a run
- `mustContain`: required events with optional `minCount`, `maxCount`, `exactCount`, `minFirstLoop`, `maxFirstLoop`
- `mustNotContain`: events that must never appear

## Test

```bash
python -m unittest discover -s tests -p "test_*.py" -v
```

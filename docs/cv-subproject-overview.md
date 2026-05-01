# CV Implementation (Fresh Start)

This project has been reset to a single CV integration path.

## What was removed

- Legacy TypeScript CV engine scaffold under `src/cv`
- Legacy Python subproject under `subprojects/cv-session-validator`

The app now uses backend-first camera configuration and event ingestion contracts for a separate CV worker process.

## Current architecture

1. CueDesk backend stores camera and mapping configuration in DB.
2. Backend can export CV worker config JSON (and optionally write it to local file).
3. External CV worker reads that config, runs detection, sends events to CueDesk backend.
4. CueDesk backend stores raw events and handles domain logic (smoothing, session transitions, etc.).

## New database models

Defined in `prisma/schema.prisma`:

- `Camera`
  - camera identity, RTSP/HTTP URL, enable flag, health status, check timestamps
- `CameraTableMapping`
  - camera/table assignment, detection type, ROI (`kind`: `rectangle` or `quadrilateral`)
  - rectangle ROI: `x`, `y`, `width`, `height`, `angle`, `tiltX`, `tiltY`
  - quadrilateral ROI: `quadrilateral` array of 4 points (`x`,`y`) and fallback bounds/orientation fields
- `VisionEventRaw`
  - raw incoming CV events before business-domain processing

New enums:

- `CameraStatus`: `online | offline | unknown`
- `DetectionType`: `snooker | pool | playstation | other`
- `VisionEventType`: `start | end`

## New backend services

- `src/lib/services/cv-config-service.ts`
  - camera CRUD
  - mapping CRUD
  - camera probe (`ffprobe` for RTSP validity + online/offline status update)
  - backend snapshot capture (`ffmpeg`) for selected camera
  - worker config export (standardized OpenCV-friendly ROI format)
  - optional local file write (`dist/cv-worker-config.json`)

- `src/lib/services/vision-event-service.ts`
  - validates and ingests worker events into `VisionEventRaw`
  - validates table/camera/mapping relationships

## New API routes

- `GET/POST /api/cameras`
- `PATCH/DELETE /api/cameras/[id]`
- `POST /api/cameras/[id]/probe`
- `GET /api/cameras/[id]/snapshot` (`?refresh=1` to capture a fresh frame from camera URL)
- `GET/POST /api/camera-mappings`
- `PATCH/DELETE /api/camera-mappings/[id]`
- `GET /api/cv/config` (`?write=1` to persist local file)
- `POST /api/vision/events`
  - optional token gate via `CV_WORKER_TOKEN` + `x-cv-token` header
  - use `tableId` only for table linkage; do not send `sectionName` (section is derived from table data in backend)

## Worker ROI Format

Worker config now exports a single ROI shape format for all UI modes:

- `roi.points`: exactly 4 ordered points `[[x, y], ...]`
- `roi.bbox`: `{ x, y, width, height }`
- `roi.coordinateSpace`: `"pixels"`
- each mapping also includes `tableId` and `tableName`

This means CV code does not need to branch for rectangle vs quadrilateral input.

## New UI surface

- `src/app/management/cameras/page.tsx`
  - add camera
  - edit/delete/enable-disable camera
  - probe camera status
  - fetch snapshot from backend (no manual snapshot URL input)
  - assign camera -> table with detection type
  - edit/delete mapping
  - show snapshot only for the currently selected camera in mapping dropdown
  - draw ROI with mouse (draw, move, resize with corner handle)
  - rotate ROI in 3 axes: `Rotation Z` + `Tilt X` + `Tilt Y`
  - quadrilateral mode: click 4 points on snapshot and overlay auto-connects them
  - ROI numeric values are shown as read-only feedback

## OpenCV Worker Subproject

Path: `subprojects/cv-worker`

What it includes:

- `cv_worker/config.py`: strict parser for `dist/cv-worker-config.json`
- `cv_worker/roi.py`: ROI polygon mask helpers
- `cv_worker/detector.py`: motion-based start/end detector using ROI points
- `cv_worker/event_client.py`: POST events to `/api/vision/events`
- `cv_worker/worker.py`: runtime loop over cameras/mappings
- `tests/test_config.py` and `tests/test_detector.py`

## Test coverage added

- `src/tests/cv-config-service.test.ts`
- `src/tests/vision-event-service.test.ts`
- `src/tests/camera-routes.test.ts`
- `src/tests/vision-events-route.test.ts`

## Next implementation steps

1. Run Prisma migration and generate client.
2. Hook camera page into management navigation if needed.
3. Build a proper ROI draw tool (drag rectangle on snapshot/canvas).
4. Add backend event orchestration (smoothing and session logic) on top of raw events.

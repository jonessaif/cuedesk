from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any

try:
    import cv2
except ModuleNotFoundError:  # pragma: no cover - runtime dependency in worker env
    cv2 = None
try:
    import numpy as np
    _HAS_NUMPY = True
except ModuleNotFoundError:  # pragma: no cover - runtime dependency in worker env
    _HAS_NUMPY = False
    np = Any  # type: ignore[assignment]

from .config import CameraConfig, MappingConfig


@dataclass
class _BallState:
    mask_shape: tuple[int, int] | None = None
    mask: np.ndarray | None = None
    roi_space: tuple[int, int] | None = None
    prev_gray_masked: np.ndarray | None = None
    running: bool = False
    active_streak: int = 0
    inactive_streak: int = 0
    last_active_at: datetime | None = None
    last_event_at: datetime | None = None


@dataclass(frozen=True)
class BallEvent:
    camera_id: int
    table_id: int
    table_name: str | None
    detection_type: str
    event: str
    event_at: datetime
    confidence: float
    motion_ratio: float
    candidate_count: int


@dataclass(frozen=True)
class BallDebug:
    camera_id: int
    table_id: int
    table_name: str | None
    detection_type: str
    running: bool
    active_now: bool
    motion_ratio: float
    candidate_count: int
    active_streak: int
    inactive_streak: int
    idle_seconds: float | None


class BallDetector:
    def __init__(
        self,
        *,
        idle_seconds: float = 8.0,
        min_event_interval_seconds: float = 2.0,
    ) -> None:
        self._states: dict[tuple[int, int], _BallState] = {}
        self._camera_roi_space: dict[int, tuple[int, int] | None] = {}
        self._idle_seconds = max(0.01, idle_seconds)
        self._min_event_interval_seconds = max(0.0, min_event_interval_seconds)

    def _get_mask(self, camera_id: int, mapping: MappingConfig, frame_shape: tuple[int, int]) -> np.ndarray:
        from .roi import infer_roi_space_from_points, polygon_mask, project_roi_points_to_frame

        key = (camera_id, mapping.id)
        state = self._states.setdefault(key, _BallState())
        if state.mask is None or state.mask_shape != frame_shape:
            if state.roi_space is None:
                state.roi_space = mapping.roi_space
            if state.roi_space is None:
                state.roi_space = self._camera_roi_space.get(camera_id)
            if state.roi_space is None:
                state.roi_space = infer_roi_space_from_points(mapping.roi_points)
            roi = project_roi_points_to_frame(mapping.roi_points, frame_shape, state.roi_space)
            state.mask = polygon_mask(frame_shape, roi)
            state.mask_shape = frame_shape
        return state.mask

    @staticmethod
    def _candidate_count(delta_masked: np.ndarray, roi_mask: np.ndarray, roi_pixels: int) -> tuple[int, float]:
        if cv2 is None:
            return 0, 0.0
        _, thresh = cv2.threshold(delta_masked, 18, 255, cv2.THRESH_BINARY)
        thresh = cv2.bitwise_and(thresh, roi_mask)
        kernel = np.ones((3, 3), dtype=np.uint8)
        thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel)
        moving_pixels = int(cv2.countNonZero(thresh))
        motion_ratio = (float(moving_pixels) / float(max(1, roi_pixels)))

        contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = max(6.0, roi_pixels * 0.00002)
        max_area = max(1500.0, roi_pixels * 0.012)
        count = 0
        for contour in contours:
            area = float(cv2.contourArea(contour))
            if area < min_area or area > max_area:
                continue
            perimeter = float(cv2.arcLength(contour, True))
            if perimeter <= 0.0:
                continue
            circularity = float((4.0 * math.pi * area) / max(1.0, perimeter * perimeter))
            if circularity < 0.2:
                continue
            (_, _), radius = cv2.minEnclosingCircle(contour)
            if radius < 1.2 or radius > 18.0:
                continue
            count += 1
        return count, motion_ratio

    def process_frame(self, camera: CameraConfig, frame: np.ndarray) -> tuple[list[BallEvent], list[BallDebug]]:
        if cv2 is None or not _HAS_NUMPY:
            raise RuntimeError("opencv-python and numpy are required to process frames")
        from .roi import infer_roi_space_from_points

        now = datetime.now(timezone.utc)
        if camera.id not in self._camera_roi_space:
            declared = [mapping.roi_space for mapping in camera.mappings if mapping.enabled and mapping.roi_space is not None]
            if declared:
                self._camera_roi_space[camera.id] = declared[0]
            else:
                points: list[tuple[float, float]] = []
                for mapping in camera.mappings:
                    if mapping.enabled:
                        points.extend(mapping.roi_points)
                self._camera_roi_space[camera.id] = infer_roi_space_from_points(points)

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)

        events: list[BallEvent] = []
        debug_rows: list[BallDebug] = []
        for mapping in camera.mappings:
            if not mapping.enabled:
                continue
            key = (camera.id, mapping.id)
            state = self._states.setdefault(key, _BallState())
            mask = self._get_mask(camera.id, mapping, frame.shape[:2])
            roi_pixels = int(cv2.countNonZero(mask))
            if roi_pixels <= 0:
                continue

            gray_masked = cv2.bitwise_and(gray, gray, mask=mask)
            candidate_count = 0
            motion_ratio = 0.0
            active_now = False
            if state.prev_gray_masked is not None:
                delta = cv2.absdiff(gray_masked, state.prev_gray_masked)
                candidate_count, motion_ratio = self._candidate_count(delta, mask, roi_pixels)
                active_now = candidate_count > 0 and motion_ratio >= 0.0008
            state.prev_gray_masked = gray_masked

            previous_running = state.running
            if active_now:
                state.active_streak += 1
                state.inactive_streak = 0
                state.last_active_at = now
            else:
                state.active_streak = 0
                state.inactive_streak += 1

            idle_seconds = None
            if state.last_active_at is not None:
                idle_seconds = max(0.0, (now - state.last_active_at).total_seconds())

            if not state.running and state.active_streak >= 2:
                state.running = True
            elif state.running and idle_seconds is not None and idle_seconds >= self._idle_seconds:
                state.running = False

            if previous_running != state.running:
                if state.last_event_at is None or (now - state.last_event_at).total_seconds() >= self._min_event_interval_seconds:
                    state.last_event_at = now
                    confidence = min(1.0, 0.2 + (motion_ratio / 0.01) + (candidate_count * 0.15))
                    events.append(
                        BallEvent(
                            camera_id=camera.id,
                            table_id=mapping.table_id,
                            table_name=mapping.table_name,
                            detection_type=mapping.detection_type,
                            event="ball_motion_start" if state.running else "ball_motion_end",
                            event_at=now,
                            confidence=confidence,
                            motion_ratio=motion_ratio,
                            candidate_count=candidate_count,
                        )
                    )

            debug_rows.append(
                BallDebug(
                    camera_id=camera.id,
                    table_id=mapping.table_id,
                    table_name=mapping.table_name,
                    detection_type=mapping.detection_type,
                    running=state.running,
                    active_now=active_now,
                    motion_ratio=motion_ratio,
                    candidate_count=candidate_count,
                    active_streak=state.active_streak,
                    inactive_streak=state.inactive_streak,
                    idle_seconds=idle_seconds,
                )
            )

        return events, debug_rows

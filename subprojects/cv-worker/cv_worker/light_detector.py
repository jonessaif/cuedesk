from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
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
class _LightState:
    mask_shape: tuple[int, int] | None = None
    mask: np.ndarray | None = None
    roi_space: tuple[int, int] | None = None
    light_on_level: float | None = None
    light_off_level: float | None = None
    light_on_state: bool | None = None
    light_on_votes: int = 0
    light_off_votes: int = 0
    on_candidate_since: datetime | None = None
    off_candidate_since: datetime | None = None
    last_event_at: datetime | None = None
    initial_emitted: bool = False
    recent_levels: deque[float] = field(default_factory=lambda: deque(maxlen=240))


@dataclass(frozen=True)
class LightEvent:
    camera_id: int
    table_id: int
    table_name: str | None
    detection_type: str
    event: str
    event_at: datetime
    confidence: float
    brightness: float
    threshold: float
    off_avg: float
    on_avg: float


class LightDetector:
    def __init__(
        self,
        *,
        light_memory_path: str | None = None,  # kept for backward compatibility, intentionally unused
        min_event_interval_seconds: float = 15.0,
        min_state_confirm_seconds: float = 2.0,
        bootstrap_off_table_names: set[str] | None = None,
        enable_bootstrap: bool = True,
        update_levels: bool = False,
    ) -> None:
        self._states: dict[tuple[int, int], _LightState] = {}
        self._camera_roi_space: dict[int, tuple[int, int] | None] = {}
        self._bootstrap_done_cameras: set[int] = set()
        self._min_event_interval_seconds = max(0.0, min_event_interval_seconds)
        self._min_state_confirm_seconds = max(0.0, min_state_confirm_seconds)
        self._bootstrap_off_table_names = {name.strip().lower() for name in (bootstrap_off_table_names or set()) if name.strip()}
        self._enable_bootstrap = enable_bootstrap
        self._update_levels = update_levels
        # Runtime-only cache for heuristic bootstrap values (no disk persistence).
        self._light_memory: dict[str, dict[str, float | bool]] = {}

    def flush_light_memory(self) -> None:
        # Memory persistence intentionally removed; heuristics are runtime-only.
        return

    def _mapping_key(self, camera_id: int, mapping_id: int) -> str:
        return f"{camera_id}:{mapping_id}"

    @staticmethod
    def _median(values: list[float]) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        mid = len(ordered) // 2
        if len(ordered) % 2 == 1:
            return float(ordered[mid])
        return float((ordered[mid - 1] + ordered[mid]) / 2.0)

    @staticmethod
    def _as_number(raw: Any) -> float | None:
        if isinstance(raw, (int, float)):
            return float(raw)
        return None

    def _load_state_from_bootstrap(self, camera_id: int, mapping_id: int, state: _LightState) -> None:
        model = self._light_memory.get(self._mapping_key(camera_id, mapping_id), {})
        state.light_on_level = self._as_number(model.get("onLevel"))
        state.light_off_level = self._as_number(model.get("offLevel"))
        if isinstance(model.get("lightOnState"), bool):
            state.light_on_state = bool(model["lightOnState"])

    def _bootstrap_camera_light(
        self,
        camera_id: int,
        brightness_by_mapping: dict[int, float],
        *,
        forced_off_mapping_ids: set[int] | None = None,
    ) -> None:
        if len(brightness_by_mapping) < 2:
            return
        forced_off_mapping_ids = forced_off_mapping_ids or set()
        rows = sorted(brightness_by_mapping.items(), key=lambda item: item[1])

        inferred_off_ids: set[int] = set()
        best_split = 1
        best_gap = -1.0
        for split in range(1, len(rows)):
            low = [value for _, value in rows[:split]]
            high = [value for _, value in rows[split:]]
            if not low or not high:
                continue
            gap = self._median(high) - self._median(low)
            if gap > best_gap:
                best_gap = gap
                best_split = split
        if best_gap >= 6.0:
            inferred_off_ids = {mapping_id for mapping_id, _ in rows[:best_split]}
        else:
            inferred_off_ids = {rows[0][0]}

        off_ids = set(inferred_off_ids)
        off_ids.update(forced_off_mapping_ids)
        if len(off_ids) >= len(rows):
            off_ids = {rows[0][0]}

        off_values = [value for mapping_id, value in brightness_by_mapping.items() if mapping_id in off_ids]
        on_values = [value for mapping_id, value in brightness_by_mapping.items() if mapping_id not in off_ids]
        if not off_values or not on_values:
            return
        off_ref = self._median(off_values)
        on_ref = self._median(on_values)
        if on_ref <= off_ref + 4.0:
            on_ref = off_ref + 8.0
        midpoint = (on_ref + off_ref) / 2.0

        for mapping_id, brightness in brightness_by_mapping.items():
            is_off = mapping_id in off_ids
            seeded_off = brightness if is_off else off_ref
            seeded_on = on_ref if is_off else max(on_ref, brightness)
            if seeded_on < seeded_off + 12.0:
                seeded_on = seeded_off + 12.0
            self._light_memory[self._mapping_key(camera_id, mapping_id)] = {
                "offLevel": float(seeded_off),
                "onLevel": float(seeded_on),
                "lightOnState": bool(brightness >= midpoint),
            }

    def _table_cloth_mask(self, hsv_frame: np.ndarray, roi_mask: np.ndarray) -> np.ndarray:
        if cv2 is None:
            return roi_mask
        roi_pixels = hsv_frame[roi_mask > 0]
        empty = np.zeros_like(roi_mask)
        if roi_pixels.size == 0:
            return empty
        valid = roi_pixels[(roi_pixels[:, 1] > 30) & (roi_pixels[:, 2] > 35)]
        if len(valid) < 250:
            return empty
        hue = valid[:, 0]
        hist = np.bincount((hue // 10).astype(np.int32), minlength=18)
        if hist.sum() <= 0:
            return empty
        if float(hist.max()) / float(hist.sum()) < 0.18:
            return empty
        dominant_bin = int(np.argmax(hist))
        dominant_hue = dominant_bin * 10 + 5
        hue_diff = np.abs(hsv_frame[:, :, 0].astype(np.int16) - dominant_hue)
        hue_diff = np.minimum(hue_diff, 180 - hue_diff)
        cloth_pixels = (
            (roi_mask > 0)
            & (hsv_frame[:, :, 1] > 30)
            & (hsv_frame[:, :, 2] > 35)
            & (hue_diff <= 14)
        )
        cloth = np.zeros_like(roi_mask)
        cloth[cloth_pixels] = 255
        kernel = np.ones((5, 5), dtype=np.uint8)
        cloth = cv2.morphologyEx(cloth, cv2.MORPH_OPEN, kernel)
        cloth = cv2.morphologyEx(cloth, cv2.MORPH_CLOSE, kernel)
        return cloth

    def _brightness(self, hsv_frame: np.ndarray, mask: np.ndarray) -> float:
        cloth_mask = self._table_cloth_mask(hsv_frame, mask)
        cloth_values = hsv_frame[:, :, 2][cloth_mask > 0]
        if cloth_values.size >= 200:
            return float(np.percentile(cloth_values, 75))
        roi_values = hsv_frame[:, :, 2][mask > 0]
        if roi_values.size == 0:
            return 0.0
        return float(np.percentile(roi_values, 70))

    def _derive_threshold(self, state: _LightState) -> tuple[float, float, float]:
        if state.light_off_level is None:
            state.light_off_level = 60.0
        if state.light_on_level is None:
            state.light_on_level = max(230.0, state.light_off_level + 60.0)

        history = list(state.recent_levels)
        if len(history) >= 15:
            off_hist = float(np.percentile(history, 22))
            on_hist = float(np.percentile(history, 78))
            off_avg = 0.7 * state.light_off_level + 0.3 * off_hist
            on_avg = 0.7 * state.light_on_level + 0.3 * on_hist
        else:
            off_avg = state.light_off_level
            on_avg = state.light_on_level

        # Bias ON anchor high so ON is treated as truly bright in this setup.
        on_avg = max(230.0, on_avg)
        if on_avg < off_avg:
            on_avg, off_avg = off_avg, on_avg
        if (on_avg - off_avg) < 20.0:
            center = (on_avg + off_avg) / 2.0
            on_avg = center + 10.0
            off_avg = center - 10.0
        threshold = (on_avg + off_avg) / 2.0
        threshold = max(230.0, threshold)
        return threshold, off_avg, on_avg

    @staticmethod
    def _slow_update_level(current: float | None, observed: float) -> float:
        if current is None:
            return observed
        alpha = 0.01
        max_step = 0.5
        target = (1.0 - alpha) * current + alpha * observed
        delta = max(-max_step, min(max_step, target - current))
        return current + delta

    def _get_mask(self, camera_id: int, mapping: MappingConfig, frame_shape: tuple[int, int]) -> np.ndarray:
        from .roi import infer_roi_space_from_points, polygon_mask, project_roi_points_to_frame

        key = (camera_id, mapping.id)
        state = self._states.setdefault(key, _LightState())
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

    def _process_mapping(
        self,
        *,
        camera_id: int,
        mapping: MappingConfig,
        brightness: float,
        now: datetime,
    ) -> LightEvent | None:
        key = (camera_id, mapping.id)
        state = self._states.setdefault(key, _LightState())
        if state.light_on_state is None and state.light_on_level is None and state.light_off_level is None:
            self._load_state_from_bootstrap(camera_id, mapping.id, state)

        state.recent_levels.append(brightness)
        threshold, off_avg, on_avg = self._derive_threshold(state)
        if state.light_on_state is None:
            state.light_on_state = brightness >= threshold
            state.light_on_votes = 0
            state.light_off_votes = 0

        previous_state = bool(state.light_on_state)
        gap = max(0.0, on_avg - off_avg)
        on_margin = min(20.0, max(12.0, gap * 0.24))
        # OFF must have stronger evidence so near-threshold brightness does not flip state.
        off_margin = max(12.0, gap * 0.12)
        if previous_state:
            if brightness < (threshold - off_margin):
                if state.off_candidate_since is None:
                    state.off_candidate_since = now
                state.light_off_votes += 1
                state.light_on_votes = 0
                state.on_candidate_since = None
            else:
                state.light_off_votes = 0
                state.off_candidate_since = None
            off_confirmed = (
                state.off_candidate_since is not None
                and (now - state.off_candidate_since).total_seconds() >= self._min_state_confirm_seconds
            )
            if state.light_off_votes >= 3 and off_confirmed:
                state.light_on_state = False
                state.light_off_votes = 0
                state.off_candidate_since = None
        else:
            if brightness > (threshold + on_margin):
                if state.on_candidate_since is None:
                    state.on_candidate_since = now
                state.light_on_votes += 1
                state.light_off_votes = 0
                state.off_candidate_since = None
            else:
                state.light_on_votes = 0
                state.on_candidate_since = None
            on_confirmed = (
                state.on_candidate_since is not None
                and (now - state.on_candidate_since).total_seconds() >= self._min_state_confirm_seconds
            )
            if state.light_on_votes >= 3 and on_confirmed:
                state.light_on_state = True
                state.light_on_votes = 0
                state.on_candidate_since = None

        new_state = bool(state.light_on_state)
        if self._update_levels:
            if new_state:
                state.light_on_level = self._slow_update_level(state.light_on_level, brightness)
            else:
                state.light_off_level = self._slow_update_level(state.light_off_level, brightness)

        threshold, off_avg, on_avg = self._derive_threshold(state)
        confidence = min(1.0, abs(brightness - threshold) / max(1.0, abs(on_avg - off_avg), 8.0))

        if previous_state != new_state:
            if new_state and brightness < threshold:
                state.light_on_state = previous_state
                state.light_on_votes = 0
                state.light_off_votes = 0
                return None
            if (not new_state) and brightness > threshold:
                state.light_on_state = previous_state
                state.light_on_votes = 0
                state.light_off_votes = 0
                return None

        if not state.initial_emitted:
            # Initial event must reflect current frame evidence, not bootstrap seed state.
            new_state = brightness >= threshold
            state.light_on_state = new_state
            state.initial_emitted = True
            state.last_event_at = now
            return LightEvent(
                camera_id=camera_id,
                table_id=mapping.table_id,
                table_name=mapping.table_name,
                detection_type=mapping.detection_type,
                event="light_on" if new_state else "light_off",
                event_at=now,
                confidence=confidence,
                brightness=brightness,
                threshold=threshold,
                off_avg=off_avg,
                on_avg=on_avg,
            )

        if previous_state == new_state:
            return None
        if state.last_event_at is not None and (now - state.last_event_at).total_seconds() < self._min_event_interval_seconds:
            return None
        state.last_event_at = now
        return LightEvent(
            camera_id=camera_id,
            table_id=mapping.table_id,
            table_name=mapping.table_name,
            detection_type=mapping.detection_type,
            event="light_on" if new_state else "light_off",
            event_at=now,
            confidence=confidence,
            brightness=brightness,
            threshold=threshold,
            off_avg=off_avg,
            on_avg=on_avg,
        )

    def process_frame(self, camera: CameraConfig, frame: np.ndarray) -> list[LightEvent]:
        if cv2 is None or not _HAS_NUMPY:
            raise RuntimeError("opencv-python and numpy are required to process frames")
        from .roi import infer_roi_space_from_points

        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
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

        if self._enable_bootstrap and camera.id not in self._bootstrap_done_cameras:
            brightness_by_mapping: dict[int, float] = {}
            forced_off_mapping_ids: set[int] = set()
            for mapping in camera.mappings:
                if not mapping.enabled:
                    continue
                mask = self._get_mask(camera.id, mapping, frame.shape[:2])
                brightness_by_mapping[mapping.id] = self._brightness(hsv, mask)
                if mapping.table_name and mapping.table_name.strip().lower() in self._bootstrap_off_table_names:
                    forced_off_mapping_ids.add(mapping.id)
            self._bootstrap_camera_light(
                camera.id,
                brightness_by_mapping,
                forced_off_mapping_ids=forced_off_mapping_ids,
            )
            self._bootstrap_done_cameras.add(camera.id)

        events: list[LightEvent] = []
        for mapping in camera.mappings:
            if not mapping.enabled:
                continue
            mask = self._get_mask(camera.id, mapping, frame.shape[:2])
            brightness = self._brightness(hsv, mask)
            event = self._process_mapping(
                camera_id=camera.id,
                mapping=mapping,
                brightness=brightness,
                now=now,
            )
            if event is not None:
                events.append(event)
        return events

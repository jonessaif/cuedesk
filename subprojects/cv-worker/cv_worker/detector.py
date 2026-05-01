from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import random
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


@dataclass(frozen=True)
class RoiCalibration:
    scale_x: float = 1.0
    scale_y: float = 1.0
    offset_x: float = 0.0
    offset_y: float = 0.0


@dataclass
class _MappingState:
    running: bool = False
    mask_shape: tuple[int, int] | None = None
    mask: np.ndarray | None = None
    window_started_at: datetime | None = None
    window_frames: int = 0
    window_active_frames: int = 0
    window_table_present_frames: int = 0
    window_peak_ratio: float = 0.0
    eval_interval_seconds: float | None = None
    last_active_at: datetime | None = None
    active_window_streak: int = 0
    inactive_window_streak: int = 0
    running_since: datetime | None = None
    last_start_at: datetime | None = None
    last_end_at: datetime | None = None
    light_model_loaded: bool = False
    light_on_level: float | None = None
    light_off_level: float | None = None
    light_on_confidence: float = 0.0
    light_off_confidence: float = 0.0
    light_on_state: bool | None = None
    light_on_votes: int = 0
    light_off_votes: int = 0
    roi_space: tuple[int, int] | None = None


@dataclass(frozen=True)
class DetectionProfile:
    motion_hit_threshold: float
    table_motion_hit_threshold: float
    global_motion_rescue_threshold: float
    start_peak_threshold: float
    active_frame_ratio: float
    min_table_presence_ratio: float
    require_both_activity_signals: bool
    start_required_windows: int
    end_required_windows: int


@dataclass(frozen=True)
class DetectionEvent:
    camera_id: int
    table_id: int
    table_name: str | None
    detection_type: str
    event: str
    event_at: datetime
    confidence: float
    measured_ratio: float
    table_detected: bool


@dataclass(frozen=True)
class DetectionDebug:
    camera_id: int
    table_id: int
    table_name: str | None
    detection_type: str
    running: bool
    current_motion_ratio: float
    table_motion_ratio: float
    light_on: bool
    light_level: float
    light_off_avg: float
    light_on_avg: float
    light_threshold: float
    table_present_now: bool
    window_frames: int
    window_active_frames: int
    window_table_present_frames: int
    window_peak_ratio: float
    eval_elapsed_seconds: float
    eval_interval_seconds: float
    window_closed: bool
    table_detected: bool
    active_window: bool
    active_window_streak: int
    inactive_window_streak: int
    idle_seconds: float | None
    frame_activity: bool
    strong_global_motion: bool
    running_seconds: float | None
    start_cooldown_remaining_seconds: float | None
    end_cooldown_remaining_seconds: float | None


class SnookerPoolStrategy:
    def __init__(self, *, start_threshold: float, stop_threshold: float) -> None:
        basic_profile = DetectionProfile(
            motion_hit_threshold=max(0.0001, stop_threshold),
            table_motion_hit_threshold=max(0.0001, stop_threshold * 0.4),
            global_motion_rescue_threshold=max(0.0001, stop_threshold * 2.2),
            start_peak_threshold=max(0.0001, start_threshold),
            active_frame_ratio=0.18,
            min_table_presence_ratio=0.5,
            require_both_activity_signals=False,
            start_required_windows=1,
            end_required_windows=1,
        )
        # Pool profile is stricter to reduce false starts from spill/light flicker.
        pool_profile = DetectionProfile(
            motion_hit_threshold=max(0.0001, stop_threshold * 1.25),
            table_motion_hit_threshold=max(0.0001, stop_threshold * 0.45),
            global_motion_rescue_threshold=max(0.0001, stop_threshold * 2.6),
            start_peak_threshold=max(0.0001, start_threshold * 1.5),
            active_frame_ratio=0.35,
            min_table_presence_ratio=0.55,
            require_both_activity_signals=True,
            start_required_windows=2,
            end_required_windows=2,
        )
        snooker_profile = DetectionProfile(
            motion_hit_threshold=max(0.0001, stop_threshold),
            table_motion_hit_threshold=max(0.0001, stop_threshold * 0.35),
            global_motion_rescue_threshold=max(0.0001, stop_threshold * 2.2),
            start_peak_threshold=max(0.0001, start_threshold * 0.6),
            active_frame_ratio=0.20,
            min_table_presence_ratio=0.45,
            require_both_activity_signals=False,
            start_required_windows=1,
            end_required_windows=2,
        )
        self._profiles: dict[str, DetectionProfile] = {
            "snooker": snooker_profile,
            "pool": pool_profile,
            # Current fallback until dedicated strategies are added.
            "playstation": basic_profile,
            "other": basic_profile,
        }

    def profile_for(self, detection_type: str) -> DetectionProfile:
        return self._profiles.get(detection_type.lower(), self._profiles["other"])

    def roi_brightness(self, hsv_frame: np.ndarray, roi_mask: np.ndarray) -> float:
        pixels = hsv_frame[roi_mask > 0]
        if pixels.size == 0:
            return 0.0
        return float(np.median(pixels[:, 2]))

    def table_surface_mask(self, hsv_frame: np.ndarray, roi_mask: np.ndarray) -> np.ndarray:
        if cv2 is None:
            return roi_mask

        pixels = hsv_frame[roi_mask > 0]
        empty = np.zeros_like(roi_mask)
        if pixels.size == 0:
            return empty

        value_median = float(np.median(pixels[:, 2]))
        if value_median < 45.0:
            return empty

        valid = pixels[(pixels[:, 1] > 35) & (pixels[:, 2] > 40)]
        if len(valid) < 300:
            return empty

        hue = valid[:, 0]
        hist = np.bincount((hue // 10).astype(np.int32), minlength=18)
        dominant_ratio = float(hist.max()) / float(hist.sum()) if hist.sum() > 0 else 0.0
        color_std = float(np.std(valid[:, :3], axis=0).mean())
        if dominant_ratio < 0.22 or color_std > 65.0:
            return empty

        dominant_bin = int(np.argmax(hist))
        dominant_hue = dominant_bin * 10 + 5
        hue_diff = np.abs(hsv_frame[:, :, 0].astype(np.int16) - dominant_hue)
        hue_diff = np.minimum(hue_diff, 180 - hue_diff)
        cloth_pixels = (
            (roi_mask > 0)
            & (hsv_frame[:, :, 1] > 35)
            & (hsv_frame[:, :, 2] > 40)
            & (hue_diff <= 12)
        )
        table_mask = np.zeros_like(roi_mask)
        table_mask[cloth_pixels] = 255

        kernel = np.ones((5, 5), dtype=np.uint8)
        table_mask = cv2.morphologyEx(table_mask, cv2.MORPH_OPEN, kernel)
        table_mask = cv2.morphologyEx(table_mask, cv2.MORPH_CLOSE, kernel)
        return table_mask

    def detect_table_presence(self, hsv_frame: np.ndarray, mask: np.ndarray) -> bool:
        if cv2 is None:
            return False
        table_mask = self.table_surface_mask(hsv_frame, mask)
        roi_pixels = cv2.countNonZero(mask)
        table_pixels = cv2.countNonZero(table_mask)
        if roi_pixels <= 0:
            return False
        return (float(table_pixels) / float(roi_pixels)) >= 0.22

    def evaluate_window(
        self,
        *,
        profile: DetectionProfile,
        window_frames: int,
        window_active_frames: int,
        window_table_present_frames: int,
        window_peak_ratio: float,
    ) -> tuple[bool, bool, float]:
        active_fraction = (
            float(window_active_frames) / float(window_frames)
            if window_frames > 0
            else 0.0
        )
        table_presence_fraction = (
            float(window_table_present_frames) / float(window_frames)
            if window_frames > 0
            else 0.0
        )
        table_detected = table_presence_fraction >= profile.min_table_presence_ratio
        meets_active_ratio = active_fraction >= profile.active_frame_ratio
        meets_peak_ratio = window_peak_ratio >= profile.start_peak_threshold
        if profile.require_both_activity_signals:
            signal_active = meets_active_ratio and meets_peak_ratio
        else:
            signal_active = meets_active_ratio or meets_peak_ratio
        is_active_window = table_detected and signal_active
        return table_detected, is_active_window, active_fraction


class MotionDetector:
    def __init__(
        self,
        *,
        start_threshold: float,
        stop_threshold: float,
        min_on_seconds: float,  # kept for backward compatibility, not used in window mode
        min_off_seconds: float,  # kept for backward compatibility, not used in window mode
        eval_interval_min_seconds: float = 15.0,
        eval_interval_max_seconds: float = 30.0,
        end_idle_seconds: float = 120.0,
        min_running_hold_seconds: float = 180.0,
        post_start_end_cooldown_seconds: float = 90.0,
        post_end_start_cooldown_seconds: float = 60.0,
        light_memory_path: str | None = None,
        roi_calibration_by_camera: dict[int, RoiCalibration] | None = None,
    ) -> None:
        if eval_interval_min_seconds < 0 or eval_interval_max_seconds < 0:
            raise ValueError("Evaluation interval must be >= 0")
        if eval_interval_min_seconds > eval_interval_max_seconds:
            raise ValueError("eval_interval_min_seconds must be <= eval_interval_max_seconds")
        self._eval_interval_min_seconds = eval_interval_min_seconds
        self._eval_interval_max_seconds = eval_interval_max_seconds
        self._end_idle_seconds = max(0.0, end_idle_seconds)
        self._min_running_hold_seconds = max(0.0, min_running_hold_seconds)
        self._post_start_end_cooldown_seconds = max(0.0, post_start_end_cooldown_seconds)
        self._post_end_start_cooldown_seconds = max(0.0, post_end_start_cooldown_seconds)
        self._strategy = SnookerPoolStrategy(
            start_threshold=start_threshold,
            stop_threshold=stop_threshold,
        )
        self._previous_gray_by_camera: dict[int, np.ndarray] = {}
        self._states: dict[tuple[int, int], _MappingState] = {}
        self._camera_roi_space: dict[int, tuple[int, int] | None] = {}
        self._roi_calibration_by_camera = roi_calibration_by_camera or {}
        self._light_memory_path = Path(light_memory_path).expanduser().resolve() if light_memory_path else None
        self._light_memory: dict[str, dict[str, float | bool]] = {}
        self._light_bootstrap_done_cameras: set[int] = set()
        self._light_memory_dirty = False
        self._light_memory_updates = 0
        self._load_light_memory()

    def _mapping_key(self, camera_id: int, mapping_id: int) -> str:
        return f"{camera_id}:{mapping_id}"

    def _load_light_memory(self) -> None:
        if self._light_memory_path is None or not self._light_memory_path.exists():
            return
        try:
            payload = json.loads(self._light_memory_path.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            return
        if not isinstance(payload, dict):
            return
        mappings = payload.get("mappings")
        if not isinstance(mappings, dict):
            return
        for key, value in mappings.items():
            if isinstance(key, str) and isinstance(value, dict):
                self._light_memory[key] = value

    def _save_light_memory(self) -> None:
        if self._light_memory_path is None or not self._light_memory_dirty:
            return
        payload = {
            "schemaVersion": 1,
            "updatedAt": datetime.now(timezone.utc).isoformat(),
            "mappings": self._light_memory,
        }
        try:
            self._light_memory_path.parent.mkdir(parents=True, exist_ok=True)
            self._light_memory_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            self._light_memory_dirty = False
        except Exception:  # noqa: BLE001
            # Keep running even if persistence fails.
            pass

    def flush_light_memory(self) -> None:
        self._save_light_memory()

    def _ensure_light_model_loaded(self, camera_id: int, mapping_id: int, state: _MappingState) -> None:
        if state.light_model_loaded:
            return
        key = self._mapping_key(camera_id, mapping_id)
        model = self._light_memory.get(key, {})
        on_level = model.get("onLevel")
        off_level = model.get("offLevel")
        on_conf = model.get("onConfidence")
        off_conf = model.get("offConfidence")
        light_on_state = model.get("lightOnState")

        state.light_on_level = float(on_level) if isinstance(on_level, (int, float)) else None
        state.light_off_level = float(off_level) if isinstance(off_level, (int, float)) else None
        state.light_on_confidence = float(on_conf) if isinstance(on_conf, (int, float)) else 0.0
        state.light_off_confidence = float(off_conf) if isinstance(off_conf, (int, float)) else 0.0
        state.light_on_state = bool(light_on_state) if isinstance(light_on_state, bool) else None
        state.light_model_loaded = True

    def _persist_light_model(self, camera_id: int, mapping_id: int, state: _MappingState) -> None:
        key = self._mapping_key(camera_id, mapping_id)
        self._light_memory[key] = {
            "onLevel": state.light_on_level,
            "offLevel": state.light_off_level,
            "onConfidence": state.light_on_confidence,
            "offConfidence": state.light_off_confidence,
            "lightOnState": state.light_on_state,
        }
        self._light_memory_dirty = True
        self._light_memory_updates += 1
        if self._light_memory_updates >= 100:
            self._light_memory_updates = 0
            self._save_light_memory()

    def _derive_light_threshold(self, state: _MappingState) -> tuple[float, float, float]:
        default_threshold = 38.0
        default_gap = 14.0
        min_gap = 6.0

        on_level = state.light_on_level
        off_level = state.light_off_level
        on_conf = state.light_on_confidence
        off_conf = state.light_off_confidence

        if (
            on_level is not None
            and off_level is not None
            and on_conf >= 5.0
            and off_conf >= 5.0
        ):
            if on_level < off_level:
                on_level, off_level = off_level, on_level
            gap = on_level - off_level
            if gap < min_gap:
                threshold = (on_level + off_level) / 2.0
            else:
                threshold = (on_level + off_level) / 2.0
            return threshold, off_level, on_level

        if on_level is not None and on_conf >= 5.0:
            threshold = max(20.0, on_level - default_gap)
            fallback_off = max(0.0, on_level - default_gap * 2.0)
            return threshold, fallback_off, on_level

        if off_level is not None and off_conf >= 5.0:
            threshold = min(90.0, off_level + default_gap)
            fallback_on = min(255.0, off_level + default_gap * 2.0)
            return threshold, off_level, fallback_on

        return default_threshold, 28.0, 52.0

    def _light_state_from_memory(
        self,
        *,
        camera_id: int,
        mapping_id: int,
        state: _MappingState,
        brightness: float,
    ) -> tuple[bool, float, float, float]:
        self._ensure_light_model_loaded(camera_id, mapping_id, state)
        threshold, off_avg, on_avg = self._derive_light_threshold(state)

        if state.light_on_state is None:
            state.light_on_state = brightness >= threshold
            state.light_on_votes = 0
            state.light_off_votes = 0

        hysteresis = 2.0
        if state.light_on_state:
            if brightness < (threshold - hysteresis):
                state.light_off_votes += 1
                state.light_on_votes = 0
            else:
                state.light_off_votes = 0
            if state.light_off_votes >= 3:
                state.light_on_state = False
                state.light_off_votes = 0
        else:
            if brightness > (threshold + hysteresis):
                state.light_on_votes += 1
                state.light_off_votes = 0
            else:
                state.light_on_votes = 0
            if state.light_on_votes >= 3:
                state.light_on_state = True
                state.light_on_votes = 0

        # Slow decay to keep model recent but stable.
        decay = 0.0015
        state.light_on_confidence = max(0.0, state.light_on_confidence * (1.0 - decay))
        state.light_off_confidence = max(0.0, state.light_off_confidence * (1.0 - decay))

        alpha = 0.03
        if state.light_on_state:
            if state.light_on_level is None:
                state.light_on_level = brightness
            else:
                state.light_on_level = (1.0 - alpha) * state.light_on_level + alpha * brightness
            state.light_on_confidence = min(1000.0, state.light_on_confidence + 1.0)
        else:
            if state.light_off_level is None:
                state.light_off_level = brightness
            else:
                state.light_off_level = (1.0 - alpha) * state.light_off_level + alpha * brightness
            state.light_off_confidence = min(1000.0, state.light_off_confidence + 1.0)

        self._persist_light_model(camera_id, mapping_id, state)

        threshold, off_avg, on_avg = self._derive_light_threshold(state)
        return bool(state.light_on_state), off_avg, on_avg, threshold

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
    def _read_number(model: dict[str, float | bool], key: str) -> float | None:
        value = model.get(key)
        if isinstance(value, (int, float)):
            return float(value)
        return None

    def _bootstrap_camera_light_from_brightness(
        self,
        camera_id: int,
        brightness_by_mapping: dict[int, float],
    ) -> None:
        # Bootstrap ON/OFF baselines from same-camera tables:
        # dimmest ROI is treated as OFF exemplar, others as ON exemplars.
        if len(brightness_by_mapping) < 2:
            return
        ordered = sorted(brightness_by_mapping.items(), key=lambda item: item[1])
        off_mapping_id, off_ref = ordered[0]
        on_values = [value for _, value in ordered[1:]]
        on_ref = self._median(on_values)
        if on_ref <= off_ref + 4.0:
            return
        midpoint = (on_ref + off_ref) / 2.0

        for mapping_id, brightness in brightness_by_mapping.items():
            key = self._mapping_key(camera_id, mapping_id)
            model = self._light_memory.get(key, {})

            on_level = self._read_number(model, "onLevel")
            off_level = self._read_number(model, "offLevel")
            on_conf = self._read_number(model, "onConfidence") or 0.0
            off_conf = self._read_number(model, "offConfidence") or 0.0

            if on_level is None or on_conf < 5.0:
                if mapping_id == off_mapping_id:
                    on_level = on_ref
                    on_conf = max(on_conf, 8.0)
                else:
                    on_level = brightness
                    on_conf = max(on_conf, 25.0)

            if off_level is None or off_conf < 5.0:
                if mapping_id == off_mapping_id:
                    off_level = brightness
                    off_conf = max(off_conf, 25.0)
                else:
                    off_level = off_ref
                    off_conf = max(off_conf, 8.0)

            self._light_memory[key] = {
                "onLevel": float(on_level),
                "offLevel": float(off_level),
                "onConfidence": float(on_conf),
                "offConfidence": float(off_conf),
                "lightOnState": bool(brightness >= midpoint),
            }

        self._light_memory_dirty = True
        self._light_memory_updates += 1
        if self._light_memory_updates >= 100:
            self._light_memory_updates = 0
            self._save_light_memory()

    def _interval_for(self, camera_id: int, mapping_id: int) -> float:
        if self._eval_interval_min_seconds == self._eval_interval_max_seconds:
            return self._eval_interval_min_seconds
        rng = random.Random((camera_id * 1000003) + mapping_id)
        return rng.uniform(self._eval_interval_min_seconds, self._eval_interval_max_seconds)

    def _get_mask(self, camera_id: int, mapping: MappingConfig, frame_shape: tuple[int, int]) -> np.ndarray:
        from .roi import infer_roi_space_from_points, polygon_mask, project_roi_points_to_frame

        key = (camera_id, mapping.id)
        state = self._states.setdefault(key, _MappingState())
        if state.mask is None or state.mask_shape != frame_shape:
            if state.roi_space is None:
                state.roi_space = mapping.roi_space
            if state.roi_space is None:
                state.roi_space = self._camera_roi_space.get(camera_id)
            if state.roi_space is None:
                state.roi_space = infer_roi_space_from_points(mapping.roi_points)
            roi = project_roi_points_to_frame(mapping.roi_points, frame_shape, state.roi_space)
            calibration = self._roi_calibration_by_camera.get(camera_id)
            if calibration is not None:
                roi = self._apply_roi_calibration(roi, frame_shape, calibration)
            state.mask = polygon_mask(frame_shape, roi)
            state.mask_shape = frame_shape
        return state.mask

    def _apply_roi_calibration(
        self,
        roi: np.ndarray,
        frame_shape: tuple[int, int],
        calibration: RoiCalibration,
    ) -> np.ndarray:
        frame_h, frame_w = frame_shape
        calibrated = roi.astype(np.float32).copy()
        calibrated[:, 0] *= calibration.scale_x
        calibrated[:, 1] *= calibration.scale_y
        calibrated[:, 0] += calibration.offset_x
        calibrated[:, 1] += calibration.offset_y
        calibrated = np.rint(calibrated).astype(np.int32)
        calibrated[:, 0] = np.clip(calibrated[:, 0], 0, frame_w - 1)
        calibrated[:, 1] = np.clip(calibrated[:, 1], 0, frame_h - 1)
        return calibrated

    def process_frame(self, camera: CameraConfig, frame: np.ndarray) -> list[DetectionEvent]:
        events, _ = self.process_frame_with_debug(camera, frame)
        return events

    def process_frame_with_debug(
        self,
        camera: CameraConfig,
        frame: np.ndarray,
    ) -> tuple[list[DetectionEvent], list[DetectionDebug]]:
        if cv2 is None or not _HAS_NUMPY:
            raise RuntimeError("opencv-python and numpy are required to process frames")
        now = datetime.now(timezone.utc)
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5, 5), 0)

        prev = self._previous_gray_by_camera.get(camera.id)
        self._previous_gray_by_camera[camera.id] = gray
        if prev is None:
            return [], []

        diff = cv2.absdiff(prev, gray)
        _, binary = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
        binary = cv2.medianBlur(binary, 3)

        events: list[DetectionEvent] = []
        debug_rows: list[DetectionDebug] = []
        if camera.id not in self._camera_roi_space:
            from .roi import infer_roi_space_from_points

            declared = [mapping.roi_space for mapping in camera.mappings if mapping.enabled and mapping.roi_space is not None]
            if len(declared) > 0:
                self._camera_roi_space[camera.id] = declared[0]
            else:
                combined_points: list[tuple[float, float]] = []
                for mapping in camera.mappings:
                    if mapping.enabled:
                        combined_points.extend(mapping.roi_points)
                self._camera_roi_space[camera.id] = infer_roi_space_from_points(combined_points)
        if camera.id not in self._light_bootstrap_done_cameras:
            brightness_by_mapping: dict[int, float] = {}
            for mapping in camera.mappings:
                if not mapping.enabled:
                    continue
                mask = self._get_mask(camera.id, mapping, binary.shape)
                brightness_by_mapping[mapping.id] = self._strategy.roi_brightness(hsv, mask)
            self._bootstrap_camera_light_from_brightness(camera.id, brightness_by_mapping)
            self._light_bootstrap_done_cameras.add(camera.id)
        for mapping in camera.mappings:
            if not mapping.enabled:
                continue
            mapping_events, debug_row = self._process_mapping(camera.id, mapping, binary, hsv, now)
            events.extend(mapping_events)
            debug_rows.append(debug_row)
        return events, debug_rows

    def _process_mapping(
        self,
        camera_id: int,
        mapping: MappingConfig,
        binary_diff: np.ndarray,
        hsv_frame: np.ndarray,
        now: datetime,
    ) -> tuple[list[DetectionEvent], DetectionDebug]:
        key = (camera_id, mapping.id)
        state = self._states.setdefault(key, _MappingState())
        mask = self._get_mask(camera_id, mapping, binary_diff.shape)
        profile = self._strategy.profile_for(mapping.detection_type)

        masked = cv2.bitwise_and(binary_diff, binary_diff, mask=mask)
        light_level = self._strategy.roi_brightness(hsv_frame, mask)
        light_on, light_off_avg, light_on_avg, light_threshold = self._light_state_from_memory(
            camera_id=camera_id,
            mapping_id=mapping.id,
            state=state,
            brightness=light_level,
        )
        if light_on:
            table_mask = self._strategy.table_surface_mask(hsv_frame, mask)
            table_masked = cv2.bitwise_and(binary_diff, binary_diff, mask=table_mask)
            roi_pixels = cv2.countNonZero(mask)
            table_pixels = cv2.countNonZero(table_mask)
            moving_pixels = cv2.countNonZero(masked)
            table_moving_pixels = cv2.countNonZero(table_masked)
            ratio = 0.0 if roi_pixels == 0 else float(moving_pixels) / float(roi_pixels)
            table_ratio = 0.0 if table_pixels == 0 else float(table_moving_pixels) / float(table_pixels)
            table_present = self._strategy.detect_table_presence(hsv_frame, mask)
        else:
            ratio = 0.0
            table_ratio = 0.0
            table_present = False

        if state.eval_interval_seconds is None:
            state.eval_interval_seconds = self._interval_for(camera_id, mapping.id)
        if state.window_started_at is None:
            state.window_started_at = now

        state.window_frames += 1
        if table_present:
            state.window_table_present_frames += 1
        if (
            table_present
            and (
                (
                    ratio >= profile.motion_hit_threshold
                    and table_ratio >= profile.table_motion_hit_threshold
                )
                or ratio >= profile.global_motion_rescue_threshold
            )
        ):
            state.window_active_frames += 1
            state.last_active_at = now
        if table_present and table_ratio >= profile.table_motion_hit_threshold:
            state.window_peak_ratio = max(state.window_peak_ratio, ratio)

        elapsed_seconds = (now - state.window_started_at).total_seconds()
        idle_seconds = (
            (now - state.last_active_at).total_seconds()
            if state.last_active_at is not None
            else None
        )
        running_seconds = (
            (now - state.running_since).total_seconds()
            if state.running_since is not None
            else None
        )
        start_cooldown_remaining_seconds = (
            max(0.0, self._post_end_start_cooldown_seconds - (now - state.last_end_at).total_seconds())
            if state.last_end_at is not None
            else None
        )
        end_cooldown_remaining_seconds = (
            max(0.0, self._post_start_end_cooldown_seconds - (now - state.last_start_at).total_seconds())
            if state.last_start_at is not None
            else None
        )
        strong_global_motion = ratio >= profile.global_motion_rescue_threshold
        frame_activity = (
            table_present
            and (
                (ratio >= profile.motion_hit_threshold and table_ratio >= profile.table_motion_hit_threshold)
                or strong_global_motion
            )
        )
        if state.eval_interval_seconds > 0 and elapsed_seconds < state.eval_interval_seconds:
            return [], DetectionDebug(
                camera_id=camera_id,
                table_id=mapping.table_id,
                table_name=mapping.table_name,
                detection_type=mapping.detection_type,
                running=state.running,
                current_motion_ratio=ratio,
                table_motion_ratio=table_ratio,
                light_on=light_on,
                light_level=light_level,
                light_off_avg=light_off_avg,
                light_on_avg=light_on_avg,
                light_threshold=light_threshold,
                table_present_now=table_present,
                window_frames=state.window_frames,
                window_active_frames=state.window_active_frames,
                window_table_present_frames=state.window_table_present_frames,
                window_peak_ratio=state.window_peak_ratio,
                eval_elapsed_seconds=elapsed_seconds,
                eval_interval_seconds=state.eval_interval_seconds,
                window_closed=False,
                table_detected=False,
                active_window=False,
                active_window_streak=state.active_window_streak,
                inactive_window_streak=state.inactive_window_streak,
                idle_seconds=idle_seconds,
                frame_activity=frame_activity,
                strong_global_motion=strong_global_motion,
                running_seconds=running_seconds,
                start_cooldown_remaining_seconds=start_cooldown_remaining_seconds,
                end_cooldown_remaining_seconds=end_cooldown_remaining_seconds,
            )

        table_detected, is_active_window, active_fraction = self._strategy.evaluate_window(
            profile=profile,
            window_frames=state.window_frames,
            window_active_frames=state.window_active_frames,
            window_table_present_frames=state.window_table_present_frames,
            window_peak_ratio=state.window_peak_ratio,
        )

        events: list[DetectionEvent] = []
        can_start = (
            state.last_end_at is None
            or (now - state.last_end_at).total_seconds() >= self._post_end_start_cooldown_seconds
        )
        if not state.running and is_active_window and can_start:
            state.active_window_streak += 1
            state.inactive_window_streak = 0
            if state.active_window_streak >= max(1, profile.start_required_windows):
                state.running = True
                state.active_window_streak = 0
                state.running_since = now
                state.last_start_at = now
                events.append(
                    DetectionEvent(
                        camera_id=camera_id,
                        table_id=mapping.table_id,
                        table_name=mapping.table_name,
                        detection_type=mapping.detection_type,
                        event="start",
                        event_at=now,
                        confidence=min(1.0, max(active_fraction, state.window_peak_ratio)),
                        measured_ratio=state.window_peak_ratio,
                        table_detected=table_detected,
                    )
                )
        elif state.running and not is_active_window:
            if state.last_active_at is None:
                state.last_active_at = now
            idle_seconds = (now - state.last_active_at).total_seconds()
            running_seconds = (
                (now - state.running_since).total_seconds()
                if state.running_since is not None
                else 0.0
            )
            end_cooldown_remaining_seconds = (
                max(0.0, self._post_start_end_cooldown_seconds - (now - state.last_start_at).total_seconds())
                if state.last_start_at is not None
                else 0.0
            )
            if (
                idle_seconds < self._end_idle_seconds
                or running_seconds < self._min_running_hold_seconds
                or end_cooldown_remaining_seconds > 0.0
            ):
                debug_row = DetectionDebug(
                    camera_id=camera_id,
                    table_id=mapping.table_id,
                    table_name=mapping.table_name,
                    detection_type=mapping.detection_type,
                    running=state.running,
                    current_motion_ratio=ratio,
                    table_motion_ratio=table_ratio,
                    light_on=light_on,
                    light_level=light_level,
                    light_off_avg=light_off_avg,
                    light_on_avg=light_on_avg,
                    light_threshold=light_threshold,
                    table_present_now=table_present,
                    window_frames=state.window_frames,
                    window_active_frames=state.window_active_frames,
                    window_table_present_frames=state.window_table_present_frames,
                    window_peak_ratio=state.window_peak_ratio,
                    eval_elapsed_seconds=elapsed_seconds,
                    eval_interval_seconds=state.eval_interval_seconds,
                    window_closed=True,
                    table_detected=table_detected,
                    active_window=is_active_window,
                    active_window_streak=state.active_window_streak,
                    inactive_window_streak=state.inactive_window_streak,
                    idle_seconds=idle_seconds,
                    frame_activity=frame_activity,
                    strong_global_motion=strong_global_motion,
                    running_seconds=running_seconds,
                    start_cooldown_remaining_seconds=start_cooldown_remaining_seconds,
                    end_cooldown_remaining_seconds=end_cooldown_remaining_seconds,
                )
                state.window_started_at = now
                state.window_frames = 0
                state.window_active_frames = 0
                state.window_table_present_frames = 0
                state.window_peak_ratio = 0.0
                if self._eval_interval_min_seconds != self._eval_interval_max_seconds:
                    state.eval_interval_seconds = self._interval_for(camera_id, mapping.id)
                return [], debug_row
            state.inactive_window_streak += 1
            state.active_window_streak = 0
            if state.inactive_window_streak >= max(1, profile.end_required_windows):
                state.running = False
                state.inactive_window_streak = 0
                state.last_end_at = now
                state.running_since = None
                events.append(
                    DetectionEvent(
                        camera_id=camera_id,
                        table_id=mapping.table_id,
                        table_name=mapping.table_name,
                        detection_type=mapping.detection_type,
                        event="end",
                        event_at=state.last_active_at,
                        confidence=min(1.0, max(0.0, 1.0 - active_fraction)),
                        measured_ratio=state.window_peak_ratio,
                        table_detected=table_detected,
                    )
                )
        else:
            # Mixed/uncertain window: reset streak counters to avoid accidental transitions.
            state.active_window_streak = 0
            state.inactive_window_streak = 0

        debug_row = DetectionDebug(
            camera_id=camera_id,
            table_id=mapping.table_id,
            table_name=mapping.table_name,
            detection_type=mapping.detection_type,
            running=state.running,
            current_motion_ratio=ratio,
            table_motion_ratio=table_ratio,
            light_on=light_on,
            light_level=light_level,
            light_off_avg=light_off_avg,
            light_on_avg=light_on_avg,
            light_threshold=light_threshold,
            table_present_now=table_present,
            window_frames=state.window_frames,
            window_active_frames=state.window_active_frames,
            window_table_present_frames=state.window_table_present_frames,
            window_peak_ratio=state.window_peak_ratio,
            eval_elapsed_seconds=elapsed_seconds,
            eval_interval_seconds=state.eval_interval_seconds,
            window_closed=True,
            table_detected=table_detected,
            active_window=is_active_window,
            active_window_streak=state.active_window_streak,
            inactive_window_streak=state.inactive_window_streak,
            idle_seconds=idle_seconds,
            frame_activity=frame_activity,
            strong_global_motion=strong_global_motion,
            running_seconds=running_seconds,
            start_cooldown_remaining_seconds=start_cooldown_remaining_seconds,
            end_cooldown_remaining_seconds=end_cooldown_remaining_seconds,
        )

        state.window_started_at = now
        state.window_frames = 0
        state.window_active_frames = 0
        state.window_table_present_frames = 0
        state.window_peak_ratio = 0.0
        if self._eval_interval_min_seconds != self._eval_interval_max_seconds:
            state.eval_interval_seconds = self._interval_for(camera_id, mapping.id)

        return events, debug_row

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
from pathlib import Path
import shutil
import time

import cv2

from .config import WorkerConfig, load_worker_config, CameraConfig
from .detector import MotionDetector, DetectionDebug, RoiCalibration
from .light_detector import LightDetector
from .ball_detector import BallDetector, BallDebug
from .table_event_detector import TableEventDetector, TableDebug
from .event_client import EventClient
from .roi import infer_roi_space_from_points, polygon_mask, project_roi_points_to_frame


def _load_roi_calibration_file(path: str | None) -> dict[int, RoiCalibration]:
    if not path:
        return {}
    file_path = Path(path).expanduser().resolve()
    if not file_path.exists():
        return {}
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}
    cameras = payload.get("cameras")
    if not isinstance(cameras, dict):
        return {}
    result: dict[int, RoiCalibration] = {}
    for key, value in cameras.items():
        if not isinstance(value, dict):
            continue
        try:
            camera_id = int(key)
        except Exception:  # noqa: BLE001
            continue
        result[camera_id] = RoiCalibration(
            scale_x=float(value.get("scaleX", 1.0)),
            scale_y=float(value.get("scaleY", 1.0)),
            offset_x=float(value.get("offsetX", 0.0)),
            offset_y=float(value.get("offsetY", 0.0)),
        )
    return result


def _apply_roi_calibration(roi, frame_shape: tuple[int, int], calibration: RoiCalibration):
    frame_h, frame_w = frame_shape
    calibrated = roi.astype("float32").copy()
    calibrated[:, 0] *= calibration.scale_x
    calibrated[:, 1] *= calibration.scale_y
    calibrated[:, 0] += calibration.offset_x
    calibrated[:, 1] += calibration.offset_y
    calibrated = calibrated.round().astype("int32")
    calibrated[:, 0] = calibrated[:, 0].clip(0, frame_w - 1)
    calibrated[:, 1] = calibrated[:, 1].clip(0, frame_h - 1)
    return calibrated


@dataclass
class _CameraRuntime:
    camera: CameraConfig
    capture: cv2.VideoCapture | None = None
    frame_index: int = 0
    stream_epoch: int = 0

    def open(self) -> None:
        self.close()
        self.capture = cv2.VideoCapture(self.camera.url)
        self.frame_index = 0
        self.stream_epoch += 1

    def read_frame(self):
        if self.capture is None:
            self.open()
        if self.capture is None:
            return None
        ok, frame = self.capture.read()
        if not ok or frame is None:
            self.open()
            return None
        self.frame_index += 1
        stream_time_ms = float(self.capture.get(cv2.CAP_PROP_POS_MSEC))
        if stream_time_ms < 0:
            stream_time_ms = 0.0
        return frame, self.frame_index, self.stream_epoch, stream_time_ms

    def close(self) -> None:
        if self.capture is not None:
            self.capture.release()
            self.capture = None


class CVWorker:
    def __init__(
        self,
        *,
        config: WorkerConfig,
        backend_url: str,
        cv_token: str | None,
        start_threshold: float,
        stop_threshold: float,
        min_on_seconds: float,
        min_off_seconds: float,
        eval_interval_min_seconds: float,
        eval_interval_max_seconds: float,
        end_idle_seconds: float,
        min_running_hold_seconds: float,
        post_start_end_cooldown_seconds: float,
        post_end_start_cooldown_seconds: float,
        detector_mode: str,
        light_confirm_seconds: float,
        ball_idle_seconds: float,
        frame_setup_idle_seconds: float,
        session_idle_seconds: float,
        shot_min_active_seconds: float,
        shot_min_peak_motion_ratio: float,
        shot_min_peak_candidate_count: int,
        enable_object_evidence: bool,
        require_object_evidence_for_shot: bool,
        object_model_path: str | None,
        object_confidence: float,
        cue_ball_near_px: float,
        table_idle_eval_seconds: float,
        table_running_eval_seconds: float,
        light_bootstrap_off_table_names: set[str] | None = None,
        enable_light_bootstrap: bool = True,
        freeze_light_thresholds: bool = True,
        stdout_only: bool = False,
        debug_all_loops: bool = False,
        debug_log_file: str | None = None,
        light_memory_file: str | None = None,
        event_snapshot_dir: str | None = None,
        startup_roi_snapshot_dir: str | None = None,
        roi_calibration_file: str | None = None,
        overwrite_debug_log: bool = True,
        clear_snapshot_dirs_on_start: bool = True,
    ) -> None:
        self._roi_calibration_by_camera = _load_roi_calibration_file(roi_calibration_file)
        self._runtimes = [
            _CameraRuntime(camera=camera)
            for camera in config.cameras
            if camera.enabled and len(camera.mappings) > 0
        ]
        self._detector = MotionDetector(
            start_threshold=start_threshold,
            stop_threshold=stop_threshold,
            min_on_seconds=min_on_seconds,
            min_off_seconds=min_off_seconds,
            eval_interval_min_seconds=eval_interval_min_seconds,
            eval_interval_max_seconds=eval_interval_max_seconds,
            end_idle_seconds=end_idle_seconds,
            min_running_hold_seconds=min_running_hold_seconds,
            post_start_end_cooldown_seconds=post_start_end_cooldown_seconds,
            post_end_start_cooldown_seconds=post_end_start_cooldown_seconds,
            light_memory_path=light_memory_file,
            roi_calibration_by_camera=self._roi_calibration_by_camera,
        )
        self._light_detector = LightDetector(
            light_memory_path=light_memory_file,
            min_state_confirm_seconds=light_confirm_seconds,
            bootstrap_off_table_names=light_bootstrap_off_table_names,
            enable_bootstrap=enable_light_bootstrap,
            update_levels=not freeze_light_thresholds,
        )
        self._ball_detector = BallDetector(idle_seconds=ball_idle_seconds)
        self._table_event_detector = TableEventDetector(
            light_confirm_seconds=light_confirm_seconds,
            ball_idle_seconds=ball_idle_seconds,
            frame_setup_idle_seconds=frame_setup_idle_seconds,
            session_idle_seconds=session_idle_seconds,
            min_shot_active_seconds=shot_min_active_seconds,
            min_shot_peak_motion_ratio=shot_min_peak_motion_ratio,
            min_shot_peak_candidate_count=shot_min_peak_candidate_count,
            enable_object_evidence=enable_object_evidence,
            require_object_evidence_for_shot=require_object_evidence_for_shot,
            object_model_path=object_model_path,
            object_confidence=object_confidence,
            cue_ball_near_px=cue_ball_near_px,
        )
        self._table_idle_eval_seconds = max(1.0, table_idle_eval_seconds)
        self._table_running_eval_seconds = max(0.2, table_running_eval_seconds)
        self._table_next_eval_by_camera: dict[int, float] = {}
        self._table_running_by_camera: dict[int, bool] = {}
        self._detector_mode = detector_mode
        self._client = EventClient(backend_url=backend_url, cv_token=cv_token)
        self._stdout_only = stdout_only
        self._debug_all_loops = debug_all_loops
        self._debug_log_path = Path(debug_log_file).expanduser().resolve() if debug_log_file else None
        self._debug_log_handle = None
        self._overwrite_debug_log = overwrite_debug_log
        self._clear_snapshot_dirs_on_start = clear_snapshot_dirs_on_start
        self._debug_log_prepared = False
        self._event_snapshot_dir = Path(event_snapshot_dir).expanduser().resolve() if event_snapshot_dir else None
        self._prepare_output_dir(self._event_snapshot_dir)
        self._startup_roi_snapshot_dir = (
            Path(startup_roi_snapshot_dir).expanduser().resolve() if startup_roi_snapshot_dir else None
        )
        self._prepare_output_dir(self._startup_roi_snapshot_dir)
        self._startup_snapshot_done_cameras: set[int] = set()
        self._loop_count = 0

    def _prepare_output_dir(self, path: Path | None) -> None:
        if path is None:
            return
        path.mkdir(parents=True, exist_ok=True)
        if not self._clear_snapshot_dirs_on_start:
            return
        for entry in path.iterdir():
            if entry.is_dir():
                shutil.rmtree(entry, ignore_errors=True)
            else:
                try:
                    entry.unlink()
                except FileNotFoundError:
                    continue

    def run_once(self) -> None:
        self._loop_count += 1
        for runtime in self._runtimes:
            frame_row = runtime.read_frame()
            if frame_row is None:
                continue
            frame, camera_frame_index, stream_epoch, stream_time_ms = frame_row
            self._save_startup_roi_snapshots_if_needed(runtime.camera, frame)
            if self._detector_mode in ("session", "both") and self._debug_all_loops:
                events, debug_rows = self._detector.process_frame_with_debug(runtime.camera, frame)
                self._print_debug_rows(
                    debug_rows,
                    camera_frame_index=camera_frame_index,
                    stream_epoch=stream_epoch,
                    stream_time_ms=stream_time_ms,
                )
            elif self._detector_mode in ("session", "both"):
                events = self._detector.process_frame(runtime.camera, frame)
            else:
                events = []
            for event in events:
                snapshot_path = self._save_event_snapshot(
                    frame,
                    camera_id=event.camera_id,
                    table_id=event.table_id,
                    table_name=event.table_name,
                    event=event.event,
                    event_at=event.event_at,
                )
                payload = {
                    "cameraId": event.camera_id,
                    "tableId": event.table_id,
                    "tableName": event.table_name,
                    "detectionType": event.detection_type,
                    "event": event.event,
                    "eventAt": event.event_at.isoformat(),
                    "confidence": round(event.confidence, 4),
                    "motionRatio": round(event.measured_ratio, 6),
                    "tableDetected": event.table_detected,
                    "loop": self._loop_count,
                    "cameraFrameIndex": camera_frame_index,
                    "streamEpoch": stream_epoch,
                    "streamTimeMs": round(stream_time_ms, 3),
                    "snapshotPath": snapshot_path,
                }
                print("[cv-worker:event]", payload, flush=True)
                self._write_debug_log("event", payload)
                if self._stdout_only:
                    continue
                try:
                    self._client.send_event(
                        table_id=event.table_id,
                        camera_id=event.camera_id,
                        detection_type=event.detection_type,
                        event=event.event,
                        event_at=event.event_at,
                        confidence=event.confidence,
                        payload={
                            "motionRatio": event.measured_ratio,
                            "lastActiveAt": event.event_at.isoformat() if event.event == "end" else None,
                            "tableName": event.table_name,
                            "tableDetected": event.table_detected,
                        },
                    )
                except Exception as exc:  # noqa: BLE001
                    print(f"[cv-worker:error] failed to post event: {exc}", flush=True)
            if self._detector_mode == "ball":
                ball_events, ball_debug_rows = self._ball_detector.process_frame(runtime.camera, frame)
                if self._debug_all_loops:
                    self._print_ball_debug_rows(
                        ball_debug_rows,
                        camera_frame_index=camera_frame_index,
                        stream_epoch=stream_epoch,
                        stream_time_ms=stream_time_ms,
                    )
                for ball_event in ball_events:
                    payload = {
                        "cameraId": ball_event.camera_id,
                        "tableId": ball_event.table_id,
                        "tableName": ball_event.table_name,
                        "detectionType": ball_event.detection_type,
                        "event": ball_event.event,
                        "eventAt": ball_event.event_at.isoformat(),
                        "confidence": round(ball_event.confidence, 4),
                        "motionRatio": round(ball_event.motion_ratio, 6),
                        "candidateCount": ball_event.candidate_count,
                        "loop": self._loop_count,
                        "cameraFrameIndex": camera_frame_index,
                        "streamEpoch": stream_epoch,
                        "streamTimeMs": round(stream_time_ms, 3),
                        "snapshotPath": self._save_event_snapshot(
                            frame,
                            camera_id=ball_event.camera_id,
                            table_id=ball_event.table_id,
                            table_name=ball_event.table_name,
                            event=ball_event.event,
                            event_at=ball_event.event_at,
                        ),
                    }
                    print("[cv-worker:ball-event]", payload, flush=True)
                    self._write_debug_log("event", payload)
            if self._detector_mode == "table":
                now_mono = time.monotonic()
                camera_running = self._table_running_by_camera.get(runtime.camera.id, False)
                interval = self._table_running_eval_seconds if camera_running else self._table_idle_eval_seconds
                next_eval = self._table_next_eval_by_camera.get(runtime.camera.id, 0.0)
                if now_mono < next_eval:
                    continue
                table_events, table_debug_rows = self._table_event_detector.process_frame(runtime.camera, frame)
                camera_running_now = any(row.session_running or row.shot_running or row.break_running for row in table_debug_rows)
                self._table_running_by_camera[runtime.camera.id] = camera_running_now
                next_interval = self._table_running_eval_seconds if camera_running_now else self._table_idle_eval_seconds
                self._table_next_eval_by_camera[runtime.camera.id] = now_mono + next_interval
                if self._debug_all_loops:
                    self._print_table_debug_rows(
                        table_debug_rows,
                        camera_frame_index=camera_frame_index,
                        stream_epoch=stream_epoch,
                        stream_time_ms=stream_time_ms,
                    )
                for table_event in table_events:
                    payload = {
                        "cameraId": table_event.camera_id,
                        "tableId": table_event.table_id,
                        "tableName": table_event.table_name,
                        "detectionType": table_event.detection_type,
                        "event": table_event.event,
                        "eventAt": table_event.event_at.isoformat(),
                        "confidence": round(table_event.confidence, 4),
                        "reason": table_event.reason,
                        "motionRatio": round(table_event.motion_ratio, 6),
                        "candidateCount": table_event.candidate_count,
                        "shotStartAt": None if table_event.shot_start_at is None else table_event.shot_start_at.isoformat(),
                        "shotEndAt": None if table_event.shot_end_at is None else table_event.shot_end_at.isoformat(),
                        "lightOn": table_event.light_on,
                        "durationSeconds": None if table_event.duration_seconds is None else round(table_event.duration_seconds, 3),
                        "peakMotionRatio": None if table_event.peak_motion_ratio is None else round(table_event.peak_motion_ratio, 6),
                        "peakCandidateCount": table_event.peak_candidate_count,
                        "personCount": table_event.person_count,
                        "cueCount": table_event.cue_count,
                        "ballCount": table_event.ball_count,
                        "cueNearBall": table_event.cue_near_ball,
                        "objectConfidence": None if table_event.object_confidence is None else round(table_event.object_confidence, 4),
                        "loop": self._loop_count,
                        "cameraFrameIndex": camera_frame_index,
                        "streamEpoch": stream_epoch,
                        "streamTimeMs": round(stream_time_ms, 3),
                        "snapshotPath": self._save_event_snapshot(
                            frame,
                            camera_id=table_event.camera_id,
                            table_id=table_event.table_id,
                            table_name=table_event.table_name,
                            event=table_event.event,
                            event_at=table_event.event_at,
                        ),
                    }
                    print("[cv-worker:table-event]", payload, flush=True)
                    self._write_debug_log("event", payload)
            if self._detector_mode in ("light", "both"):
                light_events = self._light_detector.process_frame(runtime.camera, frame)
                for light_event in light_events:
                    payload = {
                        "cameraId": light_event.camera_id,
                        "tableId": light_event.table_id,
                        "tableName": light_event.table_name,
                        "detectionType": light_event.detection_type,
                        "event": light_event.event,
                        "eventAt": light_event.event_at.isoformat(),
                        "confidence": round(light_event.confidence, 4),
                        "loop": self._loop_count,
                        "cameraFrameIndex": camera_frame_index,
                        "streamEpoch": stream_epoch,
                        "streamTimeMs": round(stream_time_ms, 3),
                        "lightLevel": round(light_event.brightness, 3),
                        "lightThreshold": round(light_event.threshold, 3),
                        "lightOffAvg": round(light_event.off_avg, 3),
                        "lightOnAvg": round(light_event.on_avg, 3),
                        "snapshotPath": self._save_event_snapshot(
                            frame,
                            camera_id=light_event.camera_id,
                            table_id=light_event.table_id,
                            table_name=light_event.table_name,
                            event=light_event.event,
                            event_at=light_event.event_at,
                        ),
                    }
                    print("[cv-worker:light-event]", payload, flush=True)
                    self._write_debug_log("event", payload)
                    if self._stdout_only:
                        continue
                    try:
                        self._client.send_event(
                            table_id=light_event.table_id,
                            camera_id=light_event.camera_id,
                            detection_type=light_event.detection_type,
                            event=light_event.event,
                            event_at=light_event.event_at,
                            confidence=light_event.confidence,
                            payload={
                                "tableName": light_event.table_name,
                                "lightLevel": light_event.brightness,
                                "lightThreshold": light_event.threshold,
                                "lightOffAvg": light_event.off_avg,
                                "lightOnAvg": light_event.on_avg,
                            },
                        )
                    except Exception as exc:  # noqa: BLE001
                        print(f"[cv-worker:error] failed to post light event: {exc}", flush=True)

    def _save_event_snapshot(
        self,
        frame,
        *,
        camera_id: int,
        table_id: int,
        table_name: str | None,
        event: str,
        event_at,
    ) -> str | None:
        if self._event_snapshot_dir is None:
            return None
        event_stamp = event_at.astimezone().strftime("%Y%m%dT%H%M%S_%f")
        table_tag = (table_name or f"table{table_id}").replace(" ", "_")
        filename = (
            f"{event_stamp}_cam{camera_id}_{table_tag}_"
            f"{event}_loop{self._loop_count}.jpg"
        )
        path = self._event_snapshot_dir / filename
        ok = cv2.imwrite(str(path), frame)
        if not ok:
            return None
        return str(path)

    def _save_startup_roi_snapshots_if_needed(self, camera: CameraConfig, frame) -> None:
        if self._startup_roi_snapshot_dir is None:
            return
        if camera.id in self._startup_snapshot_done_cameras:
            return

        stamp = int(time.time() * 1000)
        camera_tag = camera.name.replace(" ", "_")
        overlay = frame.copy()
        saved_paths: list[str] = []
        declared_spaces = [mapping.roi_space for mapping in camera.mappings if mapping.enabled and mapping.roi_space is not None]
        if len(declared_spaces) > 0:
            camera_roi_space = declared_spaces[0]
        else:
            combined_points: list[tuple[float, float]] = []
            for mapping in camera.mappings:
                if mapping.enabled:
                    combined_points.extend(mapping.roi_points)
            camera_roi_space = infer_roi_space_from_points(combined_points)

        for mapping in camera.mappings:
            if not mapping.enabled:
                continue
            roi_space = mapping.roi_space if mapping.roi_space is not None else camera_roi_space
            roi = project_roi_points_to_frame(mapping.roi_points, frame.shape[:2], roi_space)
            calibration = self._roi_calibration_by_camera.get(camera.id)
            if calibration is not None:
                roi = _apply_roi_calibration(roi, frame.shape[:2], calibration)
            cv2.polylines(overlay, [roi], isClosed=True, color=(0, 255, 255), thickness=2)

            mask = polygon_mask(frame.shape[:2], roi)
            masked = cv2.bitwise_and(frame, frame, mask=mask)
            x, y, w, h = cv2.boundingRect(roi)
            if w <= 0 or h <= 0:
                continue
            crop = masked[y : y + h, x : x + w]
            table_tag = (mapping.table_name or f"table{mapping.table_id}").replace(" ", "_")
            crop_name = f"{stamp}_cam{camera.id}_{camera_tag}_{table_tag}_roi.jpg"
            crop_path = self._startup_roi_snapshot_dir / crop_name
            if cv2.imwrite(str(crop_path), crop):
                saved_paths.append(str(crop_path))

        overlay_name = f"{stamp}_cam{camera.id}_{camera_tag}_overlay.jpg"
        overlay_path = self._startup_roi_snapshot_dir / overlay_name
        if cv2.imwrite(str(overlay_path), overlay):
            saved_paths.insert(0, str(overlay_path))

        self._startup_snapshot_done_cameras.add(camera.id)
        if saved_paths:
            print("[cv-worker:startup]", {"cameraId": camera.id, "roiSnapshots": saved_paths}, flush=True)

    def _print_debug_rows(
        self,
        rows: list[DetectionDebug],
        *,
        camera_frame_index: int,
        stream_epoch: int,
        stream_time_ms: float,
    ) -> None:
        for row in rows:
            payload = {
                "loop": self._loop_count,
                "cameraFrameIndex": camera_frame_index,
                "streamEpoch": stream_epoch,
                "streamTimeMs": round(stream_time_ms, 3),
                "cameraId": row.camera_id,
                "tableId": row.table_id,
                "tableName": row.table_name,
                "detectionType": row.detection_type,
                "running": row.running,
                "motionRatioNow": round(row.current_motion_ratio, 6),
                "tableMotionRatio": round(row.table_motion_ratio, 6),
                "lightOn": row.light_on,
                "lightLevel": round(row.light_level, 3),
                "lightOffAvg": round(row.light_off_avg, 3),
                "lightOnAvg": round(row.light_on_avg, 3),
                "lightThreshold": round(row.light_threshold, 3),
                "tablePresentNow": row.table_present_now,
                "windowFrames": row.window_frames,
                "windowActiveFrames": row.window_active_frames,
                "windowTablePresentFrames": row.window_table_present_frames,
                "windowPeakRatio": round(row.window_peak_ratio, 6),
                "windowElapsedSec": round(row.eval_elapsed_seconds, 3),
                "windowIntervalSec": round(row.eval_interval_seconds, 3),
                "windowClosed": row.window_closed,
                "tableDetected": row.table_detected,
                "activeWindow": row.active_window,
                "activeStreak": row.active_window_streak,
                "inactiveStreak": row.inactive_window_streak,
                "idleSeconds": None if row.idle_seconds is None else round(row.idle_seconds, 3),
                "frameActivity": row.frame_activity,
                "strongGlobalMotion": row.strong_global_motion,
                "runningSeconds": None if row.running_seconds is None else round(row.running_seconds, 3),
                "startCooldownRemainingSec": None if row.start_cooldown_remaining_seconds is None else round(row.start_cooldown_remaining_seconds, 3),
                "endCooldownRemainingSec": None if row.end_cooldown_remaining_seconds is None else round(row.end_cooldown_remaining_seconds, 3),
            }
            print("[cv-worker:debug]", payload, flush=True)
            self._write_debug_log("debug", payload)

    def _print_ball_debug_rows(
        self,
        rows: list[BallDebug],
        *,
        camera_frame_index: int,
        stream_epoch: int,
        stream_time_ms: float,
    ) -> None:
        for row in rows:
            payload = {
                "loop": self._loop_count,
                "cameraFrameIndex": camera_frame_index,
                "streamEpoch": stream_epoch,
                "streamTimeMs": round(stream_time_ms, 3),
                "cameraId": row.camera_id,
                "tableId": row.table_id,
                "tableName": row.table_name,
                "detectionType": row.detection_type,
                "running": row.running,
                "activeNow": row.active_now,
                "motionRatio": round(row.motion_ratio, 6),
                "candidateCount": row.candidate_count,
                "activeStreak": row.active_streak,
                "inactiveStreak": row.inactive_streak,
                "idleSeconds": None if row.idle_seconds is None else round(row.idle_seconds, 3),
            }
            print("[cv-worker:ball-debug]", payload, flush=True)
            self._write_debug_log("debug", payload)

    def _print_table_debug_rows(
        self,
        rows: list[TableDebug],
        *,
        camera_frame_index: int,
        stream_epoch: int,
        stream_time_ms: float,
    ) -> None:
        for row in rows:
            payload = {
                "loop": self._loop_count,
                "cameraFrameIndex": camera_frame_index,
                "streamEpoch": stream_epoch,
                "streamTimeMs": round(stream_time_ms, 3),
                "cameraId": row.camera_id,
                "tableId": row.table_id,
                "tableName": row.table_name,
                "detectionType": row.detection_type,
                "lightOn": row.light_on,
                "sessionRunning": row.session_running,
                "frameSetupRunning": row.frame_setup_running,
                "breakRunning": row.break_running,
                "shotRunning": row.shot_running,
                "ballActiveNow": row.ball_active_now,
                "motionRatio": round(row.motion_ratio, 6),
                "candidateCount": row.candidate_count,
                "idleSeconds": None if row.idle_seconds is None else round(row.idle_seconds, 3),
                "objectAvailable": row.object_available,
                "personCount": row.person_count,
                "cueCount": row.cue_count,
                "ballCount": row.ball_count,
                "cueNearBall": row.cue_near_ball,
                "objectConfidence": round(row.object_confidence, 4),
            }
            print("[cv-worker:table-debug]", payload, flush=True)
            self._write_debug_log("debug", payload)

    def _open_debug_log(self) -> None:
        if self._debug_log_path is None or self._debug_log_handle is not None:
            return
        self._debug_log_path.parent.mkdir(parents=True, exist_ok=True)
        mode = "w" if self._overwrite_debug_log and not self._debug_log_prepared else "a"
        self._debug_log_handle = self._debug_log_path.open(mode, encoding="utf-8")
        self._debug_log_prepared = True

    def _write_debug_log(self, kind: str, payload: dict) -> None:
        if self._debug_log_path is None:
            return
        self._open_debug_log()
        if self._debug_log_handle is None:
            return
        line = {"kind": kind, "at": int(time.time() * 1000), **payload}
        self._debug_log_handle.write(json.dumps(line, separators=(",", ":")) + "\n")
        self._debug_log_handle.flush()

    def close(self) -> None:
        self._detector.flush_light_memory()
        self._light_detector.flush_light_memory()
        for runtime in self._runtimes:
            runtime.close()
        if self._debug_log_handle is not None:
            self._debug_log_handle.close()
            self._debug_log_handle = None


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="CueDesk OpenCV worker")
    parser.add_argument("--config", default="../../dist/cv-worker-config.json", help="Path to worker config JSON")
    parser.add_argument("--backend-url", default="http://localhost:3000", help="CueDesk backend base URL")
    parser.add_argument("--cv-token", default=None, help="Optional x-cv-token")
    parser.add_argument("--poll-interval-ms", type=int, default=200, help="Worker loop interval")
    parser.add_argument("--start-threshold", type=float, default=0.04, help="Motion ratio start threshold")
    parser.add_argument("--stop-threshold", type=float, default=0.02, help="Motion ratio stop threshold")
    parser.add_argument("--min-on-seconds", type=float, default=1.2, help="Deprecated in window mode")
    parser.add_argument("--min-off-seconds", type=float, default=1.8, help="Deprecated in window mode")
    parser.add_argument("--eval-interval-min-seconds", type=float, default=15.0, help="Minimum window before evaluating start/end")
    parser.add_argument("--eval-interval-max-seconds", type=float, default=30.0, help="Maximum window before evaluating start/end")
    parser.add_argument("--end-idle-seconds", type=float, default=120.0, help="Emit end only after this many seconds since last activity")
    parser.add_argument("--min-running-hold-seconds", type=float, default=180.0, help="Minimum time table must stay running before end is allowed")
    parser.add_argument("--post-start-end-cooldown-seconds", type=float, default=90.0, help="Block end shortly after start to reduce flapping")
    parser.add_argument("--post-end-start-cooldown-seconds", type=float, default=60.0, help="Block restart shortly after end to reduce flapping")
    parser.add_argument("--detector-mode", choices=["session", "light", "ball", "table", "both"], default="session", help="Run session detector, light detector, ball detector, table event detector, or both(session+light)")
    parser.add_argument("--light-confirm-seconds", type=float, default=2.0, help="Require this many seconds of consistent light evidence before light_on/light_off transition")
    parser.add_argument("--ball-idle-seconds", type=float, default=8.0, help="Emit ball_motion_end after this many seconds without detected ball motion")
    parser.add_argument("--frame-setup-idle-seconds", type=float, default=20.0, help="Emit frame_setup_start after this many quiet seconds since light_on or last shot end")
    parser.add_argument("--session-idle-seconds", type=float, default=900.0, help="Emit session_end after this many quiet seconds while light remains on")
    parser.add_argument("--shot-min-active-seconds", type=float, default=0.25, help="Minimum shot duration required before finalized shot event is emitted")
    parser.add_argument("--shot-min-peak-motion-ratio", type=float, default=0.0012, help="Minimum peak motion ratio required for finalized shot event")
    parser.add_argument("--shot-min-peak-candidate-count", type=int, default=1, help="Minimum peak moving-ball candidate count required for finalized shot event")
    parser.add_argument("--enable-object-evidence", action="store_true", help="Enable YOLO-based person/cue/ball evidence for table detector")
    parser.add_argument("--require-object-evidence-for-shot", action="store_true", help="Require person+cue+ball evidence to emit finalized shot event")
    parser.add_argument("--object-model-path", default=None, help="Optional YOLO model path/name for object evidence (defaults to yolov8n.pt)")
    parser.add_argument("--object-confidence", type=float, default=0.25, help="YOLO confidence threshold for object evidence")
    parser.add_argument("--cue-ball-near-px", type=float, default=48.0, help="Pixel distance threshold for cue-near-ball evidence")
    parser.add_argument("--table-idle-eval-seconds", type=float, default=60.0, help="In table mode, evaluate every N seconds when table is not running")
    parser.add_argument("--table-running-eval-seconds", type=float, default=3.0, help="In table mode, evaluate every N seconds when table is running")
    parser.add_argument("--light-bootstrap-off-table-names", default="", help="Comma-separated table names known to be light OFF in initial calibration frame (e.g. S1)")
    parser.add_argument("--disable-light-bootstrap", action="store_true", help="Do not auto-bootstrap light baselines from first frame; use saved memory as-is")
    parser.add_argument("--freeze-light-thresholds", dest="freeze_light_thresholds", action="store_true", default=True, help="Do not update light ON/OFF levels while running (default: enabled)")
    parser.add_argument("--allow-light-threshold-updates", dest="freeze_light_thresholds", action="store_false", help="Allow runtime updates to light ON/OFF levels")
    parser.add_argument("--stdout-only", action="store_true", help="Log events to stdout and skip backend POST")
    parser.add_argument("--debug-all-loops", action="store_true", help="Print per-loop per-table detection diagnostics")
    parser.add_argument("--debug-log-file", default=None, help="Optional JSONL file path to persist debug/event logs")
    parser.add_argument("--append-debug-log", action="store_true", help="Append debug log instead of overwriting on startup")
    parser.add_argument("--light-memory-file", default="../../dist/cv-light-memory.json", help="Persistent per-table light memory JSON file")
    parser.add_argument("--event-snapshot-dir", default=None, help="Optional directory to save a JPEG snapshot for each emitted event")
    parser.add_argument("--startup-roi-snapshot-dir", default=None, help="Optional directory to save one startup ROI snapshot set per camera")
    parser.add_argument("--keep-snapshot-dirs", action="store_true", help="Do not clear snapshot directories on startup")
    parser.add_argument("--roi-calibration-file", default=None, help="Optional ROI calibration JSON file (per-camera scale/offset)")
    parser.add_argument("--max-loops", type=int, default=0, help="Stop after N loops (0 means run forever)")
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    config = load_worker_config(args.config)
    worker = CVWorker(
        config=config,
        backend_url=args.backend_url,
        cv_token=args.cv_token,
        start_threshold=args.start_threshold,
        stop_threshold=args.stop_threshold,
        min_on_seconds=args.min_on_seconds,
        min_off_seconds=args.min_off_seconds,
        eval_interval_min_seconds=args.eval_interval_min_seconds,
        eval_interval_max_seconds=args.eval_interval_max_seconds,
        end_idle_seconds=args.end_idle_seconds,
        min_running_hold_seconds=args.min_running_hold_seconds,
        post_start_end_cooldown_seconds=args.post_start_end_cooldown_seconds,
        post_end_start_cooldown_seconds=args.post_end_start_cooldown_seconds,
        detector_mode=args.detector_mode,
        light_confirm_seconds=args.light_confirm_seconds,
        ball_idle_seconds=args.ball_idle_seconds,
        frame_setup_idle_seconds=args.frame_setup_idle_seconds,
        session_idle_seconds=args.session_idle_seconds,
        shot_min_active_seconds=args.shot_min_active_seconds,
        shot_min_peak_motion_ratio=args.shot_min_peak_motion_ratio,
        shot_min_peak_candidate_count=args.shot_min_peak_candidate_count,
        enable_object_evidence=args.enable_object_evidence,
        require_object_evidence_for_shot=args.require_object_evidence_for_shot,
        object_model_path=args.object_model_path,
        object_confidence=args.object_confidence,
        cue_ball_near_px=args.cue_ball_near_px,
        table_idle_eval_seconds=args.table_idle_eval_seconds,
        table_running_eval_seconds=args.table_running_eval_seconds,
        light_bootstrap_off_table_names={name.strip() for name in args.light_bootstrap_off_table_names.split(",") if name.strip()},
        enable_light_bootstrap=not args.disable_light_bootstrap,
        freeze_light_thresholds=args.freeze_light_thresholds,
        stdout_only=args.stdout_only,
        debug_all_loops=args.debug_all_loops,
        debug_log_file=args.debug_log_file,
        overwrite_debug_log=not args.append_debug_log,
        light_memory_file=args.light_memory_file,
        event_snapshot_dir=args.event_snapshot_dir,
        startup_roi_snapshot_dir=args.startup_roi_snapshot_dir,
        clear_snapshot_dirs_on_start=not args.keep_snapshot_dirs,
        roi_calibration_file=args.roi_calibration_file,
    )

    try:
        loops = 0
        while True:
            worker.run_once()
            loops += 1
            if args.max_loops > 0 and loops >= args.max_loops:
                break
            time.sleep(max(0.01, args.poll_interval_ms / 1000.0))
    finally:
        worker.close()


if __name__ == "__main__":
    main()

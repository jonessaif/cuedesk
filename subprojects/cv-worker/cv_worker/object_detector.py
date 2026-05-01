from __future__ import annotations

from dataclasses import dataclass
from typing import Any

try:
    import numpy as np
    _HAS_NUMPY = True
except ModuleNotFoundError:  # pragma: no cover - runtime dependency in worker env
    _HAS_NUMPY = False
    np = Any  # type: ignore[assignment]

from .config import CameraConfig


@dataclass(frozen=True)
class ObjectEvidence:
    available: bool
    person_count: int
    cue_count: int
    ball_count: int
    cue_near_ball: bool
    confidence: float


class ObjectDetector:
    def __init__(
        self,
        *,
        mode: str = "off",
        model_path: str | None = None,
        confidence: float = 0.25,
        cue_ball_near_px: float = 48.0,
    ) -> None:
        self._mode = mode
        self._model_path = model_path
        self._confidence = max(0.01, min(0.95, confidence))
        self._cue_ball_near_px = max(5.0, cue_ball_near_px)
        self._model: Any | None = None
        self._load_attempted = False
        self._available = False
        self._camera_roi_space: dict[int, tuple[int, int] | None] = {}

    def _ensure_model(self) -> None:
        if self._load_attempted:
            return
        self._load_attempted = True
        if self._mode == "off":
            return
        try:
            from ultralytics import YOLO  # type: ignore[import-not-found]
        except Exception:
            self._available = False
            return
        model_target = self._model_path or "yolov8n.pt"
        try:
            self._model = YOLO(model_target)
            self._available = True
        except Exception:
            self._available = False
            self._model = None

    @staticmethod
    def _class_name(raw: Any, names: Any) -> str:
        try:
            idx = int(raw)
        except Exception:
            return ""
        if isinstance(names, dict):
            return str(names.get(idx, "")).strip().lower()
        if isinstance(names, list) and 0 <= idx < len(names):
            return str(names[idx]).strip().lower()
        return ""

    @staticmethod
    def _is_person(name: str) -> bool:
        return name == "person"

    @staticmethod
    def _is_ball(name: str) -> bool:
        if "ball" in name:
            return True
        return name in {"snooker", "pool_ball", "billiard_ball", "cue_ball"}

    @staticmethod
    def _is_cue(name: str) -> bool:
        return ("cue" in name) or ("stick" in name and "hockey" not in name)

    @staticmethod
    def _bbox_center(xyxy: np.ndarray) -> tuple[float, float]:
        x1, y1, x2, y2 = xyxy.tolist()
        return ((x1 + x2) / 2.0, (y1 + y2) / 2.0)

    def process_frame(self, camera: CameraConfig, frame: np.ndarray) -> dict[int, ObjectEvidence]:
        from .roi import infer_roi_space_from_points, polygon_mask, project_roi_points_to_frame

        if not _HAS_NUMPY:
            result: dict[int, ObjectEvidence] = {}
            for mapping in camera.mappings:
                if mapping.enabled:
                    result[mapping.table_id] = ObjectEvidence(
                        available=False,
                        person_count=0,
                        cue_count=0,
                        ball_count=0,
                        cue_near_ball=False,
                        confidence=0.0,
                    )
            return result

        self._ensure_model()
        if not self._available or self._model is None:
            result: dict[int, ObjectEvidence] = {}
            for mapping in camera.mappings:
                if mapping.enabled:
                    result[mapping.table_id] = ObjectEvidence(
                        available=False,
                        person_count=0,
                        cue_count=0,
                        ball_count=0,
                        cue_near_ball=False,
                        confidence=0.0,
                    )
            return result

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

        roi_masks: dict[int, np.ndarray] = {}
        for mapping in camera.mappings:
            if not mapping.enabled:
                continue
            roi_space = mapping.roi_space if mapping.roi_space is not None else self._camera_roi_space[camera.id]
            roi = project_roi_points_to_frame(mapping.roi_points, frame.shape[:2], roi_space)
            roi_masks[mapping.table_id] = polygon_mask(frame.shape[:2], roi)

        detections_by_table: dict[int, dict[str, list[tuple[tuple[float, float], float]]]] = {}
        for mapping in camera.mappings:
            if mapping.enabled:
                detections_by_table[mapping.table_id] = {"person": [], "cue": [], "ball": []}

        try:
            results = self._model.predict(frame, conf=self._confidence, verbose=False)
        except Exception:
            result: dict[int, ObjectEvidence] = {}
            for table_id in detections_by_table.keys():
                result[table_id] = ObjectEvidence(
                    available=False,
                    person_count=0,
                    cue_count=0,
                    ball_count=0,
                    cue_near_ball=False,
                    confidence=0.0,
                )
            return result

        if len(results) == 0:
            result: dict[int, ObjectEvidence] = {}
            for table_id in detections_by_table.keys():
                result[table_id] = ObjectEvidence(
                    available=True,
                    person_count=0,
                    cue_count=0,
                    ball_count=0,
                    cue_near_ball=False,
                    confidence=0.0,
                )
            return result

        row = results[0]
        boxes = getattr(row, "boxes", None)
        names = getattr(row, "names", {})
        if boxes is not None and getattr(boxes, "xyxy", None) is not None:
            xyxy = boxes.xyxy.cpu().numpy()
            cls_ids = boxes.cls.cpu().numpy() if getattr(boxes, "cls", None) is not None else np.array([])
            confs = boxes.conf.cpu().numpy() if getattr(boxes, "conf", None) is not None else np.array([])
            count = min(len(xyxy), len(cls_ids), len(confs))
            for i in range(count):
                name = self._class_name(cls_ids[i], names)
                if not name:
                    continue
                center = self._bbox_center(xyxy[i])
                cx, cy = int(round(center[0])), int(round(center[1]))
                for table_id, mask in roi_masks.items():
                    h, w = mask.shape
                    if cx < 0 or cy < 0 or cx >= w or cy >= h:
                        continue
                    if mask[cy, cx] <= 0:
                        continue
                    if self._is_person(name):
                        detections_by_table[table_id]["person"].append((center, float(confs[i])))
                    elif self._is_cue(name):
                        detections_by_table[table_id]["cue"].append((center, float(confs[i])))
                    elif self._is_ball(name):
                        detections_by_table[table_id]["ball"].append((center, float(confs[i])))

        result: dict[int, ObjectEvidence] = {}
        for table_id, bucket in detections_by_table.items():
            cues = bucket["cue"]
            balls = bucket["ball"]
            cue_near_ball = False
            for cue_center, _ in cues:
                for ball_center, _ in balls:
                    dx = cue_center[0] - ball_center[0]
                    dy = cue_center[1] - ball_center[1]
                    if (dx * dx + dy * dy) <= (self._cue_ball_near_px * self._cue_ball_near_px):
                        cue_near_ball = True
                        break
                if cue_near_ball:
                    break

            scores = [score for _, score in bucket["person"] + bucket["cue"] + bucket["ball"]]
            confidence = float(max(scores)) if scores else 0.0
            result[table_id] = ObjectEvidence(
                available=True,
                person_count=len(bucket["person"]),
                cue_count=len(bucket["cue"]),
                ball_count=len(bucket["ball"]),
                cue_near_ball=cue_near_ball,
                confidence=confidence,
            )
        return result

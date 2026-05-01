from __future__ import annotations

from typing import Iterable

import numpy as np


def points_to_int32(points: Iterable[tuple[float, float]]) -> np.ndarray:
    arr = np.array([[int(round(x)), int(round(y))] for x, y in points], dtype=np.int32)
    if arr.shape != (4, 2):
        raise ValueError("ROI requires exactly 4 points")
    return arr


def polygon_mask(frame_shape: tuple[int, int], roi_points: np.ndarray) -> np.ndarray:
    try:
        import cv2
    except ModuleNotFoundError as exc:  # pragma: no cover - runtime dependency in worker env
        raise RuntimeError("opencv-python is required for polygon mask operations") from exc
    mask = np.zeros(frame_shape, dtype=np.uint8)
    cv2.fillPoly(mask, [roi_points], 255)
    return mask


def infer_roi_space_from_points(points: Iterable[tuple[float, float]]) -> tuple[int, int] | None:
    arr = np.array([[float(x), float(y)] for x, y in points], dtype=np.float32)
    if arr.size == 0:
        return None
    max_x = float(np.max(arr[:, 0]))
    max_y = float(np.max(arr[:, 1]))
    if max_x <= 1.0 or max_y <= 1.0:
        return None

    required_w = int(np.ceil(max_x + 1.0))
    required_h = int(np.ceil(max_y + 1.0))

    # Use known resolution pairs to avoid mismatched width/height inference.
    # Prefer the smallest pair that safely contains the points.
    candidates = [
        (320, 180), (352, 240), (384, 216), (416, 234), (448, 256), (512, 288),
        (640, 360), (704, 396), (720, 404), (848, 480), (960, 540), (1024, 576),
        (1280, 720), (1366, 768), (1440, 810), (1600, 900), (1920, 1080),
        (2048, 1152), (2560, 1440), (3840, 2160),
    ]
    valid = [(w, h) for w, h in candidates if w >= required_w and h >= required_h]
    if valid:
        return min(valid, key=lambda pair: pair[0] * pair[1])
    return required_w, required_h


def project_roi_points_to_frame(
    points: Iterable[tuple[float, float]],
    frame_shape: tuple[int, int],
    roi_space: tuple[int, int] | None,
) -> np.ndarray:
    raw = points_to_int32(points)
    if roi_space is None:
        return raw

    frame_h, frame_w = frame_shape
    ref_w, ref_h = roi_space
    if ref_w <= 0 or ref_h <= 0:
        return raw

    scale_x = float(frame_w) / float(ref_w)
    scale_y = float(frame_h) / float(ref_h)
    if abs(scale_x - 1.0) <= 0.15 and abs(scale_y - 1.0) <= 0.15:
        return raw

    same_direction = (scale_x > 1.25 and scale_y > 1.25) or (scale_x < 0.8 and scale_y < 0.8)
    scale_delta = abs(scale_x - scale_y) / max(scale_x, scale_y)
    if not same_direction or scale_delta > 0.25:
        return raw

    scaled = raw.astype(np.float32).copy()
    scaled[:, 0] *= scale_x
    scaled[:, 1] *= scale_y
    scaled = np.rint(scaled).astype(np.int32)
    scaled[:, 0] = np.clip(scaled[:, 0], 0, frame_w - 1)
    scaled[:, 1] = np.clip(scaled[:, 1], 0, frame_h - 1)
    return scaled

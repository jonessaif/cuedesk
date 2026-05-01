from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any


Point = tuple[float, float]


@dataclass(frozen=True)
class MappingConfig:
    id: int
    table_id: int
    table_name: str | None
    detection_type: str
    enabled: bool
    roi_points: tuple[Point, Point, Point, Point]
    roi_space: tuple[int, int] | None = None


@dataclass(frozen=True)
class CameraConfig:
    id: int
    name: str
    url: str
    enabled: bool
    mappings: tuple[MappingConfig, ...]


@dataclass(frozen=True)
class WorkerConfig:
    cameras: tuple[CameraConfig, ...]


def _as_int(value: Any, field: str) -> int:
    if not isinstance(value, int):
        raise ValueError(f"{field} must be int")
    return value


def _as_bool(value: Any, field: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{field} must be bool")
    return value


def _as_str(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be non-empty string")
    return value.strip()


def _as_optional_str(value: Any, field: str) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"{field} must be string or null")
    stripped = value.strip()
    return stripped if stripped else None


def _parse_roi_points(roi: Any) -> tuple[Point, Point, Point, Point]:
    if not isinstance(roi, dict):
        raise ValueError("roi must be object")
    points = roi.get("points")
    if not isinstance(points, list) or len(points) != 4:
        raise ValueError("roi.points must contain exactly 4 points")

    parsed: list[Point] = []
    for idx, pair in enumerate(points):
        if not isinstance(pair, list) or len(pair) != 2:
            raise ValueError(f"roi.points[{idx}] must be [x,y]")
        x, y = pair
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            raise ValueError(f"roi.points[{idx}] must be numeric")
        parsed.append((float(x), float(y)))
    return (parsed[0], parsed[1], parsed[2], parsed[3])


def _parse_roi_space(roi: Any) -> tuple[int, int] | None:
    if not isinstance(roi, dict):
        return None
    source = roi.get("sourceResolution")
    if not isinstance(source, dict):
        return None
    width = source.get("width")
    height = source.get("height")
    if not isinstance(width, int) or not isinstance(height, int):
        return None
    if width <= 0 or height <= 0:
        return None
    return (width, height)


def load_worker_config(path: str | Path) -> WorkerConfig:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    cameras_raw = raw.get("cameras")
    if not isinstance(cameras_raw, list):
        raise ValueError("cameras must be an array")

    cameras: list[CameraConfig] = []
    for camera_raw in cameras_raw:
        if not isinstance(camera_raw, dict):
            raise ValueError("camera item must be object")

        mappings_raw = camera_raw.get("mappings")
        if not isinstance(mappings_raw, list):
            raise ValueError("camera.mappings must be array")

        mappings: list[MappingConfig] = []
        for mapping_raw in mappings_raw:
            if not isinstance(mapping_raw, dict):
                raise ValueError("mapping item must be object")
            mappings.append(
                MappingConfig(
                    id=_as_int(mapping_raw.get("id"), "mapping.id"),
                    table_id=_as_int(mapping_raw.get("tableId"), "mapping.tableId"),
                    table_name=_as_optional_str(mapping_raw.get("tableName"), "mapping.tableName"),
                    detection_type=_as_str(mapping_raw.get("detectionType"), "mapping.detectionType"),
                    enabled=_as_bool(mapping_raw.get("enabled"), "mapping.enabled"),
                    roi_points=_parse_roi_points(mapping_raw.get("roi")),
                    roi_space=_parse_roi_space(mapping_raw.get("roi")),
                )
            )

        cameras.append(
            CameraConfig(
                id=_as_int(camera_raw.get("id"), "camera.id"),
                name=_as_str(camera_raw.get("name"), "camera.name"),
                url=_as_str(camera_raw.get("url"), "camera.url"),
                enabled=_as_bool(camera_raw.get("enabled"), "camera.enabled"),
                mappings=tuple(mappings),
            )
        )

    return WorkerConfig(cameras=tuple(cameras))

from __future__ import annotations

from datetime import datetime
import json
from typing import Any
from urllib import request, error


class EventClient:
    def __init__(self, backend_url: str, cv_token: str | None = None, timeout_seconds: float = 4.0) -> None:
        self._endpoint = backend_url.rstrip("/") + "/api/vision/events"
        self._cv_token = cv_token
        self._timeout_seconds = timeout_seconds

    def send_event(
        self,
        *,
        table_id: int,
        camera_id: int,
        detection_type: str,
        event: str,
        event_at: datetime,
        confidence: float,
        payload: dict[str, Any] | None = None,
    ) -> None:
        body = {
            "tableId": table_id,
            "cameraId": camera_id,
            "detectionType": detection_type,
            "event": event,
            "eventAt": event_at.isoformat(),
            "confidence": confidence,
            "payload": payload or {},
        }
        headers = {"content-type": "application/json"}
        if self._cv_token:
            headers["x-cv-token"] = self._cv_token

        req = request.Request(
            self._endpoint,
            data=json.dumps(body).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with request.urlopen(req, timeout=self._timeout_seconds) as response:
                if response.status < 200 or response.status >= 300:
                    raise RuntimeError(f"Event post failed with status {response.status}")
        except error.HTTPError as exc:
            raise RuntimeError(f"Event post failed with status {exc.code}") from exc
        except error.URLError as exc:
            raise RuntimeError(f"Event post failed: {exc.reason}") from exc

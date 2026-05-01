from __future__ import annotations

from pathlib import Path
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cv_worker.ball_detector import BallDetector
from cv_worker.config import CameraConfig, MappingConfig

try:
    import cv2
    import numpy as np
except ModuleNotFoundError:
    cv2 = None
    np = None


@unittest.skipIf(cv2 is None or np is None, "opencv-python and numpy are required")
class BallDetectorTests(unittest.TestCase):
    def _camera(self) -> CameraConfig:
        mapping = MappingConfig(
            id=1,
            table_id=2,
            table_name="S1",
            detection_type="snooker",
            enabled=True,
            roi_points=((20.0, 20.0), (120.0, 20.0), (120.0, 120.0), (20.0, 120.0)),
        )
        return CameraConfig(
            id=2,
            name="Cam2",
            url="rtsp://test",
            enabled=True,
            mappings=(mapping,),
        )

    def _base_frame(self):
        frame = np.zeros((160, 160, 3), dtype=np.uint8)
        cv2.rectangle(frame, (20, 20), (120, 120), (20, 120, 20), thickness=-1)
        return frame

    def test_emits_ball_motion_start_then_end(self) -> None:
        detector = BallDetector(idle_seconds=0.04, min_event_interval_seconds=0.0)
        camera = self._camera()

        still = self._base_frame()
        moving_a = still.copy()
        moving_b = still.copy()
        cv2.circle(moving_a, (55, 60), 4, (255, 255, 255), thickness=-1)
        cv2.circle(moving_b, (62, 60), 4, (255, 255, 255), thickness=-1)

        events, _ = detector.process_frame(camera, still)
        self.assertEqual(events, [])
        events, _ = detector.process_frame(camera, moving_a)
        self.assertEqual(events, [])
        events, _ = detector.process_frame(camera, moving_b)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event, "ball_motion_start")

        end_seen = False
        for _ in range(6):
            time.sleep(0.02)
            events, _ = detector.process_frame(camera, still)
            if any(event.event == "ball_motion_end" for event in events):
                end_seen = True
                break
        self.assertTrue(end_seen)


if __name__ == "__main__":
    unittest.main()

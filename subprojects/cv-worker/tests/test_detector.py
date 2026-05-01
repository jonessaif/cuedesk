from __future__ import annotations

import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cv_worker.config import CameraConfig, MappingConfig
from cv_worker.detector import MotionDetector, SnookerPoolStrategy, _MappingState

try:
    import cv2
    import numpy as np
except ModuleNotFoundError:
    cv2 = None
    np = None


@unittest.skipIf(cv2 is None or np is None, "opencv-python and numpy are required")
class MotionDetectorTests(unittest.TestCase):
    def _camera(self) -> CameraConfig:
        mapping = MappingConfig(
            id=11,
            table_id=3,
            table_name="Table 3",
            detection_type="snooker",
            enabled=True,
            roi_points=((20.0, 20.0), (100.0, 20.0), (100.0, 100.0), (20.0, 100.0)),
        )
        return CameraConfig(
            id=1,
            name="Cam",
            url="rtsp://test",
            enabled=True,
            mappings=(mapping,),
        )

    def test_emits_start_then_end(self) -> None:
        from cv_worker.detector import MotionDetector

        detector = MotionDetector(
            start_threshold=0.01,
            stop_threshold=0.005,
            min_on_seconds=0.0,
            min_off_seconds=0.0,
            eval_interval_min_seconds=0.0,
            eval_interval_max_seconds=0.0,
            end_idle_seconds=0.0,
            min_running_hold_seconds=0.0,
            post_start_end_cooldown_seconds=0.0,
            post_end_start_cooldown_seconds=0.0,
        )
        camera = self._camera()

        still = np.zeros((140, 140, 3), dtype=np.uint8)
        cv2.rectangle(still, (20, 20), (100, 100), (20, 120, 20), thickness=-1)
        moving = still.copy()
        cv2.circle(moving, (60, 60), 8, (255, 255, 255), thickness=-1)

        self.assertEqual(detector.process_frame(camera, still), [])
        start_events = detector.process_frame(camera, moving)
        self.assertEqual(len(start_events), 1)
        self.assertEqual(start_events[0].event, "start")
        self.assertEqual(start_events[0].table_name, "Table 3")
        self.assertTrue(start_events[0].table_detected)
        self.assertIsNotNone(start_events[0].event_at)

        # First still frame after motion is a transition diff against the previous moving frame.
        self.assertEqual(detector.process_frame(camera, still), [])
        # Second still frame confirms inactivity and should emit end.
        end_events = detector.process_frame(camera, still)
        self.assertEqual(len(end_events), 1)
        self.assertEqual(end_events[0].event, "end")
        self.assertTrue(end_events[0].table_detected)
        self.assertIsNotNone(end_events[0].event_at)

    def test_min_running_hold_blocks_early_end(self) -> None:
        detector = MotionDetector(
            start_threshold=0.01,
            stop_threshold=0.005,
            min_on_seconds=0.0,
            min_off_seconds=0.0,
            eval_interval_min_seconds=0.0,
            eval_interval_max_seconds=0.0,
            end_idle_seconds=0.0,
            min_running_hold_seconds=9999.0,
            post_start_end_cooldown_seconds=0.0,
            post_end_start_cooldown_seconds=0.0,
        )
        camera = self._camera()

        still = np.zeros((140, 140, 3), dtype=np.uint8)
        cv2.rectangle(still, (20, 20), (100, 100), (20, 120, 20), thickness=-1)
        moving = still.copy()
        cv2.circle(moving, (60, 60), 8, (255, 255, 255), thickness=-1)

        self.assertEqual(detector.process_frame(camera, still), [])
        start_events = detector.process_frame(camera, moving)
        self.assertEqual(len(start_events), 1)
        self.assertEqual(start_events[0].event, "start")
        self.assertEqual(detector.process_frame(camera, still), [])
        self.assertEqual(detector.process_frame(camera, still), [])


class StrategyTests(unittest.TestCase):
    def test_pool_requires_both_activity_signals_for_active_window(self) -> None:
        strategy = SnookerPoolStrategy(start_threshold=0.04, stop_threshold=0.02)
        profile = strategy.profile_for("pool")
        self.assertTrue(profile.require_both_activity_signals)

        table_detected, is_active_window, _ = strategy.evaluate_window(
            profile=profile,
            window_frames=100,
            window_active_frames=40,
            window_table_present_frames=80,
            window_peak_ratio=0.045,
        )
        self.assertTrue(table_detected)
        self.assertFalse(is_active_window)

    def test_snooker_accepts_either_activity_signal(self) -> None:
        strategy = SnookerPoolStrategy(start_threshold=0.04, stop_threshold=0.02)
        profile = strategy.profile_for("snooker")
        self.assertFalse(profile.require_both_activity_signals)

        table_detected, is_active_window, _ = strategy.evaluate_window(
            profile=profile,
            window_frames=100,
            window_active_frames=25,
            window_table_present_frames=80,
            window_peak_ratio=0.045,
        )
        self.assertTrue(table_detected)
        self.assertTrue(is_active_window)

    @unittest.skipIf(np is None, "numpy is required")
    def test_light_on_heuristic(self) -> None:
        strategy = SnookerPoolStrategy(start_threshold=0.04, stop_threshold=0.02)
        roi_mask = np.zeros((20, 20), dtype=np.uint8)
        roi_mask[2:18, 2:18] = 255

        dark_hsv = np.zeros((20, 20, 3), dtype=np.uint8)
        dark_hsv[:, :, 2] = 20
        self.assertLess(strategy.roi_brightness(dark_hsv, roi_mask), 38.0)

        bright_hsv = np.zeros((20, 20, 3), dtype=np.uint8)
        bright_hsv[:, :, 2] = 90
        self.assertGreater(strategy.roi_brightness(bright_hsv, roi_mask), 38.0)

    def test_light_memory_does_not_invent_off_baseline_from_only_on_feed(self) -> None:
        detector = MotionDetector(
            start_threshold=0.04,
            stop_threshold=0.02,
            min_on_seconds=0.0,
            min_off_seconds=0.0,
            eval_interval_min_seconds=5.0,
            eval_interval_max_seconds=5.0,
            end_idle_seconds=120.0,
            min_running_hold_seconds=0.0,
            post_start_end_cooldown_seconds=0.0,
            post_end_start_cooldown_seconds=0.0,
            light_memory_path=None,
        )
        state = _MappingState()
        for _ in range(120):
            light_on, off_avg, on_avg, threshold = detector._light_state_from_memory(
                camera_id=1,
                mapping_id=11,
                state=state,
                brightness=82.0,
            )
        self.assertTrue(light_on)
        self.assertGreater(on_avg, off_avg)
        self.assertLess(threshold, 82.0)
        self.assertIsNone(state.light_off_level)

    def test_bootstrap_camera_light_uses_dimmest_as_off_and_shares_across_tables(self) -> None:
        detector = MotionDetector(
            start_threshold=0.04,
            stop_threshold=0.02,
            min_on_seconds=0.0,
            min_off_seconds=0.0,
            eval_interval_min_seconds=5.0,
            eval_interval_max_seconds=5.0,
            end_idle_seconds=120.0,
            min_running_hold_seconds=0.0,
            post_start_end_cooldown_seconds=0.0,
            post_end_start_cooldown_seconds=0.0,
            light_memory_path=None,
        )
        detector._bootstrap_camera_light_from_brightness(
            camera_id=2,
            brightness_by_mapping={
                1: 34.0,
                2: 121.0,
                3: 116.0,
                4: 111.0,
            },
        )

        off_model = detector._light_memory["2:1"]
        self.assertLess(float(off_model["offLevel"]), float(off_model["onLevel"]))
        self.assertGreaterEqual(float(off_model["offConfidence"]), 20.0)
        self.assertFalse(bool(off_model["lightOnState"]))

        on_model = detector._light_memory["2:2"]
        self.assertGreater(float(on_model["onLevel"]), float(on_model["offLevel"]))
        self.assertGreaterEqual(float(on_model["onConfidence"]), 20.0)
        self.assertTrue(bool(on_model["lightOnState"]))


if __name__ == "__main__":
    unittest.main()

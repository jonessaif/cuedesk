from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cv_worker.config import MappingConfig
from cv_worker.light_detector import LightDetector


class LightDetectorTests(unittest.TestCase):
    def _mapping(self) -> MappingConfig:
        return MappingConfig(
            id=7,
            table_id=3,
            table_name="S1",
            detection_type="snooker",
            enabled=True,
            roi_points=((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)),
        )

    def test_emits_light_on_after_votes(self) -> None:
        detector = LightDetector(light_memory_path=None, min_event_interval_seconds=0.0)
        mapping = self._mapping()
        now = datetime(2026, 4, 23, 12, 0, tzinfo=timezone.utc)

        detector._bootstrap_camera_light(1, {mapping.id: 70.0, 8: 245.0})

        first = detector._process_mapping(camera_id=1, mapping=mapping, brightness=90.0, now=now)
        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first.event, "light_off")
        self.assertIsNone(detector._process_mapping(camera_id=1, mapping=mapping, brightness=251.0, now=now + timedelta(seconds=1)))
        self.assertIsNone(detector._process_mapping(camera_id=1, mapping=mapping, brightness=252.0, now=now + timedelta(seconds=2)))
        event = detector._process_mapping(camera_id=1, mapping=mapping, brightness=253.0, now=now + timedelta(seconds=3))
        self.assertIsNotNone(event)
        assert event is not None
        self.assertEqual(event.event, "light_on")

    def test_emits_light_off_after_votes(self) -> None:
        detector = LightDetector(light_memory_path=None, min_event_interval_seconds=0.0)
        mapping = self._mapping()
        now = datetime(2026, 4, 23, 12, 10, tzinfo=timezone.utc)

        detector._bootstrap_camera_light(1, {mapping.id: 245.0, 8: 70.0})
        first = detector._process_mapping(camera_id=1, mapping=mapping, brightness=245.0, now=now)
        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first.event, "light_on")

        self.assertIsNone(detector._process_mapping(camera_id=1, mapping=mapping, brightness=35.0, now=now + timedelta(seconds=3)))
        self.assertIsNone(detector._process_mapping(camera_id=1, mapping=mapping, brightness=34.0, now=now + timedelta(seconds=4)))
        event = detector._process_mapping(camera_id=1, mapping=mapping, brightness=33.0, now=now + timedelta(seconds=5))
        self.assertIsNotNone(event)
        assert event is not None
        self.assertEqual(event.event, "light_off")

    def test_initial_event_emitted_once(self) -> None:
        detector = LightDetector(light_memory_path=None, min_event_interval_seconds=15.0)
        mapping = self._mapping()
        now = datetime(2026, 4, 23, 12, 20, tzinfo=timezone.utc)

        detector._bootstrap_camera_light(1, {mapping.id: 30.0, 8: 120.0})
        first = detector._process_mapping(camera_id=1, mapping=mapping, brightness=32.0, now=now)
        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first.event, "light_off")
        second = detector._process_mapping(camera_id=1, mapping=mapping, brightness=31.0, now=now + timedelta(seconds=1))
        self.assertIsNone(second)

    def test_initial_event_uses_current_threshold_not_seed_state(self) -> None:
        detector = LightDetector(light_memory_path=None, min_event_interval_seconds=0.0)
        mapping = self._mapping()
        now = datetime(2026, 4, 23, 12, 21, tzinfo=timezone.utc)

        # Seed with strong ON anchor, but current frame brightness is below threshold.
        detector._bootstrap_camera_light(2, {mapping.id: 180.0, 8: 255.0})
        first = detector._process_mapping(camera_id=2, mapping=mapping, brightness=182.0, now=now)
        self.assertIsNotNone(first)
        assert first is not None
        self.assertEqual(first.event, "light_off")

    def test_bootstrap_respects_forced_off_table_hint(self) -> None:
        detector = LightDetector(
            light_memory_path=None,
            min_event_interval_seconds=0.0,
            bootstrap_off_table_names={"s1"},
        )
        mapping_off = self._mapping()
        mapping_on = MappingConfig(
            id=8,
            table_id=4,
            table_name="S2",
            detection_type="snooker",
            enabled=True,
            roi_points=((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)),
        )
        detector._bootstrap_camera_light(
            camera_id=2,
            brightness_by_mapping={7: 100.0, 8: 120.0},
            forced_off_mapping_ids={7},
        )
        self.assertFalse(bool(detector._light_memory["2:7"]["lightOnState"]))
        self.assertTrue(bool(detector._light_memory["2:8"]["lightOnState"]))

    def test_bootstrap_infers_multiple_off_candidates_from_brightness_clusters(self) -> None:
        detector = LightDetector(light_memory_path=None, min_event_interval_seconds=0.0)
        detector._bootstrap_camera_light(
            camera_id=3,
            brightness_by_mapping={
                1: 95.0,
                2: 102.0,
                3: 208.0,
                4: 214.0,
            },
        )
        self.assertFalse(bool(detector._light_memory["3:1"]["lightOnState"]))
        self.assertFalse(bool(detector._light_memory["3:2"]["lightOnState"]))
        self.assertTrue(bool(detector._light_memory["3:3"]["lightOnState"]))
        self.assertTrue(bool(detector._light_memory["3:4"]["lightOnState"]))


if __name__ == "__main__":
    unittest.main()

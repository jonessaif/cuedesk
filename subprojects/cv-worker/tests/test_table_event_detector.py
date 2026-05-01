from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cv_worker.config import MappingConfig
from cv_worker.table_event_detector import TableEventDetector
from cv_worker.object_detector import ObjectEvidence


class TableEventDetectorTests(unittest.TestCase):
    def _mapping(self) -> MappingConfig:
        return MappingConfig(
            id=7,
            table_id=3,
            table_name="S1",
            detection_type="snooker",
            enabled=True,
            roi_points=((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)),
        )

    def test_light_on_starts_session_and_light_off_ends_session(self) -> None:
        detector = TableEventDetector(
            frame_setup_idle_seconds=5.0,
            session_idle_seconds=60.0,
        )
        mapping = self._mapping()
        now = datetime(2026, 4, 23, 12, 0, tzinfo=timezone.utc)

        events, _ = detector._apply(
            camera_id=2,
            mapping=mapping,
            now=now,
            light_transition="light_on",
            ball_transition=None,
            ball_active_now=False,
            motion_ratio=0.0,
            candidate_count=0,
        )
        self.assertEqual([event.event for event in events], ["light_on", "session_start"])

        events, _ = detector._apply(
            camera_id=2,
            mapping=mapping,
            now=now + timedelta(seconds=1),
            light_transition="light_off",
            ball_transition=None,
            ball_active_now=False,
            motion_ratio=0.0,
            candidate_count=0,
        )
        self.assertEqual([event.event for event in events], ["light_off", "session_end"])

    def test_frame_setup_then_first_shot_starts_break(self) -> None:
        detector = TableEventDetector(
            frame_setup_idle_seconds=5.0,
            session_idle_seconds=120.0,
        )
        mapping = self._mapping()
        now = datetime(2026, 4, 23, 12, 10, tzinfo=timezone.utc)

        detector._apply(
            camera_id=2,
            mapping=mapping,
            now=now,
            light_transition="light_on",
            ball_transition=None,
            ball_active_now=False,
            motion_ratio=0.0,
            candidate_count=0,
        )
        events, _ = detector._apply(
            camera_id=2,
            mapping=mapping,
            now=now + timedelta(seconds=6),
            light_transition=None,
            ball_transition=None,
            ball_active_now=False,
            motion_ratio=0.0,
            candidate_count=0,
        )
        self.assertIn("frame_setup_start", [event.event for event in events])

        events, _ = detector._apply(
            camera_id=2,
            mapping=mapping,
            now=now + timedelta(seconds=7),
            light_transition=None,
            ball_transition="ball_motion_start",
            ball_active_now=True,
            motion_ratio=0.01,
            candidate_count=2,
        )
        self.assertEqual(
            [event.event for event in events],
            ["shot_start", "frame_setup_end", "break_start"],
        )

    def test_ball_motion_end_emits_shot_end(self) -> None:
        detector = TableEventDetector(
            frame_setup_idle_seconds=5.0,
            session_idle_seconds=120.0,
            min_shot_active_seconds=0.0,
            min_shot_peak_motion_ratio=0.0,
            min_shot_peak_candidate_count=1,
        )
        mapping = self._mapping()
        now = datetime(2026, 4, 23, 12, 20, tzinfo=timezone.utc)

        detector._apply(
            camera_id=2,
            mapping=mapping,
            now=now,
            light_transition="light_on",
            ball_transition="ball_motion_start",
            ball_active_now=True,
            motion_ratio=0.02,
            candidate_count=2,
        )
        events, _ = detector._apply(
            camera_id=2,
            mapping=mapping,
            now=now + timedelta(seconds=2),
            light_transition=None,
            ball_transition="ball_motion_end",
            ball_active_now=False,
            motion_ratio=0.0,
            candidate_count=0,
        )
        self.assertIn("shot_end", [event.event for event in events])
        self.assertIn("shot", [event.event for event in events])
        summary = [event for event in events if event.event == "shot"][0]
        self.assertIsNotNone(summary.shot_start_at)
        self.assertIsNotNone(summary.shot_end_at)
        self.assertIsNotNone(summary.duration_seconds)
        self.assertTrue(summary.light_on)

    def test_can_require_object_evidence_for_shot_summary(self) -> None:
        detector = TableEventDetector(
            frame_setup_idle_seconds=5.0,
            session_idle_seconds=120.0,
            min_shot_active_seconds=0.0,
            min_shot_peak_motion_ratio=0.0,
            min_shot_peak_candidate_count=1,
            require_object_evidence_for_shot=True,
        )
        mapping = self._mapping()
        now = datetime(2026, 4, 23, 12, 25, tzinfo=timezone.utc)

        detector._apply(
            camera_id=2,
            mapping=mapping,
            now=now,
            light_transition="light_on",
            ball_transition="ball_motion_start",
            ball_active_now=True,
            motion_ratio=0.02,
            candidate_count=2,
            object_evidence=ObjectEvidence(
                available=True,
                person_count=1,
                cue_count=1,
                ball_count=3,
                cue_near_ball=False,
                confidence=0.9,
            ),
        )
        events, _ = detector._apply(
            camera_id=2,
            mapping=mapping,
            now=now + timedelta(seconds=1),
            light_transition=None,
            ball_transition="ball_motion_end",
            ball_active_now=False,
            motion_ratio=0.0,
            candidate_count=0,
            object_evidence=ObjectEvidence(
                available=True,
                person_count=1,
                cue_count=1,
                ball_count=3,
                cue_near_ball=False,
                confidence=0.9,
            ),
        )
        self.assertIn("shot_end", [event.event for event in events])
        self.assertNotIn("shot", [event.event for event in events])


if __name__ == "__main__":
    unittest.main()

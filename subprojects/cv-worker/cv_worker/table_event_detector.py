from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from .ball_detector import BallDetector, BallDebug, BallEvent
from .config import CameraConfig, MappingConfig
from .light_detector import LightDetector, LightEvent
from .object_detector import ObjectDetector, ObjectEvidence


@dataclass
class _TableState:
    light_on: bool | None = None
    light_on_since: datetime | None = None
    session_running: bool = False
    frame_setup_running: bool = False
    break_running: bool = False
    shot_running: bool = False
    shot_started_at: datetime | None = None
    shot_peak_motion_ratio: float = 0.0
    shot_peak_candidate_count: int = 0
    last_shot_end_at: datetime | None = None
    last_ball_active_at: datetime | None = None


@dataclass(frozen=True)
class TableEvent:
    camera_id: int
    table_id: int
    table_name: str | None
    detection_type: str
    event: str
    event_at: datetime
    confidence: float
    reason: str
    motion_ratio: float
    candidate_count: int
    shot_start_at: datetime | None = None
    shot_end_at: datetime | None = None
    light_on: bool | None = None
    duration_seconds: float | None = None
    peak_motion_ratio: float | None = None
    peak_candidate_count: int | None = None
    person_count: int | None = None
    cue_count: int | None = None
    ball_count: int | None = None
    cue_near_ball: bool | None = None
    object_confidence: float | None = None


@dataclass(frozen=True)
class TableDebug:
    camera_id: int
    table_id: int
    table_name: str | None
    detection_type: str
    light_on: bool | None
    session_running: bool
    frame_setup_running: bool
    break_running: bool
    shot_running: bool
    ball_active_now: bool
    motion_ratio: float
    candidate_count: int
    idle_seconds: float | None
    object_available: bool
    person_count: int
    cue_count: int
    ball_count: int
    cue_near_ball: bool
    object_confidence: float


class TableEventDetector:
    def __init__(
        self,
        *,
        light_confirm_seconds: float = 2.0,
        ball_idle_seconds: float = 2.0,
        frame_setup_idle_seconds: float = 20.0,
        session_idle_seconds: float = 900.0,
        min_shot_active_seconds: float = 0.25,
        min_shot_peak_motion_ratio: float = 0.0012,
        min_shot_peak_candidate_count: int = 1,
        enable_object_evidence: bool = False,
        require_object_evidence_for_shot: bool = False,
        object_model_path: str | None = None,
        object_confidence: float = 0.25,
        cue_ball_near_px: float = 48.0,
    ) -> None:
        self._light_detector = LightDetector(
            light_memory_path=None,
            min_state_confirm_seconds=light_confirm_seconds,
            min_event_interval_seconds=0.0,
            enable_bootstrap=True,
            update_levels=False,
        )
        self._ball_detector = BallDetector(
            idle_seconds=ball_idle_seconds,
            min_event_interval_seconds=0.0,
        )
        self._object_detector = ObjectDetector(
            mode="auto" if enable_object_evidence else "off",
            model_path=object_model_path,
            confidence=object_confidence,
            cue_ball_near_px=cue_ball_near_px,
        )
        self._states: dict[tuple[int, int], _TableState] = {}
        self._frame_setup_idle_seconds = max(2.0, frame_setup_idle_seconds)
        self._session_idle_seconds = max(30.0, session_idle_seconds)
        self._min_shot_active_seconds = max(0.0, min_shot_active_seconds)
        self._min_shot_peak_motion_ratio = max(0.0, min_shot_peak_motion_ratio)
        self._min_shot_peak_candidate_count = max(1, min_shot_peak_candidate_count)
        self._require_object_evidence_for_shot = require_object_evidence_for_shot

    @staticmethod
    def _emit(
        *,
        camera_id: int,
        mapping: MappingConfig,
        event: str,
        now: datetime,
        confidence: float,
        reason: str,
        motion_ratio: float,
        candidate_count: int,
        shot_start_at: datetime | None = None,
        shot_end_at: datetime | None = None,
        light_on: bool | None = None,
        duration_seconds: float | None = None,
        peak_motion_ratio: float | None = None,
        peak_candidate_count: int | None = None,
        object_evidence: ObjectEvidence | None = None,
    ) -> TableEvent:
        person_count = None if object_evidence is None else object_evidence.person_count
        cue_count = None if object_evidence is None else object_evidence.cue_count
        ball_count = None if object_evidence is None else object_evidence.ball_count
        cue_near_ball = None if object_evidence is None else object_evidence.cue_near_ball
        object_conf = None if object_evidence is None else object_evidence.confidence
        return TableEvent(
            camera_id=camera_id,
            table_id=mapping.table_id,
            table_name=mapping.table_name,
            detection_type=mapping.detection_type,
            event=event,
            event_at=now,
            confidence=max(0.0, min(1.0, confidence)),
            reason=reason,
            motion_ratio=motion_ratio,
            candidate_count=candidate_count,
            shot_start_at=shot_start_at,
            shot_end_at=shot_end_at,
            light_on=light_on,
            duration_seconds=duration_seconds,
            peak_motion_ratio=peak_motion_ratio,
            peak_candidate_count=peak_candidate_count,
            person_count=person_count,
            cue_count=cue_count,
            ball_count=ball_count,
            cue_near_ball=cue_near_ball,
            object_confidence=object_conf,
        )

    def _apply(
        self,
        *,
        camera_id: int,
        mapping: MappingConfig,
        now: datetime,
        light_transition: str | None,
        ball_transition: str | None,
        ball_active_now: bool,
        motion_ratio: float,
        candidate_count: int,
        object_evidence: ObjectEvidence | None = None,
    ) -> tuple[list[TableEvent], TableDebug]:
        state = self._states.setdefault((camera_id, mapping.id), _TableState())
        events: list[TableEvent] = []

        if ball_active_now:
            state.last_ball_active_at = now
            if state.shot_running:
                state.shot_peak_motion_ratio = max(state.shot_peak_motion_ratio, motion_ratio)
                state.shot_peak_candidate_count = max(state.shot_peak_candidate_count, candidate_count)

        if light_transition == "light_on":
            state.light_on = True
            state.light_on_since = now
            events.append(
                self._emit(
                    camera_id=camera_id,
                    mapping=mapping,
                    event="light_on",
                    now=now,
                    confidence=0.95,
                    reason="light_detector",
                    motion_ratio=motion_ratio,
                    candidate_count=candidate_count,
                    object_evidence=object_evidence,
                )
            )
            if not state.session_running:
                state.session_running = True
                events.append(
                    self._emit(
                        camera_id=camera_id,
                        mapping=mapping,
                        event="session_start",
                        now=now,
                        confidence=0.9,
                        reason="light_on",
                        motion_ratio=motion_ratio,
                        candidate_count=candidate_count,
                        object_evidence=object_evidence,
                    )
                )
        elif light_transition == "light_off":
            state.light_on = False
            events.append(
                self._emit(
                    camera_id=camera_id,
                    mapping=mapping,
                    event="light_off",
                    now=now,
                    confidence=0.95,
                    reason="light_detector",
                    motion_ratio=motion_ratio,
                    candidate_count=candidate_count,
                    object_evidence=object_evidence,
                )
            )
            if state.shot_running:
                state.shot_running = False
                state.last_shot_end_at = now
                events.append(
                    self._emit(
                        camera_id=camera_id,
                        mapping=mapping,
                        event="shot_end",
                        now=now,
                        confidence=0.75,
                        reason="light_off_forced_end",
                        motion_ratio=motion_ratio,
                        candidate_count=candidate_count,
                        object_evidence=object_evidence,
                    )
                )
            if state.break_running:
                state.break_running = False
                events.append(
                    self._emit(
                        camera_id=camera_id,
                        mapping=mapping,
                        event="break_end",
                        now=now,
                        confidence=0.8,
                        reason="light_off",
                        motion_ratio=motion_ratio,
                        candidate_count=candidate_count,
                        object_evidence=object_evidence,
                    )
                )
            if state.frame_setup_running:
                state.frame_setup_running = False
                events.append(
                    self._emit(
                        camera_id=camera_id,
                        mapping=mapping,
                        event="frame_setup_end",
                        now=now,
                        confidence=0.8,
                        reason="light_off",
                        motion_ratio=motion_ratio,
                        candidate_count=candidate_count,
                        object_evidence=object_evidence,
                    )
                )
            if state.session_running:
                state.session_running = False
                events.append(
                    self._emit(
                        camera_id=camera_id,
                        mapping=mapping,
                        event="session_end",
                        now=now,
                        confidence=0.9,
                        reason="light_off",
                        motion_ratio=motion_ratio,
                        candidate_count=candidate_count,
                        object_evidence=object_evidence,
                    )
                )

        if ball_transition == "ball_motion_start" and state.light_on:
            if not state.shot_running:
                state.shot_running = True
                state.shot_started_at = now
                state.shot_peak_motion_ratio = motion_ratio
                state.shot_peak_candidate_count = candidate_count
                events.append(
                    self._emit(
                        camera_id=camera_id,
                        mapping=mapping,
                        event="shot_start",
                        now=now,
                        confidence=0.65,
                        reason="ball_motion_start",
                        motion_ratio=motion_ratio,
                        candidate_count=candidate_count,
                        light_on=state.light_on,
                        object_evidence=object_evidence,
                    )
                )
            if state.frame_setup_running:
                state.frame_setup_running = False
                events.append(
                    self._emit(
                        camera_id=camera_id,
                        mapping=mapping,
                        event="frame_setup_end",
                        now=now,
                        confidence=0.75,
                        reason="shot_started",
                        motion_ratio=motion_ratio,
                        candidate_count=candidate_count,
                        object_evidence=object_evidence,
                    )
                )
                if not state.break_running:
                    state.break_running = True
                    events.append(
                        self._emit(
                            camera_id=camera_id,
                            mapping=mapping,
                            event="break_start",
                            now=now,
                            confidence=0.8,
                            reason="first_shot_after_frame_setup",
                            motion_ratio=motion_ratio,
                            candidate_count=candidate_count,
                            object_evidence=object_evidence,
                        )
                    )
            if not state.session_running:
                state.session_running = True
                events.append(
                    self._emit(
                        camera_id=camera_id,
                        mapping=mapping,
                        event="session_start",
                        now=now,
                        confidence=0.75,
                        reason="shot_start_without_light_event",
                        motion_ratio=motion_ratio,
                        candidate_count=candidate_count,
                        object_evidence=object_evidence,
                    )
                )

        if ball_transition == "ball_motion_end" and state.shot_running:
            state.shot_running = False
            state.last_shot_end_at = now
            shot_start_at = state.shot_started_at
            shot_end_at = now
            duration_seconds = None
            if shot_start_at is not None:
                duration_seconds = max(0.0, (shot_end_at - shot_start_at).total_seconds())
            events.append(
                self._emit(
                    camera_id=camera_id,
                    mapping=mapping,
                    event="shot_end",
                    now=now,
                    confidence=0.7,
                    reason="balls_stopped",
                    motion_ratio=motion_ratio,
                    candidate_count=candidate_count,
                    shot_start_at=shot_start_at,
                    shot_end_at=shot_end_at,
                    light_on=state.light_on,
                    duration_seconds=duration_seconds,
                    peak_motion_ratio=state.shot_peak_motion_ratio,
                    peak_candidate_count=state.shot_peak_candidate_count,
                    object_evidence=object_evidence,
                )
            )
            object_ok = True
            if object_evidence is not None and object_evidence.available:
                object_ok = (
                    object_evidence.person_count > 0
                    and object_evidence.ball_count > 0
                    and object_evidence.cue_near_ball
                )
            is_valid_shot = (
                duration_seconds is not None
                and duration_seconds >= self._min_shot_active_seconds
                and state.shot_peak_motion_ratio >= self._min_shot_peak_motion_ratio
                and state.shot_peak_candidate_count >= self._min_shot_peak_candidate_count
                and (object_ok or not self._require_object_evidence_for_shot)
            )
            if is_valid_shot:
                summary_confidence = min(
                    1.0,
                    0.35
                    + (state.shot_peak_motion_ratio / max(0.005, self._min_shot_peak_motion_ratio) * 0.2)
                    + (state.shot_peak_candidate_count * 0.08),
                )
                if object_ok and object_evidence is not None and object_evidence.available:
                    summary_confidence = min(1.0, summary_confidence + 0.15)
                events.append(
                    self._emit(
                        camera_id=camera_id,
                        mapping=mapping,
                        event="shot",
                        now=shot_end_at,
                        confidence=summary_confidence,
                        reason="shot_window_closed",
                        motion_ratio=state.shot_peak_motion_ratio,
                        candidate_count=state.shot_peak_candidate_count,
                        shot_start_at=shot_start_at,
                        shot_end_at=shot_end_at,
                        light_on=state.light_on,
                        duration_seconds=duration_seconds,
                        peak_motion_ratio=state.shot_peak_motion_ratio,
                        peak_candidate_count=state.shot_peak_candidate_count,
                        object_evidence=object_evidence,
                    )
                )
            state.shot_started_at = None
            state.shot_peak_motion_ratio = 0.0
            state.shot_peak_candidate_count = 0

        idle_seconds = None
        if state.last_ball_active_at is not None:
            idle_seconds = max(0.0, (now - state.last_ball_active_at).total_seconds())

        if state.light_on and not state.shot_running:
            reference = state.last_shot_end_at or state.light_on_since
            if reference is not None:
                quiet_for = (now - reference).total_seconds()
                if quiet_for >= self._frame_setup_idle_seconds and not state.frame_setup_running:
                    if state.break_running:
                        state.break_running = False
                        events.append(
                            self._emit(
                                camera_id=camera_id,
                                mapping=mapping,
                                event="break_end",
                                now=now,
                                confidence=0.7,
                                reason="new_frame_setup_detected",
                                motion_ratio=motion_ratio,
                                candidate_count=candidate_count,
                                object_evidence=object_evidence,
                            )
                        )
                    state.frame_setup_running = True
                    events.append(
                        self._emit(
                            camera_id=camera_id,
                            mapping=mapping,
                            event="frame_setup_start",
                            now=now,
                            confidence=0.7,
                            reason="table_stable_idle",
                            motion_ratio=motion_ratio,
                            candidate_count=candidate_count,
                            object_evidence=object_evidence,
                        )
                    )

        if state.session_running and state.light_on and not state.shot_running and idle_seconds is not None:
            if idle_seconds >= self._session_idle_seconds:
                if state.break_running:
                    state.break_running = False
                    events.append(
                        self._emit(
                            camera_id=camera_id,
                            mapping=mapping,
                            event="break_end",
                            now=now,
                            confidence=0.65,
                            reason="session_idle_timeout",
                            motion_ratio=motion_ratio,
                            candidate_count=candidate_count,
                            object_evidence=object_evidence,
                        )
                    )
                if state.frame_setup_running:
                    state.frame_setup_running = False
                    events.append(
                        self._emit(
                            camera_id=camera_id,
                            mapping=mapping,
                            event="frame_setup_end",
                            now=now,
                            confidence=0.65,
                            reason="session_idle_timeout",
                            motion_ratio=motion_ratio,
                            candidate_count=candidate_count,
                            object_evidence=object_evidence,
                        )
                    )
                state.session_running = False
                events.append(
                    self._emit(
                        camera_id=camera_id,
                        mapping=mapping,
                        event="session_end",
                        now=now,
                        confidence=0.75,
                        reason="session_idle_timeout",
                        motion_ratio=motion_ratio,
                        candidate_count=candidate_count,
                        object_evidence=object_evidence,
                    )
                )

        debug_object = object_evidence or ObjectEvidence(
            available=False,
            person_count=0,
            cue_count=0,
            ball_count=0,
            cue_near_ball=False,
            confidence=0.0,
        )
        debug = TableDebug(
            camera_id=camera_id,
            table_id=mapping.table_id,
            table_name=mapping.table_name,
            detection_type=mapping.detection_type,
            light_on=state.light_on,
            session_running=state.session_running,
            frame_setup_running=state.frame_setup_running,
            break_running=state.break_running,
            shot_running=state.shot_running,
            ball_active_now=ball_active_now,
            motion_ratio=motion_ratio,
            candidate_count=candidate_count,
            idle_seconds=idle_seconds,
            object_available=debug_object.available,
            person_count=debug_object.person_count,
            cue_count=debug_object.cue_count,
            ball_count=debug_object.ball_count,
            cue_near_ball=debug_object.cue_near_ball,
            object_confidence=debug_object.confidence,
        )
        return events, debug

    def process_frame(self, camera: CameraConfig, frame) -> tuple[list[TableEvent], list[TableDebug]]:
        now = datetime.now(timezone.utc)
        mapping_by_table_id = {mapping.table_id: mapping for mapping in camera.mappings if mapping.enabled}

        light_events = self._light_detector.process_frame(camera, frame)
        ball_events, ball_debug_rows = self._ball_detector.process_frame(camera, frame)
        object_evidence_by_table_id = self._object_detector.process_frame(camera, frame)

        light_transition_by_table_id: dict[int, LightEvent] = {}
        for row in light_events:
            light_transition_by_table_id[row.table_id] = row

        ball_transition_by_table_id: dict[int, BallEvent] = {}
        for row in ball_events:
            ball_transition_by_table_id[row.table_id] = row

        ball_debug_by_table_id: dict[int, BallDebug] = {}
        for row in ball_debug_rows:
            ball_debug_by_table_id[row.table_id] = row

        events: list[TableEvent] = []
        debug_rows: list[TableDebug] = []
        for table_id, mapping in mapping_by_table_id.items():
            light_transition = None
            if table_id in light_transition_by_table_id:
                light_transition = light_transition_by_table_id[table_id].event

            ball_transition = None
            if table_id in ball_transition_by_table_id:
                ball_transition = ball_transition_by_table_id[table_id].event

            ball_debug = ball_debug_by_table_id.get(table_id)
            ball_active_now = False
            motion_ratio = 0.0
            candidate_count = 0
            if ball_debug is not None:
                ball_active_now = bool(ball_debug.active_now)
                motion_ratio = float(ball_debug.motion_ratio)
                candidate_count = int(ball_debug.candidate_count)

            mapping_events, debug = self._apply(
                camera_id=camera.id,
                mapping=mapping,
                now=now,
                light_transition=light_transition,
                ball_transition=ball_transition,
                ball_active_now=ball_active_now,
                motion_ratio=motion_ratio,
                candidate_count=candidate_count,
                object_evidence=object_evidence_by_table_id.get(table_id),
            )
            events.extend(mapping_events)
            debug_rows.append(debug)

        return events, debug_rows

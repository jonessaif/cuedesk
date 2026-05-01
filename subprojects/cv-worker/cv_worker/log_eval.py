from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class RuleResult:
    ok: bool
    message: str


@dataclass(frozen=True)
class ScenarioResult:
    name: str
    passed: bool
    details: tuple[str, ...]


def _load_json(path: str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_event_rows(path: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("kind") != "event":
            continue
        rows.append(payload)
    return rows


def load_expectations(path: str) -> dict[str, Any]:
    payload = _load_json(path)
    if not isinstance(payload, dict):
        raise ValueError("Expectations file must be a JSON object")
    scenarios = payload.get("scenarios")
    if not isinstance(scenarios, list) or len(scenarios) == 0:
        raise ValueError("Expectations file must include non-empty 'scenarios' list")
    return payload


def _event_matches(event: dict[str, Any], matcher: dict[str, Any]) -> bool:
    for field in ("tableName", "tableId", "cameraId", "detectionType", "event"):
        if field in matcher and matcher[field] != event.get(field):
            return False
    return True


def _filter_by_loop_range(
    events: list[dict[str, Any]],
    loop_start: int | None,
    loop_end: int | None,
) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for event in events:
        loop = event.get("loop")
        if not isinstance(loop, int):
            continue
        if loop_start is not None and loop < loop_start:
            continue
        if loop_end is not None and loop > loop_end:
            continue
        result.append(event)
    return result


def _evaluate_required_rule(events: list[dict[str, Any]], rule: dict[str, Any]) -> RuleResult:
    matched = [event for event in events if _event_matches(event, rule)]
    count = len(matched)

    expected_exact = rule.get("exactCount")
    min_count = rule.get("minCount", 1)
    max_count = rule.get("maxCount")
    min_first_loop = rule.get("minFirstLoop")
    max_first_loop = rule.get("maxFirstLoop")

    label = ", ".join(f"{k}={rule[k]}" for k in ("tableName", "tableId", "cameraId", "event") if k in rule)
    if expected_exact is not None and count != expected_exact:
        return RuleResult(False, f"required[{label}] expected exactCount={expected_exact}, got {count}")
    if count < min_count:
        return RuleResult(False, f"required[{label}] expected minCount={min_count}, got {count}")
    if max_count is not None and count > max_count:
        return RuleResult(False, f"required[{label}] expected maxCount={max_count}, got {count}")

    if count > 0:
        first_loop = min(int(event["loop"]) for event in matched if isinstance(event.get("loop"), int))
        if min_first_loop is not None and first_loop < min_first_loop:
            return RuleResult(False, f"required[{label}] first loop {first_loop} < minFirstLoop={min_first_loop}")
        if max_first_loop is not None and first_loop > max_first_loop:
            return RuleResult(False, f"required[{label}] first loop {first_loop} > maxFirstLoop={max_first_loop}")

    return RuleResult(True, f"required[{label}] ok (count={count})")


def _evaluate_forbidden_rule(events: list[dict[str, Any]], rule: dict[str, Any]) -> RuleResult:
    matched = [event for event in events if _event_matches(event, rule)]
    count = len(matched)
    label = ", ".join(f"{k}={rule[k]}" for k in ("tableName", "tableId", "cameraId", "event") if k in rule)
    if count > 0:
        return RuleResult(False, f"forbidden[{label}] expected 0, got {count}")
    return RuleResult(True, f"forbidden[{label}] ok")


def evaluate_scenarios(
    events: list[dict[str, Any]],
    expectations: dict[str, Any],
    only_scenario: str | None = None,
) -> list[ScenarioResult]:
    results: list[ScenarioResult] = []
    for raw_scenario in expectations["scenarios"]:
        name = raw_scenario.get("name")
        if not isinstance(name, str) or name.strip() == "":
            raise ValueError("Each scenario must include a non-empty 'name'")
        if only_scenario is not None and name != only_scenario:
            continue

        loop_start = raw_scenario.get("loopStart")
        loop_end = raw_scenario.get("loopEnd")
        scoped_events = _filter_by_loop_range(events, loop_start, loop_end)

        details: list[str] = [f"events-in-range={len(scoped_events)} (loopStart={loop_start}, loopEnd={loop_end})"]
        passed = True

        for rule in raw_scenario.get("mustContain", []):
            result = _evaluate_required_rule(scoped_events, rule)
            details.append(result.message)
            passed = passed and result.ok

        for rule in raw_scenario.get("mustNotContain", []):
            result = _evaluate_forbidden_rule(scoped_events, rule)
            details.append(result.message)
            passed = passed and result.ok

        results.append(ScenarioResult(name=name, passed=passed, details=tuple(details)))
    return results


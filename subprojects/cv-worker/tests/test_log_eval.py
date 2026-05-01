from __future__ import annotations

import unittest

from cv_worker.log_eval import evaluate_scenarios


class LogEvalTests(unittest.TestCase):
    def test_passes_when_expected_events_present_and_forbidden_absent(self) -> None:
        events = [
            {"loop": 40, "tableName": "S2", "event": "start"},
            {"loop": 150, "tableName": "S1", "event": "start"},
        ]
        expectations = {
            "scenarios": [
                {
                    "name": "baseline",
                    "loopStart": 1,
                    "loopEnd": 200,
                    "mustContain": [
                        {"tableName": "S1", "event": "start", "minCount": 1, "maxFirstLoop": 200},
                        {"tableName": "S2", "event": "start", "minCount": 1, "maxFirstLoop": 200},
                    ],
                    "mustNotContain": [
                        {"tableName": "AP", "event": "start"},
                    ],
                }
            ]
        }
        results = evaluate_scenarios(events, expectations)
        self.assertEqual(len(results), 1)
        self.assertTrue(results[0].passed)

    def test_fails_when_forbidden_event_present(self) -> None:
        events = [
            {"loop": 40, "tableName": "AP", "event": "start"},
        ]
        expectations = {
            "scenarios": [
                {
                    "name": "pool_should_stay_idle",
                    "mustNotContain": [
                        {"tableName": "AP", "event": "start"},
                    ],
                }
            ]
        }
        results = evaluate_scenarios(events, expectations)
        self.assertEqual(len(results), 1)
        self.assertFalse(results[0].passed)


if __name__ == "__main__":
    unittest.main()


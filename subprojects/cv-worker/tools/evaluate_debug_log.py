from __future__ import annotations

import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from cv_worker.log_eval import evaluate_scenarios, load_event_rows, load_expectations


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Evaluate cv-worker debug JSONL against scenario expectations")
    parser.add_argument("--log", required=True, help="Path to cv-worker-debug.jsonl")
    parser.add_argument("--expectations", required=True, help="Path to scenario expectations JSON")
    parser.add_argument("--scenario", default=None, help="Run only one named scenario")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    events = load_event_rows(args.log)
    expectations = load_expectations(args.expectations)
    results = evaluate_scenarios(events, expectations, only_scenario=args.scenario)
    if len(results) == 0:
        print("No scenarios matched the provided filters.")
        return 2

    all_passed = True
    for result in results:
        status = "PASS" if result.passed else "FAIL"
        print(f"\n[{status}] {result.name}")
        for detail in result.details:
            print(f"  - {detail}")
        all_passed = all_passed and result.passed

    print(f"\nSummary: {sum(1 for r in results if r.passed)}/{len(results)} scenarios passed")
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(main())

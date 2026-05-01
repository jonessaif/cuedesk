from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from cv_worker.config import load_worker_config


class ConfigLoadTests(unittest.TestCase):
    def test_loads_standard_roi_points(self) -> None:
        payload = {
            "cameras": [
                {
                    "id": 1,
                    "name": "Cam A",
                    "url": "rtsp://127.0.0.1:8554/test",
                    "enabled": True,
                    "mappings": [
                        {
                            "id": 10,
                            "tableId": 2,
                            "tableName": "Table 2",
                            "detectionType": "snooker",
                            "enabled": True,
                            "roi": {
                                "points": [[10, 10], [110, 10], [110, 50], [10, 50]],
                                "bbox": {"x": 10, "y": 10, "width": 100, "height": 40},
                                "coordinateSpace": "pixels",
                                "sourceResolution": {"width": 1024, "height": 576},
                            },
                        }
                    ],
                }
            ]
        }

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            config = load_worker_config(path)

        self.assertEqual(len(config.cameras), 1)
        self.assertEqual(config.cameras[0].id, 1)
        self.assertEqual(len(config.cameras[0].mappings), 1)
        self.assertEqual(config.cameras[0].mappings[0].roi_points[0], (10.0, 10.0))
        self.assertEqual(config.cameras[0].mappings[0].table_name, "Table 2")
        self.assertEqual(config.cameras[0].mappings[0].roi_space, (1024, 576))


if __name__ == "__main__":
    unittest.main()

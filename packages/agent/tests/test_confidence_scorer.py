import tempfile
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[3]
AGENT_ROOT = REPO_ROOT / "packages" / "agent"
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from confidence_scorer import score_detection_payload, score_player_detection
from learning_store import LearningStore


class ConfidenceScorerTests(unittest.TestCase):
    def test_named_profile_scores_high_confidence_and_stable_instance_id(self) -> None:
        player = {
            "player_id": "studio-a-playbox-1",
            "playout_type": "playbox_neo",
            "running": True,
            "paths": {
                "install_dir": r"C:\Program Files\PlayBox Neo",
                "log_path": r"C:\ProgramData\PlayBox\Logs\AsRun.log",
            },
            "process_selectors": {
                "process_names": ["AirBox.exe"],
                "executable_path_contains": [r"C:\Program Files\PlayBox Neo\AirBox.exe"],
                "command_line_contains": ["--channel=1 --service=playout"],
                "service_names": ["PlayBoxAirBoxChannel1"],
                "service_display_name_contains": ["PlayBox AirBox Channel 1"],
                "window_title_contains": ["PlayBox AirBox Channel 1"],
            },
            "log_selectors": {
                "include_contains": ["AirBox", "AsRun"],
                "token_patterns": ["PLAYING", "ON AIR"],
            },
            "discovery": {
                "confidence": 0.72,
                "evidence": [
                    "Registry uninstall entry: PlayBox Neo",
                    "Window title: PlayBox AirBox Channel 1",
                ],
            },
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            store = LearningStore(Path(temp_dir) / "learned.db")
            first = score_player_detection(player, learning_store=store)
            second = score_player_detection(player, learning_store=store)

        self.assertGreaterEqual(first["confidence"], 0.85)
        self.assertEqual(first["confidence_band"], "high")
        self.assertFalse(first["needs_confirmation"])
        self.assertEqual(first["instance_id"], second["instance_id"])
        self.assertIn("Channel 1", first["suggested_label"])

    def test_generic_edge_case_stays_confirmation_required(self) -> None:
        payload = {
            "players": [
                {
                    "player_id": "studio-a-generic-1",
                    "playout_type": "generic_windows",
                    "running": True,
                    "paths": {
                        "install_dir": r"C:\Program Files\AcmeCorp\BroadcastServer",
                    },
                    "process_selectors": {
                        "process_names": ["BroadcastServer.exe"],
                    },
                    "log_selectors": {},
                    "discovery": {
                        "confidence": 0.28,
                        "evidence": ["Running process: BroadcastServer.exe"],
                    },
                }
            ]
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            result = score_detection_payload(payload, db_path=Path(temp_dir) / "learned.db")

        self.assertEqual(result["summary"]["total"], 1)
        self.assertEqual(result["summary"]["needs_confirmation"], 1)
        detection = result["detections"][0]
        self.assertTrue(detection["needs_confirmation"])
        self.assertLess(detection["confidence"], 0.85)
        self.assertIn(detection["confidence_band"], {"low", "medium"})

    def test_instance_id_prefers_instance_specific_paths_over_shared_process_name(self) -> None:
        first_player = {
            "player_id": "node-insta-1",
            "playout_type": "insta",
            "running": True,
            "paths": {
                "instance_root": r"C:\Program Files\Indytek\Insta Playout\Settings",
            },
            "process_selectors": {
                "process_names": ["Insta Playout.exe"],
                "executable_path_contains": [r"C:\Program Files\Indytek\Insta Playout.exe"],
            },
            "discovery": {
                "confidence": 0.9,
                "evidence": ["Instance root: C:\\Program Files\\Indytek\\Insta Playout\\Settings"],
            },
        }
        second_player = {
            "player_id": "node-insta-2",
            "playout_type": "insta",
            "running": False,
            "paths": {
                "instance_root": r"C:\Program Files\Indytek\Insta Playout 2\Settings",
            },
            "process_selectors": {
                "process_names": ["Insta Playout.exe"],
                "executable_path_contains": [r"C:\Program Files\Indytek\Insta Playout.exe"],
            },
            "discovery": {
                "confidence": 0.86,
                "evidence": ["Instance root: C:\\Program Files\\Indytek\\Insta Playout 2\\Settings"],
            },
        }

        first_detection = score_player_detection(first_player)
        second_detection = score_player_detection(second_player)

        self.assertNotEqual(first_detection["instance_id"], second_detection["instance_id"])


if __name__ == "__main__":
    unittest.main()

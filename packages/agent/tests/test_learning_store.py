import tempfile
import unittest
from pathlib import Path
import sys


REPO_ROOT = Path(__file__).resolve().parents[3]
AGENT_ROOT = REPO_ROOT / "packages" / "agent"
if str(AGENT_ROOT) not in sys.path:
    sys.path.insert(0, str(AGENT_ROOT))

from learning_store import LearningStore, fingerprint_hash_for_evidence


class LearningStoreTests(unittest.TestCase):
    def test_save_query_and_export_confirmation(self) -> None:
        evidence = {
            "playout_type": "playbox_neo",
            "label": "PlayBox AirBox Channel 7",
            "paths": {
                "install_dir": r"C:\Program Files\PlayBox Neo",
                "log_path": r"C:\ProgramData\PlayBox\Logs\AsRun.log",
            },
            "process_selectors": {
                "process_names": ["AirBox.exe"],
                "command_line_contains": ["--channel=7 --service=playout"],
                "service_names": ["PlayBoxAirBoxChannel7"],
            },
            "discovery": {
                "evidence": ["Registry uninstall entry: PlayBox Neo"],
            },
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = Path(temp_dir) / "learned.db"
            store = LearningStore(db_path)
            fingerprint_hash = store.save_confirmation(
                "playbox_neo",
                "PlayBox AirBox Channel 7",
                evidence,
                confirmed_by="qa@example.com",
            )

            query_results = store.query_by_evidence(evidence)
            exported = store.export_for_hub_sync()

        self.assertEqual(fingerprint_hash, fingerprint_hash_for_evidence(evidence))
        self.assertEqual(len(query_results), 1)
        self.assertEqual(query_results[0]["instance_label"], "PlayBox AirBox Channel 7")
        self.assertEqual(query_results[0]["confirmed_by"], "qa@example.com")
        self.assertEqual(len(exported), 1)
        self.assertEqual(exported[0]["fingerprint_hash"], fingerprint_hash)


if __name__ == "__main__":
    unittest.main()

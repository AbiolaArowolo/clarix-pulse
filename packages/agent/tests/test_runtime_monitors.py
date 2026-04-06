import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

AGENT_DIR = Path(__file__).resolve().parents[1]
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from monitors import file_monitor, process_monitor  # noqa: E402


class FileMonitorTests(unittest.TestCase):
    def setUp(self) -> None:
        file_monitor._prev_position.clear()
        file_monitor._prev_position_30s_ts.clear()
        file_monitor._prev_position_60s.clear()
        file_monitor._prev_position_60s_ts.clear()
        file_monitor._prev_position_poll.clear()
        file_monitor._prev_file_mtime.clear()
        file_monitor._last_fnf_size.clear()
        file_monitor._last_playlistscan_size.clear()
        if hasattr(file_monitor, "_static_position_polls"):
            file_monitor._static_position_polls.clear()

    def test_reports_static_position_polls_for_native_runtime_files(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            instance_root = Path(temp_dir)
            (instance_root / "filebar.txt").write_text('{"FilePosition": 123}', encoding="utf-8")

            first = file_monitor.check("studio-a-insta-1", "insta", {"instance_root": str(instance_root)})
            second = file_monitor.check("studio-a-insta-1", "insta", {"instance_root": str(instance_root)})
            third = file_monitor.check("studio-a-insta-1", "insta", {"instance_root": str(instance_root)})

        self.assertEqual(first["position_signal_present"], 1)
        self.assertEqual(first["position_static_polls"], 0)
        self.assertEqual(second["position_static_polls"], 1)
        self.assertEqual(third["position_static_polls"], 2)


class ProcessSelectorTests(unittest.TestCase):
    def test_matches_executable_path_and_command_line_selectors(self) -> None:
        metadata = {
            "name": "PlayoutApp.exe",
            "executable_path": r"C:\Broadcast\Channel 2\PlayoutApp.exe",
            "command_line": r"\"C:\Broadcast\Channel 2\PlayoutApp.exe\" --channel=2 --profile=air",
        }

        self.assertTrue(
            process_monitor._matches_process_metadata(
                metadata,
                {
                    "process_names": ["PlayoutApp.exe"],
                    "executable_path_contains": [r"Channel 2"],
                    "command_line_contains": ["--channel=2"],
                },
                "generic_windows",
            )
        )
        self.assertFalse(
            process_monitor._matches_process_metadata(
                metadata,
                {
                    "process_names": ["PlayoutApp.exe"],
                    "executable_path_contains": [r"Channel 4"],
                },
                "generic_windows",
            )
        )

    def test_check_treats_matching_running_service_as_up(self) -> None:
        fake_service = Mock()
        fake_service.as_dict.return_value = {
            "name": "PlayBoxAirBoxChannel2",
            "display_name": "PlayBox AirBox Channel 2",
            "binpath": r'"C:\Broadcast\PlayBox\AirBox.exe" --channel=2',
            "status": "running",
            "pid": 4242,
        }

        with patch.object(process_monitor.psutil, "win_service_iter", return_value=[fake_service], create=True):
            observation = process_monitor.check(
                "studio-a-playbox-2",
                "playbox_neo",
                {
                    "service_names": ["PlayBoxAirBoxChannel2"],
                    "service_path_contains": [r"AirBox.exe"],
                },
            )

        self.assertEqual(observation["playout_process_up"], 1)
        self.assertEqual(observation["playout_service_up"], 1)


if __name__ == "__main__":
    unittest.main()

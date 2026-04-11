import sys
import unittest
from pathlib import Path
from unittest.mock import patch

AGENT_DIR = Path(__file__).resolve().parents[1]
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from monitors import udp_probe  # noqa: E402


class UdpProbeUrlTests(unittest.TestCase):
    def test_tune_udp_stream_url_adds_buffer_defaults(self) -> None:
        tuned = udp_probe._tune_udp_stream_url("udp://@239.205.128.199:10000")
        self.assertIn("overrun_nonfatal=1", tuned)
        self.assertIn("fifo_size=5000000", tuned)

    def test_tune_udp_stream_url_preserves_existing_options(self) -> None:
        tuned = udp_probe._tune_udp_stream_url(
            "udp://@239.205.128.199:10000?fifo_size=1111&overrun_nonfatal=0"
        )
        self.assertIn("fifo_size=1111", tuned)
        self.assertIn("overrun_nonfatal=0", tuned)

    def test_tune_udp_stream_url_leaves_non_udp_unchanged(self) -> None:
        source = "http://10.10.10.10/live/stream.m3u8"
        self.assertEqual(udp_probe._tune_udp_stream_url(source), source)

    def test_probe_url_candidates_include_fallback_without_at(self) -> None:
        candidates = udp_probe._probe_url_candidates("udp://@239.205.128.199:10000")
        self.assertGreaterEqual(len(candidates), 2)
        self.assertTrue(any(candidate.startswith("udp://@239.205.128.199:10000") for candidate in candidates))
        self.assertTrue(any(candidate.startswith("udp://239.205.128.199:10000") for candidate in candidates))


class UdpProbePresenceTests(unittest.TestCase):
    @patch.object(udp_probe, "_run")
    def test_check_presence_uses_fallback_candidate(self, mock_run) -> None:
        # First candidate fails, fallback succeeds.
        mock_run.side_effect = [
            (-1, "", "I/O error"),
            (0, '{"streams":[{"codec_type":"video"}]}', ""),
        ]

        self.assertEqual(udp_probe.check_presence("udp://@239.205.128.199:10000"), 1)
        self.assertEqual(mock_run.call_count, 2)

    @patch.object(udp_probe, "_run")
    def test_check_presence_uses_ffmpeg_decode_fallback(self, mock_run) -> None:
        mock_run.side_effect = [
            (-1, "", "ffprobe failed"),
            (0, "", ""),
        ]

        self.assertEqual(udp_probe.check_presence("udp://239.205.128.199:10000"), 1)
        self.assertEqual(mock_run.call_count, 2)


class UdpProbeMetricFallbackTests(unittest.TestCase):
    @patch.object(udp_probe, "_run")
    def test_check_freeze_uses_second_candidate_when_first_fails(self, mock_run) -> None:
        mock_run.side_effect = [
            (-1, "", "first failed"),
            (0, "", "freeze_duration:2.5"),
        ]

        freeze = udp_probe.check_freeze("udp://@239.205.128.199:10000", duration=10)
        self.assertEqual(freeze, 2.5)
        self.assertEqual(mock_run.call_count, 2)


if __name__ == "__main__":
    unittest.main()

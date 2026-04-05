import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

AGENT_DIR = Path(__file__).resolve().parents[1]
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

import agent  # noqa: E402


class PostJsonWithRetryTests(unittest.TestCase):
    def test_retries_retryable_status_once_and_returns_successful_response(self) -> None:
        first_response = Mock(status_code=502)
        second_response = Mock(status_code=200)

        with patch.object(agent.requests, "post", side_effect=[first_response, second_response]) as post_mock:
            with patch.object(agent.time, "sleep") as sleep_mock:
                response = agent._post_json_with_retry(
                    "https://pulse.example.com/api/heartbeat",
                    "token",
                    {"ok": True},
                    "Heartbeat POST for player-1",
                    retry_delays_seconds=(0.25,),
                )

        self.assertIs(response, second_response)
        self.assertEqual(post_mock.call_count, 2)
        sleep_mock.assert_called_once_with(0.25)

    def test_does_not_retry_non_retryable_status(self) -> None:
        response = Mock(status_code=401)

        with patch.object(agent.requests, "post", return_value=response) as post_mock:
            with patch.object(agent.time, "sleep") as sleep_mock:
                returned = agent._post_json_with_retry(
                    "https://pulse.example.com/api/heartbeat",
                    "token",
                    {"ok": True},
                    "Heartbeat POST for player-1",
                    retry_delays_seconds=(0.25,),
                )

        self.assertIs(returned, response)
        post_mock.assert_called_once()
        sleep_mock.assert_not_called()


class ConfigureBundleCommandTests(unittest.TestCase):
    def test_configure_bundle_command_preloads_discovery_report_into_local_ui_state(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            config_path = temp_root / "config.yaml"
            report_path = temp_root / "pulse-node-discovery-report.json"

            config_path.write_text(
                "\n".join(
                    [
                        "node_id: existing-node",
                        "node_name: Existing Node",
                        "site_id: existing-node",
                        "hub_url: \"\"",
                        "enrollment_key: \"\"",
                        "players: []",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            report_path.write_text(
                '{"node_id":"existing-node","node_name":"Existing Node","site_id":"existing-node","hub_url":"https://pulse.example.com","enrollment_key":"ENROLL-123","players":[]}',
                encoding="utf-8",
            )

            captured_state: dict[str, object] = {}

            def fake_run_config_editor(initial_state=None):
                captured_state.update(initial_state or {})
                return dict(initial_state or {})

            with patch.object(agent, "_bundle_path", return_value=str(config_path)):
                with patch.object(agent, "_run_config_editor", side_effect=fake_run_config_editor):
                    with patch.object(
                        agent,
                        "load_config",
                        return_value={
                            "node_id": "existing-node",
                            "node_name": "Existing Node",
                            "players": [],
                        },
                    ):
                        exit_code = agent.configure_bundle_command(str(report_path))

        self.assertEqual(exit_code, 0)
        self.assertEqual(captured_state["hub_url"], "https://pulse.example.com")
        self.assertEqual(captured_state["enrollment_key"], "ENROLL-123")


if __name__ == "__main__":
    unittest.main()

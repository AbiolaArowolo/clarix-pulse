import sys
import tempfile
import unittest
import subprocess
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
                with patch.object(agent, "_run_bundle_config_editor", side_effect=fake_run_config_editor):
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

    def test_import_local_ui_state_uses_clarix_hub_when_report_has_no_hub_url(self) -> None:
        config, message = agent._import_local_ui_state(
            '{"node_id":"existing-node","node_name":"Existing Node","site_id":"existing-node","hub_url":"","players":[]}',
            {"node_id": "existing-node", "node_name": "Existing Node", "site_id": "existing-node", "players": []},
        )

        self.assertEqual(config["hub_url"], "https://pulse.clarixtech.com")
        self.assertEqual(message, "Discovery report imported. Review the hub URL if needed, then save local settings.")

    def test_import_local_ui_state_keeps_enrollment_key_with_existing_agent_token(self) -> None:
        config, _ = agent._import_local_ui_state(
            '{"node_id":"existing-node","node_name":"Existing Node","site_id":"existing-node","players":[]}',
            {
                "node_id": "existing-node",
                "node_name": "Existing Node",
                "site_id": "existing-node",
                "agent_token": "AGENT-TOKEN-123",
                "enrollment_key": "ENROLL-123",
                "players": [],
            },
        )

        self.assertEqual(config["agent_token"], "AGENT-TOKEN-123")
        self.assertEqual(config["enrollment_key"], "ENROLL-123")

    def test_import_local_ui_state_preloads_enrollment_key_from_uploaded_discovery_data(self) -> None:
        config, message = agent._import_local_ui_state(
            "\n".join(
                [
                    "node_id: studio-a",
                    "node_name: Studio A",
                    "site_id: studio-a",
                    "hub_url: https://pulse.example.com",
                    "enrollment_key: ENROLL-ABC-123",
                    "players:",
                    "  - player_id: studio-a-playbox-1",
                    "    playout_type: playbox_neo",
                    "    paths:",
                    "      log_path: C:\\ProgramData\\PlayBox\\Logs",
                    "",
                ]
            ),
            {
                "node_id": "studio-a",
                "node_name": "Studio A",
                "site_id": "studio-a",
                "players": [],
            },
        )

        self.assertEqual(config["enrollment_key"], "ENROLL-ABC-123")
        self.assertEqual(config["hub_url"], "https://pulse.example.com")
        self.assertIn("imported", message.lower())

    def test_normalize_local_ui_submission_allows_removing_existing_player_without_sensitive_unlock(self) -> None:
        existing = {
            "node_id": "studio-a",
            "node_name": "Studio A",
            "site_id": "studio-a",
            "hub_url": "https://pulse.example.com",
            "agent_token": "TOKEN-123",
            "poll_interval_seconds": 3,
            "players": [
                {
                    "player_id": "studio-a-insta-1",
                    "playout_type": "insta",
                    "paths": {"shared_log_dir": "C:\\Insta log", "instance_root": "C:\\Insta\\One"},
                    "udp_inputs": [],
                },
                {
                    "player_id": "studio-a-insta-2",
                    "playout_type": "insta",
                    "paths": {"shared_log_dir": "C:\\Insta log", "instance_root": "C:\\Insta\\Two"},
                    "udp_inputs": [],
                },
            ],
        }
        payload = {
            "node_id": "studio-a",
            "node_name": "Studio A",
            "site_id": "studio-a",
            "hub_url": "https://pulse.example.com",
            "agent_token": "TOKEN-123",
            "poll_interval_seconds": 3,
            "players": [
                {
                    "player_id": "studio-a-insta-2",
                    "playout_type": "insta",
                    "paths": {"shared_log_dir": "C:\\Insta log", "instance_root": "C:\\Insta\\Two"},
                    "udp_inputs": [],
                },
            ],
        }

        config = agent._normalize_local_ui_submission(payload, existing)

        self.assertEqual([player["player_id"] for player in config["players"]], ["studio-a-insta-2"])

    def test_normalize_local_ui_submission_keeps_service_selectors(self) -> None:
        payload = {
            "node_id": "studio-a",
            "node_name": "Studio A",
            "site_id": "studio-a",
            "hub_url": "https://pulse.example.com",
            "enrollment_key": "ENROLL-123",
            "poll_interval_seconds": 3,
            "players": [
                {
                    "player_id": "studio-a-playbox-1",
                    "playout_type": "playbox_neo",
                    "paths": {"log_path": r"C:\ProgramData\PlayBox\Logs"},
                    "process_selectors": {
                        "service_names": ["PlayBoxAirBoxChannel1"],
                        "service_display_name_contains": ["Channel 1"],
                        "service_path_contains": [r"AirBox.exe"],
                    },
                    "udp_inputs": [],
                }
            ],
        }

        config = agent._normalize_local_ui_submission(payload, existing={})

        selectors = config["players"][0]["process_selectors"]
        self.assertEqual(selectors["service_names"], ["PlayBoxAirBoxChannel1"])
        self.assertEqual(selectors["service_display_name_contains"], ["Channel 1"])
        self.assertEqual(selectors["service_path_contains"], [r"AirBox.exe"])


class CycleContextTests(unittest.TestCase):
    def test_build_cycle_shared_context_collects_connectivity_once_and_counts_log_paths(self) -> None:
        players = [
            {
                "player_id": "one",
                "playout_type": "generic_windows",
                "paths": {"log_path": r"C:\Logs\shared\player.log"},
                "log_selectors": {},
            },
            {
                "player_id": "two",
                "playout_type": "generic_windows",
                "paths": {"log_path": r"C:\Logs\shared\player.log"},
                "log_selectors": {},
            },
            {
                "player_id": "three",
                "playout_type": "generic_windows",
                "paths": {"log_path": r"C:\Logs\solo\player.log"},
                "log_selectors": {"include_contains": ["Channel 3"]},
            },
        ]

        with patch.object(agent.connectivity, "check", return_value={"gateway_up": 1, "internet_up": 1}) as connectivity_mock:
            context = agent._build_cycle_shared_context(players)

        self.assertEqual(connectivity_mock.call_count, 1)
        self.assertEqual(context["shared_connectivity"], {"gateway_up": 1, "internet_up": 1})
        self.assertEqual(context["log_path_counts"][r"c:\logs\shared\player.log"], 2)
        self.assertEqual(context["log_path_counts"][r"c:\logs\solo\player.log"], 1)

    def test_should_allow_unscoped_log_tokens_only_for_unique_or_scoped_logs(self) -> None:
        log_path_counts = {
            r"c:\logs\shared\player.log": 2,
            r"c:\logs\solo\player.log": 1,
        }

        self.assertFalse(
            agent._should_allow_unscoped_log_tokens(
                {
                    "playout_type": "generic_windows",
                    "paths": {"log_path": r"C:\Logs\shared\player.log"},
                    "log_selectors": {},
                },
                log_path_counts,
            )
        )
        self.assertTrue(
            agent._should_allow_unscoped_log_tokens(
                {
                    "playout_type": "generic_windows",
                    "paths": {"log_path": r"C:\Logs\shared\player.log"},
                    "log_selectors": {"include_contains": ["Channel 2"]},
                },
                log_path_counts,
            )
        )
        self.assertTrue(
            agent._should_allow_unscoped_log_tokens(
                {
                    "playout_type": "generic_windows",
                    "paths": {"log_path": r"C:\Logs\solo\player.log"},
                    "log_selectors": {},
                },
                log_path_counts,
            )
        )


class BrowserLaunchTests(unittest.TestCase):
    def test_open_url_in_browser_uses_windows_cmd_start_before_webbrowser(self) -> None:
        with patch.object(agent.webbrowser, "open", return_value=False) as browser_open_mock:
            with patch.object(agent.os, "name", "nt"):
                with patch.object(agent, "_open_url_with_startfile") as startfile_mock:
                    with patch.object(agent, "_open_url_with_cmd_start") as cmd_start_mock:
                        with patch.object(agent, "_open_url_with_rundll32") as rundll32_mock:
                            error = agent._open_url_in_browser("http://127.0.0.1:3210/")

        self.assertIsNone(error)
        cmd_start_mock.assert_called_once_with("http://127.0.0.1:3210/")
        startfile_mock.assert_not_called()
        rundll32_mock.assert_not_called()
        browser_open_mock.assert_not_called()

    def test_open_local_ui_command_reports_manual_url_when_auto_open_fails(self) -> None:
        response = Mock(status_code=200)

        with patch.object(agent.requests, "get", return_value=response):
            with patch.object(agent, "_open_url_in_browser", return_value="webbrowser.open returned False"):
                exit_code = agent.open_local_ui_command()

        self.assertEqual(exit_code, 1)


class TemporaryUiPortTests(unittest.TestCase):
    def test_create_local_ui_server_uses_first_free_port_in_range(self) -> None:
        class DummyHandler(agent.BaseHTTPRequestHandler):
            pass

        mock_server = Mock()
        with patch.object(agent, "ThreadingHTTPServer", side_effect=[OSError("in use"), mock_server]) as server_mock:
            server = agent._create_local_ui_server(DummyHandler, preferred_ports=range(3211, 3213))

        self.assertIs(server, mock_server)
        self.assertEqual(server_mock.call_args_list[0].args[0], (agent.LOCAL_UI_HOST, 3211))
        self.assertEqual(server_mock.call_args_list[1].args[0], (agent.LOCAL_UI_HOST, 3212))


@unittest.skipUnless(sys.platform == "win32", "Windows batch launcher test")
class WindowsBatchLauncherTests(unittest.TestCase):
    def test_setup_bat_can_launch_menu_and_exit_cleanly(self) -> None:
        source_setup = AGENT_DIR / "setup.bat"

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            (temp_root / "setup.bat").write_text(source_setup.read_text(encoding="utf-8"), encoding="utf-8")
            (temp_root / "clarix-agent.exe").write_bytes(b"")

            result = subprocess.run(
                ["cmd.exe", "/d", "/c", "echo 5|call setup.bat"],
                cwd=temp_root,
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )

        combined_output = "\n".join(filter(None, (result.stdout, result.stderr)))
        self.assertEqual(result.returncode, 0, combined_output)
        self.assertIn("CLARIX PULSE", combined_output)
        self.assertNotIn("The syntax of the command is incorrect.", combined_output)

    def test_setup_bat_scan_option_runs_report_and_summary_scripts(self) -> None:
        source_setup = AGENT_DIR / "setup.bat"
        setup_text = source_setup.read_text(encoding="utf-8").replace(
            "echo.\npause\ngoto MENU\n\n:UNINSTALL",
            "echo.\nexit /b 0\n\n:UNINSTALL",
            1,
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            (temp_root / "setup.bat").write_text(setup_text, encoding="utf-8")
            (temp_root / "clarix-agent.exe").write_bytes(b"")
            (temp_root / "discover-node.ps1").write_text(
                "\n".join(
                    [
                        "param([string]$OutputPath)",
                        "$report = '{\"node_id\":\"scan-node\",\"node_name\":\"Scan Node\",\"hub_url\":\"\",\"players\":[]}'",
                        "[System.IO.File]::WriteAllText($OutputPath, $report, (New-Object System.Text.UTF8Encoding $false))",
                        "Write-Host \"DISCOVERY_OK\"",
                    ]
                ),
                encoding="utf-8",
            )
            (temp_root / "show-discovery-summary.ps1").write_text(
                "param([string]$ReportPath)\nWrite-Host \"SUMMARY_OK $ReportPath\"",
                encoding="utf-8",
            )
            (temp_root / "test-input.txt").write_text("3\n", encoding="utf-8")

            result = subprocess.run(
                ["cmd.exe", "/d", "/c", "call setup.bat < test-input.txt"],
                cwd=temp_root,
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            )

            report_path = temp_root / "pulse-node-discovery-report.json"
            self.assertTrue(report_path.exists())

        combined_output = "\n".join(filter(None, (result.stdout, result.stderr)))
        self.assertEqual(result.returncode, 0, combined_output)
        self.assertIn("DISCOVERY_OK", combined_output)
        self.assertIn("SUMMARY_OK", combined_output)
        self.assertNotIn("The syntax of the command is incorrect.", combined_output)


class MirrorSyncTests(unittest.TestCase):
    def test_sync_node_config_mirror_to_hub_posts_payload_and_returns_removed_players(self) -> None:
        response = Mock(status_code=200)
        response.json.return_value = {
            "ok": True,
            "removedPlayerIds": ["studio-a-insta-2"],
            "updatedAt": "2026-04-05T12:00:00Z",
        }
        config = {
            "node_id": "studio-a",
            "node_name": "Studio A",
            "site_id": "studio-a",
            "hub_url": "https://pulse.example.com",
            "agent_token": "TOKEN-123",
            "poll_interval_seconds": 3,
            "players": [
                {"player_id": "studio-a-insta-1", "playout_type": "insta", "paths": {}, "udp_inputs": []},
            ],
        }

        with patch.object(agent, "_post_json_with_retry", return_value=response) as post_mock:
            result = agent._sync_node_config_mirror_to_hub(config)

        self.assertTrue(result["ok"])
        self.assertEqual(result["removed_player_ids"], ["studio-a-insta-2"])
        self.assertEqual(result["updated_at"], "2026-04-05T12:00:00Z")
        post_mock.assert_called_once()
        self.assertEqual(
            post_mock.call_args.args[0],
            "https://pulse.example.com/api/config/node/mirror",
        )
        self.assertEqual(post_mock.call_args.args[1], "TOKEN-123")
        self.assertEqual(
            post_mock.call_args.args[2]["players"][0]["player_id"],
            "studio-a-insta-1",
        )

    def test_save_local_ui_config_reports_immediate_hub_sync_after_player_removal(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            config_path = temp_root / "config.yaml"
            existing_config = {
                "node_id": "studio-a",
                "node_name": "Studio A",
                "site_id": "studio-a",
                "hub_url": "https://pulse.example.com",
                "agent_token": "TOKEN-123",
                "poll_interval_seconds": 3,
                "players": [
                    {"player_id": "studio-a-insta-1", "playout_type": "insta", "paths": {}, "udp_inputs": []},
                    {"player_id": "studio-a-insta-2", "playout_type": "insta", "paths": {}, "udp_inputs": []},
                ],
            }
            agent._write_yaml(str(config_path), existing_config)

            payload = {
                "node_id": "studio-a",
                "node_name": "Studio A",
                "site_id": "studio-a",
                "hub_url": "https://pulse.example.com",
                "agent_token": "TOKEN-123",
                "unlock_sensitive_fields": True,
                "poll_interval_seconds": 3,
                "players": [
                    {
                        "player_id": "studio-a-insta-1",
                        "playout_type": "insta",
                        "paths": {"shared_log_dir": "C:\\Insta log", "instance_root": "C:\\Insta\\Settings"},
                        "udp_inputs": [],
                    }
                ],
            }

            with patch.object(agent, "_runtime_config_path", return_value=str(config_path)):
                with patch.object(agent, "_ensure_ff_tools") as ensure_ff_tools_mock:
                    with patch.object(agent, "_apply_runtime_local_config_override") as override_mock:
                        with patch.object(
                            agent,
                            "_sync_node_config_mirror_to_hub",
                            return_value={
                                "ok": True,
                                "removed_player_ids": ["studio-a-insta-2"],
                                "updated_at": "2026-04-05T12:00:00Z",
                            },
                        ) as sync_mock:
                            config, message = agent._save_local_ui_config(payload)

        ensure_ff_tools_mock.assert_called_once()
        override_mock.assert_called_once()
        sync_mock.assert_called_once()
        self.assertEqual(config["players"][0]["player_id"], "studio-a-insta-1")
        self.assertIn("removed from the hub immediately", message.lower())


if __name__ == "__main__":
    unittest.main()

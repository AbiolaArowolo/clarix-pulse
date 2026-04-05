from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "vps_clean_redeploy.py"
SPEC = importlib.util.spec_from_file_location("vps_clean_redeploy", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class VpsCleanRedeployTests(unittest.TestCase):
    def test_resolve_bundle_deploy_plan_uses_latest_repo_bundle_and_stable_remote_path(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace_root = Path(temp_dir)
            release_root = workspace_root / "packages" / "agent" / "release"
            release_root.mkdir(parents=True, exist_ok=True)
            (release_root / "clarix-pulse-v1.9.zip").write_bytes(b"zip")
            latest_bundle = release_root / "clarix-pulse-v1.17.zip"
            latest_bundle.write_bytes(b"zip")

            plan = MODULE.resolve_bundle_deploy_plan({}, workspace_root=workspace_root)

            self.assertIsNotNone(plan)
            assert plan is not None
            self.assertEqual(plan["local_path"], str(latest_bundle))
            self.assertEqual(plan["remote_path"], "/var/lib/clarix-pulse/downloads/clarix-pulse-v1.17.zip")
            self.assertEqual(plan["file_name"], "clarix-pulse-v1.17.zip")

    def test_resolve_bundle_deploy_plan_respects_explicit_bundle_name_override(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            workspace_root = Path(temp_dir)
            release_root = workspace_root / "packages" / "agent" / "release"
            release_root.mkdir(parents=True, exist_ok=True)
            old_bundle = release_root / "clarix-pulse-v1.9.zip"
            old_bundle.write_bytes(b"zip")
            (release_root / "clarix-pulse-v1.17.zip").write_bytes(b"zip")

            plan = MODULE.resolve_bundle_deploy_plan(
                {"PULSE_DOWNLOAD_BUNDLE_NAME": "clarix-pulse-v1.9.zip"},
                workspace_root=workspace_root,
            )

            self.assertIsNotNone(plan)
            assert plan is not None
            self.assertEqual(plan["local_path"], str(old_bundle))
            self.assertEqual(plan["remote_path"], "/var/lib/clarix-pulse/downloads/clarix-pulse-v1.9.zip")
            self.assertEqual(plan["file_name"], "clarix-pulse-v1.9.zip")

    def test_build_env_override_lines_with_extra_bundle_override(self) -> None:
        lines = MODULE.build_env_override_lines_with_extra(
            {"PULSE_DOWNLOAD_SIGNING_SECRET": "secret"},
            {
                "PULSE_DOWNLOAD_BUNDLE_PATH": "/var/lib/clarix-pulse/downloads/clarix-pulse-v1.17.zip",
                "PULSE_DOWNLOAD_BUNDLE_NAME": "clarix-pulse-v1.17.zip",
            },
        )

        self.assertIn("PULSE_DOWNLOAD_SIGNING_SECRET=secret", lines)
        self.assertIn("PULSE_DOWNLOAD_BUNDLE_PATH=/var/lib/clarix-pulse/downloads/clarix-pulse-v1.17.zip", lines)
        self.assertIn("PULSE_DOWNLOAD_BUNDLE_NAME=clarix-pulse-v1.17.zip", lines)


if __name__ == "__main__":
    unittest.main()

import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
DISCOVERY_SCRIPT = REPO_ROOT / "packages" / "agent" / "discover-node.ps1"
POWERSHELL_EXE = shutil.which("pwsh") or shutil.which("powershell") or shutil.which("powershell.exe")


def _ps_quote(value: Path | str) -> str:
    return str(value).replace("'", "''")


class DiscoverNodeScriptTests(unittest.TestCase):
    def setUp(self) -> None:
        if not POWERSHELL_EXE:
            self.skipTest("PowerShell is required for discovery script tests.")

    def test_detects_native_players_without_generic_duplicates_and_finds_insta_fnf(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_root = temp_root / "bundle"
            bundle_root.mkdir()
            program_files = temp_root / "Program Files"
            program_files_x86 = temp_root / "Program Files (x86)"
            program_data = temp_root / "ProgramData"

            (program_files / "Indytek" / "Insta Playout" / "Settings").mkdir(parents=True)
            (program_files / "Indytek" / "Insta Playout 2" / "Settings").mkdir(parents=True)
            (program_files / "Indytek" / "Insta log" / "FNF").mkdir(parents=True)

            admax_root = program_files_x86 / "Unimedia" / "Admax One" / "admax"
            (admax_root / "logs" / "FNF").mkdir(parents=True)
            (admax_root / "Settings.ini").write_text("", encoding="utf-8")

            command = f"""
& {{
  $programFiles = '{_ps_quote(program_files)}'
  $programFilesX86 = '{_ps_quote(program_files_x86)}'
  $programData = '{_ps_quote(program_data)}'
  [Environment]::SetEnvironmentVariable('ProgramFiles', $programFiles, 'Process')
  [Environment]::SetEnvironmentVariable('ProgramFiles(x86)', $programFilesX86, 'Process')
  [Environment]::SetEnvironmentVariable('ProgramData', $programData, 'Process')
  function Get-CimInstance {{
    [CmdletBinding()]
    param([string]$ClassName)
    if ($ClassName -ne 'Win32_Process') {{ return @() }}
    return @(
      [pscustomobject]@{{ Name='Insta Playout.exe'; ExecutablePath=(Join-Path $programFiles 'Indytek\\Insta Playout\\Insta Playout.exe'); CommandLine='' }},
      [pscustomobject]@{{ Name='Insta Helper.exe'; ExecutablePath=(Join-Path $programFiles 'Indytek\\Insta Playout 2\\Insta Helper.exe'); CommandLine='' }},
      [pscustomobject]@{{ Name='Admax.exe'; ExecutablePath=(Join-Path $programFilesX86 'Unimedia\\Admax One\\admax\\Admax.exe'); CommandLine='' }}
    )
  }}
  & '{_ps_quote(DISCOVERY_SCRIPT)}' -StdOut
}}
"""
            completed = subprocess.run(
                [
                    POWERSHELL_EXE,
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    command,
                ],
                cwd=bundle_root,
                capture_output=True,
                text=True,
                check=True,
            )

        report = json.loads(completed.stdout)
        players = report["players"]
        playout_types = [player["playout_type"] for player in players]
        insta_players = [player for player in players if player["playout_type"] == "insta"]

        self.assertEqual(report["discovery"]["detected_player_count"], 3)
        self.assertEqual(playout_types.count("insta"), 2)
        self.assertEqual(playout_types.count("admax"), 1)
        self.assertNotIn("generic_windows", playout_types)
        self.assertEqual(len(insta_players), 2)
        insta_instance_roots = {player["paths"]["instance_root"] for player in insta_players}
        self.assertIn(str(program_files / "Indytek" / "Insta Playout" / "Settings"), insta_instance_roots)
        self.assertIn(str(program_files / "Indytek" / "Insta Playout 2" / "Settings"), insta_instance_roots)
        for player in insta_players:
            self.assertTrue(player["paths"]["fnf_log"].endswith("Indytek\\Insta log\\FNF"))

    def test_uses_pulse_account_json_as_fallback_for_missing_hub_and_key(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_root = temp_root / "bundle"
            bundle_root.mkdir()
            script_copy = bundle_root / "discover-node.ps1"
            script_copy.write_text(DISCOVERY_SCRIPT.read_text(encoding="utf-8"), encoding="utf-8")

            (bundle_root / "config.yaml").write_text(
                "\n".join(
                    [
                        "node_id: studio-a",
                        "node_name: Studio A",
                        "site_id: studio-a",
                        "hub_url: \"\"",
                        "enrollment_key: \"\"",
                        "players: []",
                        "",
                    ]
                ),
                encoding="utf-8",
            )
            (bundle_root / "pulse-account.json").write_text(
                json.dumps(
                    {
                        "hubUrl": "https://pulse.example.com",
                        "enrollmentKey": "ENROLL-ABC-123",
                    }
                ),
                encoding="utf-8",
            )

            command = f"""
& {{
  $programFiles = '{_ps_quote(temp_root / "Program Files")}'
  $programFilesX86 = '{_ps_quote(temp_root / "Program Files (x86)")}'
  $programData = '{_ps_quote(temp_root / "ProgramData")}'
  [Environment]::SetEnvironmentVariable('ProgramFiles', $programFiles, 'Process')
  [Environment]::SetEnvironmentVariable('ProgramFiles(x86)', $programFilesX86, 'Process')
  [Environment]::SetEnvironmentVariable('ProgramData', $programData, 'Process')
  function Get-CimInstance {{
    [CmdletBinding()]
    param([string]$ClassName)
    return @()
  }}
  & '{_ps_quote(script_copy)}' -StdOut
}}
"""
            completed = subprocess.run(
                [
                    POWERSHELL_EXE,
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    command,
                ],
                cwd=bundle_root,
                capture_output=True,
                text=True,
                check=True,
            )

        report = json.loads(completed.stdout)
        self.assertEqual(report["node_id"], "studio-a")
        self.assertEqual(report["hub_url"], "https://pulse.example.com")
        self.assertEqual(report["enrollment_key"], "ENROLL-ABC-123")

    def test_uses_bundle_config_hub_url_for_generic_installer_scan(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_root = temp_root / "bundle"
            bundle_root.mkdir()
            script_copy = bundle_root / "discover-node.ps1"
            script_copy.write_text(DISCOVERY_SCRIPT.read_text(encoding="utf-8"), encoding="utf-8")

            (bundle_root / "config.yaml").write_text(
                "\n".join(
                    [
                        "node_id: studio-a",
                        "node_name: Studio A",
                        "site_id: studio-a",
                        "hub_url: https://pulse.clarixtech.com",
                        "players: []",
                        "",
                    ]
                ),
                encoding="utf-8",
            )

            command = f"""
& {{
  $programFiles = '{_ps_quote(temp_root / "Program Files")}'
  $programFilesX86 = '{_ps_quote(temp_root / "Program Files (x86)")}'
  $programData = '{_ps_quote(temp_root / "ProgramData")}'
  [Environment]::SetEnvironmentVariable('ProgramFiles', $programFiles, 'Process')
  [Environment]::SetEnvironmentVariable('ProgramFiles(x86)', $programFilesX86, 'Process')
  [Environment]::SetEnvironmentVariable('ProgramData', $programData, 'Process')
  function Get-CimInstance {{
    [CmdletBinding()]
    param([string]$ClassName)
    return @()
  }}
  & '{_ps_quote(script_copy)}' -StdOut
}}
"""
            completed = subprocess.run(
                [
                    POWERSHELL_EXE,
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    command,
                ],
                cwd=bundle_root,
                capture_output=True,
                text=True,
                check=True,
            )

        report = json.loads(completed.stdout)
        self.assertEqual(report["hub_url"], "https://pulse.clarixtech.com")


if __name__ == "__main__":
    unittest.main()

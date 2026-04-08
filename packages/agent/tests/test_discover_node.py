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

    def test_detects_admax_from_running_process_when_install_uses_newer_playout_exe_name(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_root = temp_root / "bundle"
            bundle_root.mkdir()
            program_files = temp_root / "Program Files"
            program_files_x86 = temp_root / "Program Files (x86)"
            program_data = temp_root / "ProgramData"

            admax_root = program_files_x86 / "Unimedia" / "Admax One 2.0"
            executable_path = admax_root / "bin" / "64bit" / "Admax-One Playout2.0.exe"
            executable_path.parent.mkdir(parents=True)
            executable_path.write_text("", encoding="utf-8")
            (admax_root / "bin" / "64bit" / "Settings.ini").write_text("", encoding="utf-8")
            (admax_root / "bin" / "64bit" / "logs" / "Playout").mkdir(parents=True)

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
      [pscustomobject]@{{
        Name='Admax-One Playout2.0.exe';
        ExecutablePath='{_ps_quote(executable_path)}';
        CommandLine='"{_ps_quote(executable_path)}"'
      }}
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
        admax_players = [player for player in report["players"] if player["playout_type"] == "admax"]

        self.assertEqual(len(admax_players), 1)
        self.assertEqual(admax_players[0]["paths"]["admax_root_candidates"], [str(admax_root)])
        self.assertIn("Admax-One Playout2.0.exe", admax_players[0]["process_selectors"]["process_names"])

    def test_detects_admax_from_wrapper_executable_and_nested_logs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_root = temp_root / "bundle"
            bundle_root.mkdir()
            program_files = temp_root / "Program Files"
            program_files_x86 = temp_root / "Program Files (x86)"
            program_data = temp_root / "ProgramData"

            product_root = program_files_x86 / "Unimedia" / "Admax One 2.0"
            admax_root = product_root / "admax"
            product_root.mkdir(parents=True)
            (product_root / "unistreamer.exe").write_text("", encoding="utf-8")
            (admax_root / "bin" / "64bit" / "logs" / "FNF").mkdir(parents=True)
            (admax_root / "bin" / "64bit" / "logs" / "logs" / "Playout").mkdir(parents=True)

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
    return @()
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
        admax_players = [player for player in report["players"] if player["playout_type"] == "admax"]

        self.assertEqual(len(admax_players), 1)
        self.assertEqual(admax_players[0]["paths"]["admax_root_candidates"], [str(product_root), str(admax_root)])
        self.assertEqual(admax_players[0]["paths"]["install_dir"], str(product_root))
        self.assertIn("unistreamer.exe", admax_players[0]["process_selectors"]["process_names"])
        self.assertIn(str(admax_root / "bin" / "64bit" / "logs" / "logs" / "Playout"), admax_players[0]["paths"]["playout_log_dir"])

    def test_detects_insta_channels_from_settings_folders_when_exe_is_shared(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_root = temp_root / "bundle"
            bundle_root.mkdir()
            program_files = temp_root / "Program Files"
            program_files_x86 = temp_root / "Program Files (x86)"
            program_data = temp_root / "ProgramData"

            indytek_root = program_files / "Indytek"
            shared_exe = indytek_root / "Insta Playout.exe"
            shared_exe.parent.mkdir(parents=True, exist_ok=True)
            shared_exe.write_text("", encoding="utf-8")

            for folder_name in ("Insta Playout", "Insta Playout 2", "Insta Playout 3", "Insta Playout 4"):
                settings_dir = indytek_root / folder_name / "Settings"
                settings_dir.mkdir(parents=True)
                (settings_dir / "Mainplaylist.xml").write_text("<playlist />", encoding="utf-8")

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
      [pscustomobject]@{{ Name='Insta Playout.exe'; ExecutablePath='{_ps_quote(shared_exe)}'; CommandLine='' }},
      [pscustomobject]@{{ Name='Insta Playout.exe'; ExecutablePath='{_ps_quote(shared_exe)}'; CommandLine='' }}
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
        insta_players = [player for player in report["players"] if player["playout_type"] == "insta"]

        self.assertEqual(len(insta_players), 4)
        self.assertEqual(
            {player["label"] for player in insta_players},
            {"Insta Playout", "Insta Playout 2", "Insta Playout 3", "Insta Playout 4"},
        )
        self.assertEqual(
            {
                player["paths"]["instance_root"]
                for player in insta_players
            },
            {
                str(indytek_root / "Insta Playout" / "Settings"),
                str(indytek_root / "Insta Playout 2" / "Settings"),
                str(indytek_root / "Insta Playout 3" / "Settings"),
                str(indytek_root / "Insta Playout 4" / "Settings"),
            },
        )

    def test_detects_admax_from_product_root_launcher_when_logs_live_in_nested_admax_dir(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_root = temp_root / "bundle"
            bundle_root.mkdir()
            program_files = temp_root / "Program Files"
            program_files_x86 = temp_root / "Program Files (x86)"
            program_data = temp_root / "ProgramData"

            admax_product_root = program_files_x86 / "Unimedia" / "Admax One 2.0"
            admax_data_root = admax_product_root / "admax"
            admax_data_root.mkdir(parents=True)
            (admax_product_root / "unistreamer.exe").write_text("", encoding="utf-8")
            (admax_data_root / "bin" / "64bit" / "logs" / "Playout").mkdir(parents=True)
            (admax_data_root / "bin" / "64bit" / "logs" / "FNF").mkdir(parents=True)
            (admax_data_root / "Settings.ini").write_text("", encoding="utf-8")

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
    return @()
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
        admax_players = [player for player in report["players"] if player["playout_type"] == "admax"]

        self.assertEqual(len(admax_players), 1)
        self.assertIn(str(admax_product_root), admax_players[0]["paths"]["admax_root_candidates"])
        self.assertTrue(admax_players[0]["paths"]["playout_log_dir"].endswith("admax\\bin\\64bit\\logs\\Playout"))
        self.assertTrue(admax_players[0]["paths"]["fnf_log"].endswith("admax\\bin\\64bit\\logs\\FNF"))

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

    def test_generic_discovery_keeps_same_software_instances_separate_by_command_line(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_root = temp_root / "bundle"
            bundle_root.mkdir()
            program_files = temp_root / "Program Files"
            program_files_x86 = temp_root / "Program Files (x86)"
            program_data = temp_root / "ProgramData"
            airbox_dir = program_files / "PlayBox Neo"
            airbox_dir.mkdir(parents=True)
            executable_path = airbox_dir / "AirBox.exe"
            executable_path.write_text("", encoding="utf-8")

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
      [pscustomobject]@{{
        Name='AirBox.exe';
        ExecutablePath='{_ps_quote(executable_path)}';
        CommandLine='\"{_ps_quote(executable_path)}\" --channel=1 --service=playout'
      }},
      [pscustomobject]@{{
        Name='AirBox.exe';
        ExecutablePath='{_ps_quote(executable_path)}';
        CommandLine='\"{_ps_quote(executable_path)}\" --channel=2 --service=playout'
      }}
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
        players = [player for player in report["players"] if player["playout_type"] == "playbox_neo"]

        self.assertEqual(len(players), 2)
        command_line_selectors = {
            tuple(player.get("process_selectors", {}).get("command_line_contains", []))
            for player in players
        }
        self.assertIn(("--channel=1 --service=playout",), command_line_selectors)
        self.assertIn(("--channel=2 --service=playout",), command_line_selectors)

    def test_generic_discovery_keeps_service_hosted_instances_separate(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_root = temp_root / "bundle"
            bundle_root.mkdir()
            program_files = temp_root / "Program Files"
            program_files_x86 = temp_root / "Program Files (x86)"
            program_data = temp_root / "ProgramData"
            airbox_dir = program_files / "PlayBox Neo"
            airbox_dir.mkdir(parents=True)
            executable_path = airbox_dir / "AirBox.exe"
            executable_path.write_text("", encoding="utf-8")

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
    if ($ClassName -eq 'Win32_Service') {{
      return @(
        [pscustomobject]@{{
          Name='PlayBoxAirBoxChannel1';
          DisplayName='PlayBox AirBox Channel 1';
          PathName='"{_ps_quote(executable_path)}" --channel=1';
          StartMode='Auto';
          Started=$true;
          State='Running';
          ProcessId=2001
        }},
        [pscustomobject]@{{
          Name='PlayBoxAirBoxChannel2';
          DisplayName='PlayBox AirBox Channel 2';
          PathName='"{_ps_quote(executable_path)}" --channel=2';
          StartMode='Auto';
          Started=$true;
          State='Running';
          ProcessId=2002
        }}
      )
    }}
    return @()
  }}
  function Get-Process {{
    [CmdletBinding()]
    param([int[]]$Id)
    return @(
      [pscustomobject]@{{ Id = 2001; MainWindowTitle = 'PlayBox AirBox Channel 1' }},
      [pscustomobject]@{{ Id = 2002; MainWindowTitle = 'PlayBox AirBox Channel 2' }}
    ) | Where-Object {{ $Id -contains $_.Id }}
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
        players = [player for player in report["players"] if player["playout_type"] == "playbox_neo"]

        self.assertEqual(len(players), 2)
        self.assertEqual(
            {
                tuple(player.get("process_selectors", {}).get("service_names", []))
                for player in players
            },
            {
                ("PlayBoxAirBoxChannel1",),
                ("PlayBoxAirBoxChannel2",),
            },
        )
        self.assertEqual(
            {
                tuple(player.get("process_selectors", {}).get("command_line_contains", []))
                for player in players
            },
            {
                ("--channel=1",),
                ("--channel=2",),
            },
        )

    def test_generic_discovery_uses_startup_commands_when_process_is_not_running(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_root = Path(temp_dir)
            bundle_root = temp_root / "bundle"
            bundle_root.mkdir()
            program_files = temp_root / "Program Files"
            program_files_x86 = temp_root / "Program Files (x86)"
            program_data = temp_root / "ProgramData"
            playit_dir = program_files / "PlayIt Software"
            playit_dir.mkdir(parents=True)
            executable_path = playit_dir / "PlayItLive.exe"
            executable_path.write_text("", encoding="utf-8")

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
    if ($ClassName -eq 'Win32_StartupCommand') {{
      return @(
        [pscustomobject]@{{
          Name='PlayIt Live Channel 1';
          Command='"{_ps_quote(executable_path)}" --channel=1';
          Location='HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
        }}
      )
    }}
    return @()
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
        players = [player for player in report["players"] if player["playout_type"] == "playit_live"]

        self.assertEqual(len(players), 1)
        self.assertFalse(players[0]["running"])
        self.assertEqual(players[0]["process_selectors"]["command_line_contains"], ["--channel=1"])
        self.assertIn("Startup command", " ".join(players[0]["discovery"]["evidence"]))


if __name__ == "__main__":
    unittest.main()

param(
    [string]$ReportPath = ''
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ReportPath) -or -not (Test-Path $ReportPath)) {
    Write-Host '  (No scan report found)'
    exit 0
}

try {
    $raw = [System.IO.File]::ReadAllText($ReportPath, (New-Object System.Text.UTF8Encoding $false))
    $raw = $raw.TrimStart([char]0xFEFF)
    $report = $raw | ConvertFrom-Json
    $players = @($report.players)

    Write-Host ''
    Write-Host '  -------------------------------------------------'
    Write-Host ('  Computer : ' + $report.node_name)
    Write-Host ('  Node ID  : ' + $report.node_id)
    Write-Host ('  Hub URL  : ' + $(if ($report.hub_url) { $report.hub_url } else { '(none found)' }))
    Write-Host ('  Players  : ' + $players.Count + ' detected')
    Write-Host '  -------------------------------------------------'

    if ($players.Count -gt 0) {
        Write-Host ''
        Write-Host ('  {0,-4} {1,-20} {2,-6} {3}' -f '#', 'Type', 'State', 'Label')
        Write-Host ('  {0,-4} {1,-20} {2,-6} {3}' -f '----', '--------------------', '------', '-----')
        for ($index = 0; $index -lt $players.Count; $index++) {
            $player = $players[$index]
            $label = if ($player.label) { $player.label } else { $player.player_id }
            $state = if ($player.running -eq $true) {
                'ON'
            } elseif ($player.installed -eq $true) {
                'idle'
            } else {
                'found'
            }

            Write-Host ('  {0,-4} {1,-20} {2,-6} {3}' -f ($index + 1), $player.playout_type, $state, $label)
        }
    } else {
        Write-Host '  No broadcast software detected automatically.'
        Write-Host '  You can add players manually in the local setup UI.'
    }

    Write-Host '  -------------------------------------------------'
    Write-Host ''
} catch {
    Write-Host '  (Could not read scan report)'
    exit 0
}

[CmdletBinding()]
param(
    [string]$RepoRoot = 'd:\monitoring',
    [string]$BundleRoot = 'd:\monitoring\packages\agent\release\nj-optimum-v1.2'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$installDir = Join-Path $env:ProgramData 'ClarixPulse\Agent'
$oldConfigPath = Join-Path $installDir 'config.yaml'
$canonicalConfigPath = Join-Path $RepoRoot 'configs\nj-optimum-pc.yaml'
$bundleExePath = Join-Path $BundleRoot 'clarix-agent.exe'
$serviceName = 'ClarixPulseAgent'

if (-not (Test-Path $bundleExePath)) {
    throw "Bundle executable not found: $bundleExePath"
}

if (-not (Test-Path $canonicalConfigPath)) {
    throw "Canonical config not found: $canonicalConfigPath"
}

$token = ''
if (Test-Path $oldConfigPath) {
    $oldConfigText = Get-Content -Raw -Path $oldConfigPath
    $tokenMatch = [regex]::Match($oldConfigText, '(?m)^agent_token:\s*(.+?)\s*$')
    if ($tokenMatch.Success) {
        $token = $tokenMatch.Groups[1].Value.Trim().Trim('"').Trim("'")
    }
}

if ([string]::IsNullOrWhiteSpace($token)) {
    throw "Could not resolve the current Optimum agent token from $oldConfigPath"
}

$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) {
    $installedNssm = Join-Path $installDir 'nssm.exe'
    if (Test-Path $installedNssm) {
        & $installedNssm stop $serviceName | Out-Null
        & $installedNssm remove $serviceName confirm | Out-Null
    } else {
        sc.exe stop $serviceName | Out-Null
        sc.exe delete $serviceName | Out-Null
    }
    Start-Sleep -Seconds 2
}

Get-Process -Name 'clarix-agent' -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name 'nssm' -ErrorAction SilentlyContinue | Stop-Process -Force

if (Test-Path $installDir) {
    Remove-Item -Path $installDir -Recurse -Force
}
New-Item -Path $installDir -ItemType Directory -Force | Out-Null

$configText = Get-Content -Raw -Path $canonicalConfigPath
$configText = $configText -replace 'REPLACE_ME_NJ_OPTIMUM_PC_TOKEN', [regex]::Escape($token)
$configText = [regex]::Replace(
    $configText,
    'stream_url:\s*"udp://REPLACE_ME_[^"]+"',
    'stream_url: ""'
)

$seedConfigPath = Join-Path $installDir 'config.yaml'
[System.IO.File]::WriteAllText($seedConfigPath, $configText)

& $bundleExePath --install-service

$newService = Get-Service -Name $serviceName -ErrorAction Stop
$newService | Format-List Name,Status,StartType,DisplayName

Write-Host ''
Write-Host "Reinstalled Optimum service from $BundleRoot"
Write-Host "Seeded config: $seedConfigPath"

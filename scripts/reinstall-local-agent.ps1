[CmdletBinding()]
param(
    [string]$RepoRoot = 'D:\monitoring',
    [string]$BundleRoot = 'D:\monitoring\packages\agent\release\pulse-generic-v1.9',
    [string]$ConfigBackupPath = 'D:\monitoring\temp\optimum-config-before-current.yaml'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$serviceName = 'ClarixPulseAgent'
$installDir = Join-Path $env:ProgramData 'ClarixPulse\Agent'
$bundleName = Split-Path -Path $BundleRoot -Leaf
$stagingRoot = Join-Path $RepoRoot 'temp\local-reinstall-current'
$stagingBundle = Join-Path $stagingRoot ($bundleName + '-install')
$bundleExe = Join-Path $stagingBundle 'clarix-agent.exe'
$stagingConfig = Join-Path $stagingBundle 'config.yaml'

if (-not (Test-Path $BundleRoot)) {
    throw "Bundle root not found: $BundleRoot"
}
if (-not (Test-Path $ConfigBackupPath)) {
    throw "Config backup not found: $ConfigBackupPath"
}

if (Test-Path $stagingRoot) {
    Remove-Item -Path $stagingRoot -Recurse -Force
}
New-Item -Path $stagingRoot -ItemType Directory -Force | Out-Null
Copy-Item -Path $BundleRoot -Destination $stagingBundle -Recurse -Force
Copy-Item -Path $ConfigBackupPath -Destination $stagingConfig -Force

$installedNssm = Join-Path $installDir 'nssm.exe'
$service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($service) {
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

if (-not (Test-Path $bundleExe)) {
    throw "Staged agent executable not found: $bundleExe"
}

& $bundleExe --install-service-admin
if ($LASTEXITCODE -ne 0) {
    throw "Installer exited with code $LASTEXITCODE"
}

Write-Host ''
Write-Host 'Local reinstall complete.'
Get-Service -Name $serviceName | Format-List Name,Status,StartType,DisplayName
Get-FileHash (Join-Path $installDir 'clarix-agent.exe') | Format-List Algorithm,Hash,Path

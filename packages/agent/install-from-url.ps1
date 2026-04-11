param(
    [Parameter(Mandatory = $true)]
    [string]$BundleUrl,
    [string]$DestinationRoot = '',
    [string]$ExpectedSha256 = '',
    [switch]$RunInstall
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
    $localAppData = [Environment]::GetFolderPath('LocalApplicationData')
    if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
        $DestinationRoot = Join-Path $localAppData 'ClarixPulse\Bundles'
    } else {
        $DestinationRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'ClarixPulse\Bundles'
    }
}

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        New-Item -Path $Path -ItemType Directory -Force | Out-Null
    }
}

function Get-SafeLeafName {
    param([string]$Url)

    try {
        $uri = [System.Uri]$Url
        $leaf = [System.IO.Path]::GetFileName($uri.AbsolutePath)
        if (-not [string]::IsNullOrWhiteSpace($leaf)) {
            return $leaf
        }
    } catch {
    }

    return 'pulse-node-bundle.zip'
}

function Test-ExpectedHash {
    param(
        [string]$Path,
        [string]$Expected
    )

    if ([string]::IsNullOrWhiteSpace($Expected)) {
        return
    }

    $actual = (Get-FileHash -Path $Path -Algorithm SHA256).Hash
    if ($actual.ToUpperInvariant() -ne $Expected.Trim().ToUpperInvariant()) {
        throw "SHA256 mismatch. Expected $Expected but got $actual"
    }
}

Ensure-Directory -Path $DestinationRoot

$leafName = Get-SafeLeafName -Url $BundleUrl
if (-not $leafName.ToLowerInvariant().EndsWith('.zip')) {
    $leafName = $leafName + '.zip'
}

$zipPath = Join-Path $DestinationRoot $leafName
$extractName = [System.IO.Path]::GetFileNameWithoutExtension($leafName)
$extractPath = Join-Path $DestinationRoot $extractName

Write-Host "Downloading Pulse bundle from $BundleUrl"
Invoke-WebRequest -Uri $BundleUrl -OutFile $zipPath -UseBasicParsing -ErrorAction Stop
Test-ExpectedHash -Path $zipPath -Expected $ExpectedSha256

if (Test-Path -LiteralPath $extractPath) {
    Remove-Item -Path $extractPath -Recurse -Force
}

Write-Host "Extracting bundle to $extractPath"
Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force

$installBat = Join-Path $extractPath 'install.bat'
$setupExe = Join-Path $extractPath 'ClarixPulseSetup.exe'
$launcherPath = ''

if (Test-Path -LiteralPath $installBat) {
    $launcherPath = $installBat
} elseif (Test-Path -LiteralPath $setupExe) {
    $launcherPath = $setupExe
} else {
    throw "Neither install.bat nor ClarixPulseSetup.exe was found in extracted bundle at $extractPath"
}

Write-Host ''
Write-Host "Bundle ready at $extractPath"
Write-Host "Launcher: $launcherPath"

if ($RunInstall) {
    if ($launcherPath -ieq $installBat) {
        Write-Host 'Launching install.bat'
        & $installBat
    } else {
        Write-Host 'Launching ClarixPulseSetup.exe'
        # Run from extracted bundle folder so README/pulse-account.json are discoverable.
        Push-Location $extractPath
        try {
            & $setupExe
        } finally {
            Pop-Location
        }
    }
}

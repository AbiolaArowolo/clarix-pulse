param(
    [string]$OutputRoot = (Join-Path $PSScriptRoot 'release'),
    [string]$BundleName = 'pulse-node-bundle',
    [string]$VersionLabel = '',
    [string]$ConfigPath = '',
    [switch]$Zip,
    [switch]$SkipVendorValidation
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$effectiveBundleName = if ([string]::IsNullOrWhiteSpace($VersionLabel)) {
    $BundleName
} else {
    "$BundleName-$VersionLabel"
}

$bundleDir = Join-Path $OutputRoot $effectiveBundleName
$vendorDir = Join-Path $PSScriptRoot 'vendor'
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$distDir = Join-Path $PSScriptRoot 'dist'
$repoDistDir = Join-Path $repoRoot 'dist'
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'pulse-vendor'

function Ensure-Directory {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -ItemType Directory -Force | Out-Null
    }
}

function Download-File {
    param(
        [string]$Uri,
        [string]$OutFile
    )
    Invoke-WebRequest -Uri $Uri -OutFile $OutFile -ErrorAction Stop
}

function Expand-Zip {
    param(
        [string]$ZipPath,
        [string]$Destination
    )
    Ensure-Directory -Path $Destination
    Expand-Archive -Path $ZipPath -DestinationPath $Destination -Force
}

function Get-FirstMatch {
    param(
        [string]$Root,
        [string]$Filter
    )
    Get-ChildItem -Path $Root -Recurse -File -Filter $Filter | Select-Object -First 1
}

function Resolve-AgentBinary {
    $candidates = @(
        (Join-Path $distDir 'clarix-agent.exe'),
        (Join-Path $repoDistDir 'clarix-agent.exe')
    ) | Where-Object { Test-Path $_ }

    if (-not $candidates) {
        return $null
    }

    return $candidates |
        Sort-Object { (Get-Item $_).LastWriteTimeUtc } -Descending |
        Select-Object -First 1
}

function Ensure-NssmBinary {
    Ensure-Directory -Path $vendorDir
    $target = Join-Path $vendorDir 'nssm.exe'
    if (Test-Path $target) {
        return
    }

    $workDir = Join-Path $tempRoot 'nssm'
    if (Test-Path $workDir) {
        Remove-Item -Path $workDir -Recurse -Force
    }
    Ensure-Directory -Path $workDir

    $packagePath = Join-Path $workDir 'nssm.nupkg'
    Download-File -Uri 'https://community.chocolatey.org/api/v2/package/nssm' -OutFile $packagePath
    Expand-Zip -ZipPath $packagePath -Destination $workDir

    $nssm = Get-ChildItem -Path $workDir -Recurse -File -Filter 'nssm.exe' |
        Where-Object { $_.FullName -match 'win64' } |
        Select-Object -First 1
    if (-not $nssm) {
        $nssm = Get-FirstMatch -Root $workDir -Filter 'nssm.exe'
    }
    if (-not $nssm) {
        throw 'Failed to locate nssm.exe after extracting the NSSM archive.'
    }

    Copy-Item -Path $nssm.FullName -Destination $target -Force
}

function Ensure-FfmpegBinaries {
    Ensure-Directory -Path $vendorDir
    $ffmpegTarget = Join-Path $vendorDir 'ffmpeg.exe'
    $ffprobeTarget = Join-Path $vendorDir 'ffprobe.exe'
    if ((Test-Path $ffmpegTarget) -and (Test-Path $ffprobeTarget)) {
        return
    }

    $workDir = Join-Path $tempRoot 'ffmpeg'
    if (Test-Path $workDir) {
        Remove-Item -Path $workDir -Recurse -Force
    }
    Ensure-Directory -Path $workDir

    $zipPath = Join-Path $workDir 'ffmpeg.zip'
    Download-File -Uri 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.0-latest-win64-gpl-8.0.zip' -OutFile $zipPath
    Expand-Zip -ZipPath $zipPath -Destination $workDir

    $ffmpeg = Get-FirstMatch -Root $workDir -Filter 'ffmpeg.exe'
    $ffprobe = Get-FirstMatch -Root $workDir -Filter 'ffprobe.exe'
    if (-not $ffmpeg -or -not $ffprobe) {
        throw 'Failed to locate ffmpeg.exe or ffprobe.exe after extracting the FFmpeg archive.'
    }

    Copy-Item -Path $ffmpeg.FullName -Destination $ffmpegTarget -Force
    Copy-Item -Path $ffprobe.FullName -Destination $ffprobeTarget -Force
}

if (-not (Resolve-AgentBinary)) {
    throw "Missing required file: $(Join-Path $distDir 'clarix-agent.exe') or $(Join-Path $repoDistDir 'clarix-agent.exe')"
}

$requiredRepoFiles = @(
    @{ Source = (Resolve-AgentBinary); Target = 'clarix-agent.exe' }
    @{ Source = (Join-Path $PSScriptRoot 'setup.bat'); Target = 'setup.bat' }
    @{ Source = (Join-Path $PSScriptRoot 'discover-node.ps1'); Target = 'discover-node.ps1' }
    @{ Source = (Join-Path $PSScriptRoot 'README.txt'); Target = 'README.txt' }
)

$vendorFiles = @(
    @{ Name = 'nssm.exe'; Required = $true }
    @{ Name = 'ffmpeg.exe'; Required = $false }
    @{ Name = 'ffprobe.exe'; Required = $false }
)

try {
    Ensure-NssmBinary
    Ensure-FfmpegBinaries
    Ensure-Directory -Path $OutputRoot

    if (Test-Path $bundleDir) {
        Remove-Item -Path $bundleDir -Recurse -Force
    }
    New-Item -Path $bundleDir -ItemType Directory -Force | Out-Null

    foreach ($file in $requiredRepoFiles) {
        if (-not (Test-Path $file.Source)) {
            throw "Missing required file: $($file.Source)"
        }
        Copy-Item -Path $file.Source -Destination (Join-Path $bundleDir $file.Target) -Force
    }

    foreach ($vendorFile in $vendorFiles) {
        $sourcePath = Join-Path $vendorDir $vendorFile.Name
        if (Test-Path $sourcePath) {
            Copy-Item -Path $sourcePath -Destination (Join-Path $bundleDir $vendorFile.Name) -Force
            continue
        }

        if ($vendorFile.Required -and -not $SkipVendorValidation) {
            throw "Missing required vendor file: $sourcePath"
        }

        Write-Warning "Vendor file not found: $sourcePath"
    }

    $targetConfigPath = Join-Path $bundleDir 'config.yaml'
    if ($ConfigPath) {
        if (-not (Test-Path $ConfigPath)) {
            throw "ConfigPath not found: $ConfigPath"
        }
        Copy-Item -Path $ConfigPath -Destination $targetConfigPath -Force
    } else {
        Copy-Item -Path (Join-Path $PSScriptRoot 'config.example.yaml') -Destination $targetConfigPath -Force
    }

    # README.txt is already copied from $requiredRepoFiles - nothing more to generate here

    if ($Zip) {
        $zipPath = Join-Path $OutputRoot ($effectiveBundleName + '.zip')
        if (Test-Path $zipPath) {
            Remove-Item -Path $zipPath -Force
        }
        Compress-Archive -Path (Join-Path $bundleDir '*') -DestinationPath $zipPath
        Write-Host "Bundle created: $zipPath"
    } else {
        Write-Host "Bundle created: $bundleDir"
    }
}
finally {
    if (Test-Path $tempRoot) {
        Remove-Item -Path $tempRoot -Recurse -Force
    }
}

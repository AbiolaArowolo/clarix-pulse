[CmdletBinding()]
param(
    [string]$RepoRoot = '',
    [string]$ManifestPath,
    [string]$BundleBuilderPath,
    [string]$ReleaseRoot,
    [string]$TokenizedConfigRoot,
    [string]$StagingRoot = '',
    [switch]$PruneReleaseRoot
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Split-Path -Path $PSScriptRoot -Parent
}

$stagingRootWasExplicit = -not [string]::IsNullOrWhiteSpace($StagingRoot)
if (-not $stagingRootWasExplicit) {
    $StagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('clarix-pulse-bundle-rebuild-' + [guid]::NewGuid().ToString('N'))
}

function Resolve-RepoPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $Path))
}

function Ensure-Directory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        New-Item -Path $Path -ItemType Directory -Force | Out-Null
    }
}

function Remove-PathIfPresent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [switch]$BestEffort
    )

    if (-not (Test-Path $Path)) {
        return
    }

    $lastError = $null
    for ($attempt = 1; $attempt -le 5; $attempt++) {
        try {
            Remove-Item -Path $Path -Recurse -Force
            return
        } catch {
            $lastError = $_
            Start-Sleep -Milliseconds 500
        }
    }

    if ($BestEffort) {
        Write-Warning "Unable to remove $Path cleanly: $($lastError.Exception.Message)"
        return
    }

    throw $lastError
}

function Load-BundleManifest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        throw "Bundle manifest not found: $Path"
    }

    $manifest = Get-Content -Raw -Path $Path | ConvertFrom-Json
    if (-not $manifest -or -not $manifest.bundles) {
        throw "Bundle manifest at $Path does not define any bundles."
    }

    return $manifest
}

function Get-BundleVersion {
    param(
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Bundle,
        [string]$DefaultVersion
    )

    if ($Bundle.PSObject.Properties.Name -contains 'version' -and -not [string]::IsNullOrWhiteSpace([string]$Bundle.version)) {
        return [string]$Bundle.version
    }

    return [string]$DefaultVersion
}

function Get-ReleaseName {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BundleName,
        [string]$Version
    )

    if ([string]::IsNullOrWhiteSpace($Version)) {
        return $BundleName
    }

    return "$BundleName-$Version"
}

function Copy-BundleArtifacts {
    param(
        [Parameter(Mandatory = $true)]
        [string]$StageBundleDir,
        [Parameter(Mandatory = $true)]
        [string]$StageZipPath,
        [Parameter(Mandatory = $true)]
        [string]$TargetBundleDir,
        [Parameter(Mandatory = $true)]
        [string]$TargetZipPath
    )

    Remove-PathIfPresent -Path $TargetBundleDir
    Remove-PathIfPresent -Path $TargetZipPath

    Copy-Item -Path $StageBundleDir -Destination $TargetBundleDir -Recurse -Force
    Copy-Item -Path $StageZipPath -Destination $TargetZipPath -Force
}

function Update-LatestBundlesFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [object[]]$SummaryRows,
        [string[]]$UnexpectedItems
    )

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('Pulse Release Guide')
    $lines.Add("Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')")
    $lines.Add('')
    $lines.Add('How to read this folder:')
    $lines.Add('- A folder is the open/unpacked bundle.')
    $lines.Add('- A .zip file is the same bundle compressed for transfer.')
    $lines.Add('- All node bundles should share the same installer/runtime baseline.')
    $lines.Add('')
    $lines.Add('Latest bundles:')
    foreach ($row in $SummaryRows) {
        $lines.Add("- $($row.DisplayName): $($row.ReleaseName) / $($row.ReleaseName).zip")
    }

    if ($UnexpectedItems -and $UnexpectedItems.Count -gt 0) {
        $lines.Add('')
        $lines.Add('Unmanaged leftovers:')
        foreach ($item in $UnexpectedItems) {
            $lines.Add("- $item")
        }
        $lines.Add('These items were not rebuilt from the canonical manifest.')
    }

    [System.IO.File]::WriteAllLines($Path, $lines)
}

if (-not $ManifestPath) {
    $ManifestPath = Join-Path $RepoRoot 'configs\node-bundles.json'
}
if (-not $BundleBuilderPath) {
    $BundleBuilderPath = Join-Path $RepoRoot 'packages\agent\build-node-bundle.ps1'
}
if (-not $ReleaseRoot) {
    $ReleaseRoot = Join-Path $RepoRoot 'packages\agent\release'
}
if (-not $TokenizedConfigRoot) {
    $TokenizedConfigRoot = Join-Path $ReleaseRoot 'tokenized-configs'
}

$ManifestPath = Resolve-RepoPath -Path $ManifestPath
$BundleBuilderPath = Resolve-RepoPath -Path $BundleBuilderPath
$ReleaseRoot = Resolve-RepoPath -Path $ReleaseRoot
$TokenizedConfigRoot = Resolve-RepoPath -Path $TokenizedConfigRoot

if (-not (Test-Path $BundleBuilderPath)) {
    throw "Bundle builder not found: $BundleBuilderPath"
}

Ensure-Directory -Path $ReleaseRoot
Ensure-Directory -Path $TokenizedConfigRoot

$manifest = Load-BundleManifest -Path $ManifestPath
$defaultVersion = [string]$manifest.defaultVersion
$summaryRows = New-Object System.Collections.Generic.List[object]
$results = New-Object System.Collections.Generic.List[object]
$expectedBundleNames = New-Object System.Collections.Generic.List[string]
$expectedZipNames = New-Object System.Collections.Generic.List[string]
$expectedTokenizedNames = New-Object System.Collections.Generic.List[string]

if ($stagingRootWasExplicit) {
    Remove-PathIfPresent -Path $StagingRoot -BestEffort
}
Ensure-Directory -Path $StagingRoot

try {
    foreach ($bundle in $manifest.bundles) {
        if ([string]::IsNullOrWhiteSpace([string]$bundle.bundleName)) {
            throw 'Each manifest entry must define bundleName.'
        }
        $hasConfigPath = $bundle.PSObject.Properties.Name -contains 'configPath' -and -not [string]::IsNullOrWhiteSpace([string]$bundle.configPath)
        $configPath = $null
        if ($hasConfigPath) {
            $configPath = Resolve-RepoPath -Path ([string]$bundle.configPath)
            if (-not (Test-Path $configPath)) {
                throw "Config not found for $($bundle.bundleName): $configPath"
            }
        }

        $version = Get-BundleVersion -Bundle $bundle -DefaultVersion $defaultVersion
        $releaseName = Get-ReleaseName -BundleName ([string]$bundle.bundleName) -Version $version
        $stageBundleDir = Join-Path $StagingRoot $releaseName
        $stageZipPath = Join-Path $StagingRoot ($releaseName + '.zip')
        $targetBundleDir = Join-Path $ReleaseRoot $releaseName
        $targetZipPath = Join-Path $ReleaseRoot ($releaseName + '.zip')
        $tokenizedConfigPath = if ($configPath) {
            Join-Path $TokenizedConfigRoot ([System.IO.Path]::GetFileName($configPath))
        } else {
            $null
        }
        $displayName = if ($bundle.PSObject.Properties.Name -contains 'displayName' -and -not [string]::IsNullOrWhiteSpace([string]$bundle.displayName)) {
            [string]$bundle.displayName
        } else {
            [string]$bundle.bundleName
        }

        if ($configPath) {
            Write-Host "Building $releaseName from $configPath"
            & $BundleBuilderPath `
                -OutputRoot $StagingRoot `
                -BundleName ([string]$bundle.bundleName) `
                -VersionLabel $version `
                -ConfigPath $configPath `
                -Zip
        } else {
            Write-Host "Building $releaseName from generic config.example.yaml"
            & $BundleBuilderPath `
                -OutputRoot $StagingRoot `
                -BundleName ([string]$bundle.bundleName) `
                -VersionLabel $version `
                -Zip
        }

        if (-not (Test-Path $stageBundleDir)) {
            throw "Expected bundle folder was not created: $stageBundleDir"
        }
        if (-not (Test-Path $stageZipPath)) {
            throw "Expected bundle zip was not created: $stageZipPath"
        }

        Copy-BundleArtifacts `
            -StageBundleDir $stageBundleDir `
            -StageZipPath $stageZipPath `
            -TargetBundleDir $targetBundleDir `
            -TargetZipPath $targetZipPath

        if ($configPath) {
            Copy-Item -Path $configPath -Destination $tokenizedConfigPath -Force
        }

        $expectedBundleNames.Add($releaseName)
        $expectedZipNames.Add($releaseName + '.zip')
        if ($configPath) {
            $expectedTokenizedNames.Add([System.IO.Path]::GetFileName($configPath))
        }

        $summaryRows.Add([pscustomobject]@{
            DisplayName = $displayName
            ReleaseName = $releaseName
            ConfigFile = if ($configPath) { [System.IO.Path]::GetFileName($configPath) } else { 'config.example.yaml' }
        })
        $results.Add([pscustomobject]@{
            Bundle = $releaseName
            Config = if ($configPath) { [System.IO.Path]::GetFileName($configPath) } else { 'config.example.yaml' }
            Status = 'Built'
        })
    }

    if ($PruneReleaseRoot) {
        $unexpectedDirectories = Get-ChildItem -Path $ReleaseRoot -Directory | Where-Object {
            $_.Name -ne 'tokenized-configs' -and $_.Name -notin $expectedBundleNames
        }
        foreach ($directory in $unexpectedDirectories) {
            Remove-PathIfPresent -Path $directory.FullName -BestEffort
        }

        $unexpectedZips = Get-ChildItem -Path $ReleaseRoot -File -Filter '*.zip' | Where-Object {
            $_.Name -notin $expectedZipNames
        }
        foreach ($zip in $unexpectedZips) {
            Remove-PathIfPresent -Path $zip.FullName -BestEffort
        }

        $unexpectedTokenizedConfigs = Get-ChildItem -Path $TokenizedConfigRoot -File -Filter '*.yaml' | Where-Object {
            $_.Name -notin $expectedTokenizedNames
        }
        foreach ($tokenizedConfig in $unexpectedTokenizedConfigs) {
            Remove-PathIfPresent -Path $tokenizedConfig.FullName -BestEffort
        }
    }

    $unexpectedItems = @()
    if (-not $PruneReleaseRoot) {
        $unexpectedItems += Get-ChildItem -Path $ReleaseRoot -Directory | Where-Object {
            $_.Name -ne 'tokenized-configs' -and $_.Name -notin $expectedBundleNames
        } | ForEach-Object { $_.Name }
        $unexpectedItems += Get-ChildItem -Path $ReleaseRoot -File -Filter '*.zip' | Where-Object {
            $_.Name -notin $expectedZipNames
        } | ForEach-Object { $_.Name }
    }

    Update-LatestBundlesFile `
        -Path (Join-Path $ReleaseRoot 'LATEST-BUNDLES.txt') `
        -SummaryRows $summaryRows.ToArray() `
        -UnexpectedItems $unexpectedItems
}
finally {
    Remove-PathIfPresent -Path $StagingRoot -BestEffort
}

Write-Host ''
Write-Host 'Bundle rebuild summary'
Write-Host '----------------------'
foreach ($row in $results) {
    Write-Host ("{0,-24} {1,-26} {2}" -f $row.Bundle, $row.Config, $row.Status)
}

[CmdletBinding()]
param(
    [string]$RepoRoot = '',
    [string]$ManifestPath,
    [string]$ReleaseRoot,
    [string]$TokenizedConfigRoot,
    [string[]]$IgnoredRelativePaths = @(
        'config.yaml',
        'BUNDLE-INFO.txt'
    )
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'PulseBundleTools.ps1')

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = Split-Path -Path $PSScriptRoot -Parent
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

function Resolve-AgentBinaryPath {
    $candidates = @(
        (Join-Path $RepoRoot 'packages\agent\dist\clarix-agent.exe'),
        (Join-Path $RepoRoot 'dist\clarix-agent.exe')
    ) | Where-Object { Test-Path $_ }

    if (-not $candidates) {
        return $null
    }

    return $candidates |
        Sort-Object { (Get-Item $_).LastWriteTimeUtc } -Descending |
        Select-Object -First 1
}

function Get-CanonicalBundleSourceFiles {
    $agentRoot = Join-Path $RepoRoot 'packages\agent'
    $agentBinaryPath = Resolve-AgentBinaryPath
    $files = @()

    foreach ($item in @(
        @{ RelativePath = 'setup.bat'; SourcePath = (Join-Path $agentRoot 'setup.bat') },
        @{ RelativePath = 'configure.bat'; SourcePath = (Join-Path $agentRoot 'configure.bat') },
        @{ RelativePath = 'install.bat'; SourcePath = (Join-Path $agentRoot 'install.bat') },
        @{ RelativePath = 'uninstall.bat'; SourcePath = (Join-Path $agentRoot 'uninstall.bat') },
        @{ RelativePath = 'discover-node.ps1'; SourcePath = (Join-Path $agentRoot 'discover-node.ps1') },
        @{ RelativePath = 'show-discovery-summary.ps1'; SourcePath = (Join-Path $agentRoot 'show-discovery-summary.ps1') },
        @{ RelativePath = 'README.txt'; SourcePath = (Join-Path $agentRoot 'README.txt') }
    )) {
        if (-not (Test-Path $item.SourcePath)) {
            throw "Canonical bundle source file missing: $($item.SourcePath)"
        }

        $files += [pscustomobject]@{
            RelativePath = $item.RelativePath
            SourcePath = $item.SourcePath
            Hash = (Get-FileHash -Path $item.SourcePath -Algorithm SHA256).Hash
        }
    }

    if (-not $agentBinaryPath) {
        throw 'Unable to locate clarix-agent.exe in packages/agent/dist or dist.'
    }

    $files += [pscustomobject]@{
        RelativePath = 'clarix-agent.exe'
        SourcePath = $agentBinaryPath
        Hash = (Get-FileHash -Path $agentBinaryPath -Algorithm SHA256).Hash
    }

    return @($files)
}

function Get-RelativeFileMap {
    param(
        [Parameter(Mandatory = $true)]
        [string]$BundlePath,
        [Parameter(Mandatory = $true)]
        [string[]]$IgnoredPaths
    )

    $files = Get-ChildItem -Path $BundlePath -File -Recurse
    $map = @{}
    $bundlePrefix = $BundlePath.TrimEnd('\') + '\'

    foreach ($file in $files) {
        $relativePath = if ($file.FullName.StartsWith($bundlePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $file.FullName.Substring($bundlePrefix.Length)
        } else {
            $file.Name
        }
        $normalizedPath = $relativePath.Replace('\', '/')

        if ($IgnoredPaths -contains $normalizedPath -or $IgnoredPaths -contains $file.Name) {
            continue
        }

        $map[$normalizedPath] = @{
            Hash = (Get-FileHash -Path $file.FullName -Algorithm SHA256).Hash
            Length = $file.Length
        }
    }

    return $map
}

if (-not $ManifestPath) {
    $ManifestPath = Join-Path $RepoRoot 'configs\node-bundles.json'
}
if (-not $ReleaseRoot) {
    $ReleaseRoot = Join-Path $RepoRoot 'packages\agent\release'
}
if (-not $TokenizedConfigRoot) {
    $TokenizedConfigRoot = Join-Path $ReleaseRoot 'tokenized-configs'
}

$ManifestPath = Resolve-RepoPath -Path $ManifestPath
$ReleaseRoot = Resolve-RepoPath -Path $ReleaseRoot
$TokenizedConfigRoot = Resolve-RepoPath -Path $TokenizedConfigRoot

if (-not (Test-Path $ReleaseRoot)) {
    throw "Release root not found: $ReleaseRoot"
}

$manifest = Load-BundleManifest -Path $ManifestPath
$defaultVersion = [string]$manifest.defaultVersion
$issues = New-Object System.Collections.Generic.List[object]
$bundleDescriptors = New-Object System.Collections.Generic.List[object]
$expectedDirectories = @()
$expectedZips = @()
$expectedTokenizedConfigs = @()

foreach ($bundle in $manifest.bundles) {
    $hasConfigPath = $bundle.PSObject.Properties.Name -contains 'configPath' -and -not [string]::IsNullOrWhiteSpace([string]$bundle.configPath)
    $configPath = if ($hasConfigPath) {
        Resolve-RepoPath -Path ([string]$bundle.configPath)
    } else {
        $null
    }
    $version = Get-PulseBundleVersion -RepoRoot $RepoRoot -Bundle $bundle -DefaultVersion $defaultVersion
    $releaseName = Get-ReleaseName -BundleName ([string]$bundle.bundleName) -Version $version
    $bundlePath = Join-Path $ReleaseRoot $releaseName
    $zipPath = Join-Path $ReleaseRoot ($releaseName + '.zip')
    $tokenizedConfigPath = if ($configPath) {
        Join-Path $TokenizedConfigRoot ([System.IO.Path]::GetFileName($configPath))
    } else {
        $null
    }
    $releaseConfigPath = Join-Path $bundlePath 'config.yaml'

    $expectedDirectories += $releaseName
    $expectedZips += ($releaseName + '.zip')
    if ($configPath) {
        $expectedTokenizedConfigs += ([System.IO.Path]::GetFileName($configPath))
    }

    if (-not (Test-Path $bundlePath)) {
        $issues.Add([pscustomobject]@{
            Type = 'Missing'
            Bundle = $releaseName
            File = '(bundle folder)'
            Detail = 'Bundle directory is missing.'
        })
        continue
    }

    if (-not (Test-Path $zipPath)) {
        $issues.Add([pscustomobject]@{
            Type = 'Missing'
            Bundle = $releaseName
            File = '(bundle zip)'
            Detail = 'Bundle zip is missing.'
        })
    }

    if (-not (Test-Path $releaseConfigPath)) {
        $issues.Add([pscustomobject]@{
            Type = 'Missing'
            Bundle = $releaseName
            File = 'config.yaml'
            Detail = 'Bundled config.yaml is missing.'
        })
    } elseif ($configPath) {
        $sourceHash = (Get-FileHash -Path $configPath -Algorithm SHA256).Hash
        $releaseHash = (Get-FileHash -Path $releaseConfigPath -Algorithm SHA256).Hash
        if ($sourceHash -ne $releaseHash) {
            $issues.Add([pscustomobject]@{
                Type = 'ConfigMismatch'
                Bundle = $releaseName
                File = 'config.yaml'
                Detail = "release SHA256=$releaseHash source SHA256=$sourceHash"
            })
        }
    }

    if ($configPath -and -not (Test-Path $tokenizedConfigPath)) {
        $issues.Add([pscustomobject]@{
            Type = 'Missing'
            Bundle = $releaseName
            File = 'tokenized-config'
            Detail = "Missing mirrored source config at $tokenizedConfigPath"
        })
    } elseif ($configPath) {
        $sourceHash = (Get-FileHash -Path $configPath -Algorithm SHA256).Hash
        $tokenizedHash = (Get-FileHash -Path $tokenizedConfigPath -Algorithm SHA256).Hash
        if ($sourceHash -ne $tokenizedHash) {
            $issues.Add([pscustomobject]@{
                Type = 'ConfigMismatch'
                Bundle = $releaseName
                File = 'tokenized-config'
                Detail = "tokenized SHA256=$tokenizedHash source SHA256=$sourceHash"
            })
        }
    }

    $bundleDescriptors.Add([pscustomobject]@{
        ReleaseName = $releaseName
        BundlePath = $bundlePath
    })
}

$unexpectedDirectories = Get-ChildItem -Path $ReleaseRoot -Directory | Where-Object {
    $_.Name -ne 'tokenized-configs' -and $_.Name -notin $expectedDirectories
}
foreach ($directory in $unexpectedDirectories) {
    $issues.Add([pscustomobject]@{
        Type = 'Unexpected'
        Bundle = $directory.Name
        File = '(bundle folder)'
        Detail = 'Not defined in configs/node-bundles.json'
    })
}

$unexpectedZips = Get-ChildItem -Path $ReleaseRoot -File -Filter '*.zip' | Where-Object {
    $_.Name -notin $expectedZips
}
foreach ($zip in $unexpectedZips) {
    $issues.Add([pscustomobject]@{
        Type = 'Unexpected'
        Bundle = $zip.Name
        File = '(bundle zip)'
        Detail = 'Not defined in configs/node-bundles.json'
    })
}

if (Test-Path $TokenizedConfigRoot) {
    $unexpectedTokenizedConfigs = Get-ChildItem -Path $TokenizedConfigRoot -File -Filter '*.yaml' | Where-Object {
        $_.Name -notin $expectedTokenizedConfigs
    }
    foreach ($tokenizedConfig in $unexpectedTokenizedConfigs) {
        $issues.Add([pscustomobject]@{
            Type = 'Unexpected'
            Bundle = 'tokenized-configs'
            File = $tokenizedConfig.Name
            Detail = 'Not defined in configs/node-bundles.json'
        })
    }
}

$bundleMaps = @{}
foreach ($descriptor in $bundleDescriptors) {
    $bundleMaps[$descriptor.ReleaseName] = Get-RelativeFileMap -BundlePath $descriptor.BundlePath -IgnoredPaths $IgnoredRelativePaths
}

$canonicalSourceFiles = @(Get-CanonicalBundleSourceFiles)

foreach ($descriptor in $bundleDescriptors) {
    $bundleMap = $bundleMaps[$descriptor.ReleaseName]
    foreach ($sourceFile in $canonicalSourceFiles) {
        if (-not $bundleMap.ContainsKey($sourceFile.RelativePath)) {
            $issues.Add([pscustomobject]@{
                Type = 'Missing'
                Bundle = $descriptor.ReleaseName
                File = $sourceFile.RelativePath
                Detail = "Missing canonical runtime file from $($sourceFile.SourcePath)"
            })
            continue
        }

        $bundleHash = $bundleMap[$sourceFile.RelativePath].Hash
        if ($bundleHash -ne $sourceFile.Hash) {
            $issues.Add([pscustomobject]@{
                Type = 'SourceMismatch'
                Bundle = $descriptor.ReleaseName
                File = $sourceFile.RelativePath
                Detail = "bundle SHA256=$bundleHash source SHA256=$($sourceFile.Hash)"
            })
        }
    }
}

$allRelativePaths = $bundleMaps.Values |
    ForEach-Object { $_.Keys } |
    Sort-Object -Unique

foreach ($relativePath in $allRelativePaths) {
    $presentEntries = @()
    foreach ($descriptor in $bundleDescriptors) {
        $bundleMap = $bundleMaps[$descriptor.ReleaseName]
        if ($bundleMap.ContainsKey($relativePath)) {
            $presentEntries += [pscustomobject]@{
                Bundle = $descriptor.ReleaseName
                Hash = $bundleMap[$relativePath].Hash
            }
        } else {
            $issues.Add([pscustomobject]@{
                Type = 'Missing'
                Bundle = $descriptor.ReleaseName
                File = $relativePath
                Detail = 'File is missing from this bundle.'
            })
        }
    }

    if ($presentEntries.Count -ne $bundleDescriptors.Count) {
        continue
    }

    [array]$hashes = $presentEntries.Hash | Sort-Object -Unique
    if ($hashes.Count -gt 1) {
        foreach ($entry in $presentEntries) {
            $issues.Add([pscustomobject]@{
                Type = 'Mismatch'
                Bundle = $entry.Bundle
                File = $relativePath
                Detail = "SHA256=$($entry.Hash)"
            })
        }
    }
}

Write-Host "Checked $($bundleDescriptors.Count) manifest-defined bundle(s) under $ReleaseRoot"
Write-Host "Manifest: $ManifestPath"
Write-Host "Ignored relative paths: $($IgnoredRelativePaths -join ', ')"

if ($issues.Count -eq 0) {
    Write-Host 'Parity check passed: bundles match the canonical manifest, source configs, and shared runtime baseline.'
    exit 0
}

Write-Host ''
Write-Host 'Parity check failed: differences were found.'
Write-Host ''
Write-Host ('{0,-16} {1,-24} {2,-28} {3}' -f 'Type', 'Bundle', 'File', 'Detail')
Write-Host ('{0,-16} {1,-24} {2,-28} {3}' -f '----', '------', '----', '------')
foreach ($issue in $issues) {
    Write-Host ('{0,-16} {1,-24} {2,-28} {3}' -f $issue.Type, $issue.Bundle, $issue.File, $issue.Detail)
}

exit 1

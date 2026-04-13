function Get-PulseAgentBinaryPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot
    )

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

function Get-PulseBundleSourcePaths {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,
        [string]$ConfigPath
    )

    $paths = New-Object System.Collections.Generic.List[string]
    $candidates = New-Object System.Collections.Generic.List[string]

    foreach ($path in @(
        (Join-Path $RepoRoot 'packages\agent\build-node-bundle.ps1'),
        (Join-Path $RepoRoot 'packages\agent\agent.py'),
        (Join-Path $RepoRoot 'packages\agent\setup.bat'),
        (Join-Path $RepoRoot 'packages\agent\configure.bat'),
        (Join-Path $RepoRoot 'packages\agent\install.bat'),
        (Join-Path $RepoRoot 'packages\agent\uninstall.bat'),
        (Join-Path $RepoRoot 'packages\agent\install-from-url.ps1'),
        (Join-Path $RepoRoot 'packages\agent\remove-pulse-agent.ps1'),
        (Join-Path $RepoRoot 'packages\agent\discover-node.ps1'),
        (Join-Path $RepoRoot 'packages\agent\show-discovery-summary.ps1'),
        (Join-Path $RepoRoot 'packages\agent\confidence_scorer.py'),
        (Join-Path $RepoRoot 'packages\agent\learning_store.py'),
        (Join-Path $RepoRoot 'packages\agent\fingerprint_manifest.json'),
        (Join-Path $RepoRoot 'packages\agent\README.txt')
    )) {
        [void]$candidates.Add($path)
    }

    if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        [void]$candidates.Add((Join-Path $RepoRoot 'packages\agent\config.example.yaml'))
    } else {
        [void]$candidates.Add($ConfigPath)
    }

    $agentBinary = Get-PulseAgentBinaryPath -RepoRoot $RepoRoot
    if ($agentBinary) {
        [void]$candidates.Add($agentBinary)
    }

    foreach ($vendorName in @('nssm.exe', 'ffmpeg.exe', 'ffprobe.exe')) {
        $vendorPath = Join-Path $RepoRoot ("packages\agent\vendor\" + $vendorName)
        if (Test-Path $vendorPath) {
            [void]$candidates.Add($vendorPath)
        }
    }

    foreach ($candidate in $candidates) {
        if (-not (Test-Path $candidate)) {
            continue
        }

        [void]$paths.Add([System.IO.Path]::GetFullPath($candidate))
    }

    return $paths | Sort-Object -Unique
}

function Get-PulseBundleVersion {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RepoRoot,
        [Parameter(Mandatory = $true)]
        [pscustomobject]$Bundle,
        [string]$DefaultVersion
    )

    $baseVersion = if (
        $Bundle.PSObject.Properties.Name -contains 'version' -and
        -not [string]::IsNullOrWhiteSpace([string]$Bundle.version)
    ) {
        [string]$Bundle.version
    } else {
        [string]$DefaultVersion
    }

    $isStaticVersion = $Bundle.PSObject.Properties.Name -contains 'staticVersion' -and [bool]$Bundle.staticVersion
    if ($isStaticVersion -or [string]::IsNullOrWhiteSpace($baseVersion)) {
        return $baseVersion
    }

    $configPath = $null
    if ($Bundle.PSObject.Properties.Name -contains 'configPath' -and -not [string]::IsNullOrWhiteSpace([string]$Bundle.configPath)) {
        $configPath = if ([System.IO.Path]::IsPathRooted([string]$Bundle.configPath)) {
            [System.IO.Path]::GetFullPath([string]$Bundle.configPath)
        } else {
            [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ([string]$Bundle.configPath)))
        }
    }

    $sourcePaths = Get-PulseBundleSourcePaths -RepoRoot $RepoRoot -ConfigPath $configPath
    if (-not $sourcePaths -or $sourcePaths.Count -eq 0) {
        return $baseVersion
    }

    $latestWrite = $sourcePaths |
        ForEach-Object { Get-Item $_ } |
        Sort-Object LastWriteTimeUtc -Descending |
        Select-Object -First 1

    if (-not $latestWrite) {
        return $baseVersion
    }

    $stamp = $latestWrite.LastWriteTimeUtc.ToString('yyyyMMdd.HHmmss')
    return "$baseVersion.$stamp"
}

function Get-PulseBundleSortKey {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    $match = [regex]::Match($Name, 'clarix-pulse-v([\d.]+)(?:\.zip)?$')
    if (-not $match.Success) {
        return ''
    }

    $parts = $match.Groups[1].Value.Split('.') | ForEach-Object {
        try {
            '{0:D12}' -f [int]$_
        } catch {
            '000000000000'
        }
    }

    return ($parts -join '.')
}

function Get-PulseLatestReleaseDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ReleaseRoot,
        [string]$BundleName = 'clarix-pulse'
    )

    if (-not (Test-Path $ReleaseRoot)) {
        return $null
    }

    $directories = Get-ChildItem -Path $ReleaseRoot -Directory | Where-Object {
        $_.Name -like ($BundleName + '-v*')
    }

    if (-not $directories) {
        return $null
    }

    return $directories |
        Sort-Object { Get-PulseBundleSortKey -Name $_.Name } -Descending |
        Select-Object -First 1
}

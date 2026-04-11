#Requires -Version 5.1
<#
.SYNOPSIS
    Uninstalls and fully cleans up the Clarix Pulse Agent from a Windows PC.

.DESCRIPTION
    Stops and removes the ClarixPulseAgent Windows service (via sc.exe and NSSM),
    kills any running agent processes, removes all install directories, scheduled
    tasks, and registry keys left behind by Clarix Pulse.

.PARAMETER WhatIf
    Print what would be done without actually deleting anything.

.EXAMPLE
    .\remove-pulse-agent.ps1
    .\remove-pulse-agent.ps1 -WhatIf
#>
param(
    [switch]$WhatIf,
    [string]$InstallRoot = ''
)

if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    $InstallRoot = [string]$env:CLARIX_INSTALL_ROOT
}

$ErrorActionPreference = 'Continue'

# -- Resolve script directory (safe for all run modes incl. iex/stdin pipe) --
$_scriptDir = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
} elseif (-not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Definition) -and
          $MyInvocation.MyCommand.Definition -notmatch '^<') {
    Split-Path -Parent $MyInvocation.MyCommand.Definition
} else {
    (Get-Location).Path
}

$script:NormalizedInstallRoot = ''
if (-not [string]::IsNullOrWhiteSpace($InstallRoot)) {
    try {
        $script:NormalizedInstallRoot = [System.IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
    } catch {
        $script:NormalizedInstallRoot = $InstallRoot.Trim()
    }
}

# -- Self-elevate to Administrator if not already ----------------------------
$script:isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $script:isAdmin) {
    $scriptPath = $MyInvocation.MyCommand.Definition
    $psExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell.exe' }
    $whatIfArg = if ($WhatIf) { ' -WhatIf' } else { '' }
    try {
        Start-Process $psExe -ArgumentList "-ExecutionPolicy Bypass -NoProfile -File `"$scriptPath`"$whatIfArg" -Verb RunAs -ErrorAction Stop
        exit
    } catch {
        Write-Warning "Could not elevate to Administrator. Continuing without elevation - some steps may fail."
    }
}

# ============================================================================
# HELPERS
# ============================================================================

$script:removedItems  = [System.Collections.Generic.List[string]]::new()
$script:skippedItems  = [System.Collections.Generic.List[string]]::new()
$script:failedItems   = [System.Collections.Generic.List[string]]::new()

function Write-Ok   { param([string]$Msg) Write-Host "  [OK]      $Msg" -ForegroundColor Green  }
function Write-Skip { param([string]$Msg) Write-Host "  [SKIP]    $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "  [ERROR]   $Msg" -ForegroundColor Red    }
function Write-Info { param([string]$Msg) Write-Host "  $Msg"           -ForegroundColor Cyan   }

function Invoke-Step {
    <#
    .SYNOPSIS
        Wraps a scriptblock in try/catch and records the result.
    .PARAMETER Label
        Short description used in the summary.
    .PARAMETER Action
        Scriptblock to execute. Must return $true (done), $false (skipped), or throw.
    #>
    param(
        [string]$Label,
        [scriptblock]$Action
    )
    try {
        $result = & $Action
        if ($result -eq $false) {
            $script:skippedItems.Add($Label) | Out-Null
        } else {
            $script:removedItems.Add($Label) | Out-Null
        }
    } catch {
        Write-Fail "$Label - $_"
        $script:failedItems.Add("$Label ($_)") | Out-Null
    }
}

function Get-ServiceProcessId {
    param([string]$ServiceName)

    try {
        $service = Get-CimInstance -ClassName Win32_Service -Filter "Name='$ServiceName'" -ErrorAction Stop
        if ($service -and $service.ProcessId -gt 0) {
            return [int]$service.ProcessId
        }
    } catch {
        # Best effort only. Locked-down hosts can refuse CIM access.
    }

    return $null
}

function Get-ClarixProcessIds {
    $candidateIds = [System.Collections.Generic.HashSet[int]]::new()
    $currentPid = $PID

    $processes = Get-CimInstance -ClassName Win32_Process -ErrorAction SilentlyContinue
    foreach ($proc in $processes) {
        try {
            $pid = [int]$proc.ProcessId
            if ($pid -le 0 -or $pid -eq $currentPid) {
                continue
            }

            $name = [string]$proc.Name
            $exePath = [string]$proc.ExecutablePath
            $cmdLine = [string]$proc.CommandLine
            $haystack = "$name $exePath $cmdLine".ToLowerInvariant()

            $isClarixProcess = $haystack -match 'clarix-agent|clarixpulse'
            if (-not $isClarixProcess) {
                $baseName = ([System.IO.Path]::GetFileName($name)).ToLowerInvariant()
                if ($baseName -in @('ffmpeg.exe', 'ffprobe.exe', 'nssm.exe', 'ffmpeg', 'ffprobe', 'nssm')) {
                    if ($haystack -match 'clarix|pulse') {
                        $isClarixProcess = $true
                    } elseif (
                        -not [string]::IsNullOrWhiteSpace($script:NormalizedInstallRoot) -and
                        $haystack -like ("*" + $script:NormalizedInstallRoot.ToLowerInvariant() + "*")
                    ) {
                        $isClarixProcess = $true
                    }
                }
            }
            if (-not $isClarixProcess) {
                continue
            }

            [void]$candidateIds.Add($pid)
        } catch {
            continue
        }
    }

    return @($candidateIds | Sort-Object)
}

function Stop-ClarixProcesses {
    param(
        [switch]$WhatIf,
        [int]$MaxAttempts = 4,
        [int]$DelayMilliseconds = 900
    )

    for ($attempt = 1; $attempt -le [Math]::Max(1, $MaxAttempts); $attempt++) {
        $candidateIds = @(Get-ClarixProcessIds)
        if (-not $candidateIds -or $candidateIds.Count -eq 0) {
            if ($attempt -eq 1) {
                Write-Skip "No Clarix agent processes found"
                return $false
            }
            Write-Ok "No Clarix processes remain running"
            return $true
        }

        if ($WhatIf) {
            Write-Info "WhatIf: Would Stop-Process -Id $($candidateIds -join ', ') -Force"
            return $true
        }

        Stop-Process -Id $candidateIds -Force -ErrorAction SilentlyContinue
        Write-Info "Stopped process IDs: $($candidateIds -join ', ') (attempt $attempt)"
        Start-Sleep -Milliseconds ([Math]::Max(100, $DelayMilliseconds))
    }

    $remaining = @(Get-ClarixProcessIds)
    if ($remaining.Count -gt 0) {
        throw "Clarix process(es) still running after retries: $($remaining -join ', ')"
    }

    Write-Ok "No Clarix processes remain running"
    return $true
}

function Remove-ClarixStartupRemnants {
    $removedAny = $false

    $registryTargets = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunServices',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunServicesOnce',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunOnce',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunServices',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\RunServicesOnce',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run32'
    )

    foreach ($keyPath in $registryTargets) {
        try {
            if (-not (Test-Path $keyPath)) {
                continue
            }

            $props = Get-ItemProperty -LiteralPath $keyPath -ErrorAction Stop
            $valueNames = $props.PSObject.Properties |
                Where-Object { $_.Name -notmatch '^PS' } |
                Select-Object -ExpandProperty Name

            foreach ($valueName in $valueNames) {
                $value = $props.$valueName
                $valueText = if ($null -ne $value) { [string]$value } else { '' }
                if (
                    $valueName -notmatch '(?i)clarix|pulse' -and
                    $valueText -notmatch '(?i)clarix|pulse|clarix-agent'
                ) {
                    continue
                }

                if ($WhatIf) {
                    Write-Info "WhatIf: Would remove autorun entry '$keyPath\$valueName'"
                    $removedAny = $true
                    continue
                }

                Remove-ItemProperty -LiteralPath $keyPath -Name $valueName -ErrorAction Stop
                Write-Ok "Removed autorun entry: $keyPath\$valueName"
                $removedAny = $true
            }
        } catch {
            Write-Skip "Could not inspect autorun key '$keyPath': $_"
        }
    }

    $startupRoots = @(
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'),
        (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu\Programs\Startup')
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

    foreach ($root in $startupRoots) {
        if (-not (Test-Path $root)) {
            continue
        }

        try {
            foreach ($entry in Get-ChildItem -LiteralPath $root -Force -ErrorAction SilentlyContinue) {
                if ($entry.Name -notmatch '(?i)clarix|pulse') {
                    continue
                }

                if ($WhatIf) {
                    Write-Info "WhatIf: Would remove startup item '$($entry.FullName)'"
                    $removedAny = $true
                    continue
                }

                Remove-Item -LiteralPath $entry.FullName -Recurse -Force -ErrorAction Stop
                Write-Ok "Removed startup item: $($entry.FullName)"
                $removedAny = $true
            }
        } catch {
            Write-Skip "Could not inspect startup folder '$root': $_"
        }
    }

    if (-not $removedAny) {
        Write-Skip "No startup remnants found"
        return $false
    }

    return $true
}

# ============================================================================
# BANNER
# ============================================================================

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
if ($WhatIf) {
    Write-Host "  Clarix Pulse Agent - Cleanup Script  [WHATIF MODE]" -ForegroundColor Cyan
} else {
    Write-Host "  Clarix Pulse Agent - Cleanup Script" -ForegroundColor Cyan
}
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host ""

# ============================================================================
# 0. BEST-EFFORT HUB DECOMMISSION (SO STALE NODES DISAPPEAR FROM HUB)
# ============================================================================

Write-Host "-- 0. Hub Decommission ------------------------------------" -ForegroundColor White

Invoke-Step "Notify hub node decommission" {
    if ($WhatIf) {
        Write-Info "WhatIf: Would request hub decommission using clarix-agent.exe --decommission-hub"
        return $true
    }

    # Stop any running service first so the node cannot re-register while
    # decommission is in flight.
    foreach ($svcName in @('ClarixPulseAgent', 'clarix-pulse-agent')) {
        try {
            $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
            if ($svc -and $svc.Status -ne 'Stopped') {
                Write-Info "Stopping service '$svcName' before hub decommission"
                & sc.exe stop $svcName 2>&1 | Out-Null
                Start-Sleep -Milliseconds 800
            }
        } catch {
            Write-Skip "Could not pre-stop service '$svcName' before decommission: $_"
        }
    }

    $null = Stop-ClarixProcesses -WhatIf:$WhatIf

    $agentCandidates = @(
        (Join-Path $_scriptDir 'clarix-agent.exe'),
        (Join-Path $env:ProgramData 'ClarixPulse\Agent\clarix-agent.exe')
    ) | Where-Object {
        -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path $_)
    } | Select-Object -Unique

    if (-not $agentCandidates) {
        Write-Skip "No clarix-agent.exe found for hub decommission - continuing with local cleanup"
        return $false
    }

    foreach ($agentExe in $agentCandidates) {
        try {
            Write-Info "Attempting hub decommission via $agentExe"
            $output = & $agentExe --decommission-hub 2>&1
            if ($LASTEXITCODE -eq 0) {
                if ($output) {
                    Write-Host "  $($output -join [Environment]::NewLine)" -ForegroundColor DarkGray
                }
                Write-Ok "Hub decommission requested successfully"
                return $true
            }
            Write-Skip "Decommission attempt via '$agentExe' returned exit code $LASTEXITCODE"
            if ($output) {
                Write-Host "  $($output -join [Environment]::NewLine)" -ForegroundColor DarkGray
            }
        } catch {
            Write-Skip "Decommission attempt via '$agentExe' failed: $_"
        }
    }

    Write-Skip "Hub decommission could not be confirmed - local cleanup will continue"
    return $false
}

# ============================================================================
# 1. STOP AND REMOVE THE WINDOWS SERVICE
# ============================================================================

Write-Host "-- 1. Windows Service --------------------------------------" -ForegroundColor White

$serviceNames = @('ClarixPulseAgent', 'clarix-pulse-agent')

foreach ($svcName in $serviceNames) {
    Invoke-Step "Stop service '$svcName'" {
        $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
        if (-not $svc) {
            Write-Skip "Service '$svcName' not found - skipping stop"
            return $false
        }
        if ($svc.Status -ne 'Stopped') {
            if ($WhatIf) {
                Write-Info "WhatIf: Would stop service '$svcName'"
                return $true
            }
            & sc.exe stop $svcName 2>&1 | Out-Null
            # Give it up to 10 s to stop
            $deadline = (Get-Date).AddSeconds(10)
            while ((Get-Service -Name $svcName -ErrorAction SilentlyContinue).Status -ne 'Stopped' -and (Get-Date) -lt $deadline) {
                Start-Sleep -Milliseconds 500
            }
            $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
            if ($svc -and $svc.Status -ne 'Stopped') {
                $servicePid = Get-ServiceProcessId -ServiceName $svcName
                if ($servicePid) {
                    Write-Info "Service '$svcName' did not stop in time; forcing PID $servicePid"
                    Stop-Process -Id $servicePid -Force -ErrorAction Stop
                    Start-Sleep -Milliseconds 750
                    $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
                }
            }
            if ($svc -and $svc.Status -ne 'Stopped') {
                throw "Service '$svcName' is still in state '$($svc.Status)'"
            }
            Write-Ok "Stopped service '$svcName'"
        } else {
            Write-Skip "Service '$svcName' already stopped"
        }
        return $true
    }

    Invoke-Step "Delete service '$svcName'" {
        $svc = Get-Service -Name $svcName -ErrorAction SilentlyContinue
        if (-not $svc) {
            Write-Skip "Service '$svcName' not found - skipping delete"
            return $false
        }
        if ($WhatIf) {
            Write-Info "WhatIf: Would delete service '$svcName' via sc.exe delete"
            return $true
        }
        $out = & sc.exe delete $svcName 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Ok "Deleted service '$svcName'"
        } else {
            Write-Fail "sc.exe delete '$svcName' returned $LASTEXITCODE - $out"
            $script:failedItems.Add("sc.exe delete $svcName") | Out-Null
        }
        return $true
    }
}

# -- NSSM removal (if nssm.exe is present beside this script) ----------------
Invoke-Step "NSSM service removal" {
    $nssmPath = Join-Path $_scriptDir 'nssm.exe'
    if (-not (Test-Path $nssmPath)) {
        Write-Skip "nssm.exe not found beside script - skipping NSSM removal"
        return $false
    }
    $removedViaNssm = $false
    foreach ($svcName in $serviceNames) {
        $statusOut = & $nssmPath status $svcName 2>&1
        if ($LASTEXITCODE -ne 0 -or ($statusOut -match 'Can.t open service' -or $statusOut -match 'No such service')) {
            continue
        }
        if ($WhatIf) {
            Write-Info "WhatIf: Would run nssm.exe remove '$svcName' confirm"
            $removedViaNssm = $true
            continue
        }
        & $nssmPath stop   $svcName confirm 2>&1 | Out-Null
        & $nssmPath remove $svcName confirm 2>&1 | Out-Null
        Write-Ok "Removed service '$svcName' via NSSM"
        $removedViaNssm = $true
    }
    if (-not $removedViaNssm) {
        Write-Skip "No NSSM-managed Clarix services found"
        return $false
    }
    return $true
}

# ============================================================================
# 2. KILL RUNNING AGENT PROCESSES
# ============================================================================

Write-Host ""
Write-Host "-- 2. Running Processes ------------------------------------" -ForegroundColor White

Invoke-Step "Kill Clarix agent process(es)" {
    Stop-ClarixProcesses -WhatIf:$WhatIf
}

# ============================================================================
# 3. REMOVE DIRECTORIES
# ============================================================================

Write-Host ""
Write-Host "-- 3. Directories ------------------------------------------" -ForegroundColor White

$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
if ([string]::IsNullOrWhiteSpace($localAppData)) {
    $localAppData = $env:LOCALAPPDATA
}
$tempPath = [System.IO.Path]::GetTempPath()

$dirsToRemove = @(
    'C:\ClarixPulse',
    'C:\ProgramData\ClarixPulse',
    'C:\pulse-node-bundle',
    'C:\Program Files\ClarixPulse',
    'C:\Program Files (x86)\ClarixPulse'
)
if (-not [string]::IsNullOrWhiteSpace($script:NormalizedInstallRoot)) {
    $dirsToRemove += $script:NormalizedInstallRoot
}
if (-not [string]::IsNullOrWhiteSpace($localAppData)) {
    $dirsToRemove += @(
        (Join-Path $localAppData 'ClarixPulse'),
        (Join-Path $localAppData 'ClarixPulse\Bundles')
    )
}
if (-not [string]::IsNullOrWhiteSpace($tempPath)) {
    $dirsToRemove += (Join-Path $tempPath 'ClarixPulse\Bundles')
}
$dirsToRemove = $dirsToRemove | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

foreach ($dir in $dirsToRemove) {
    Invoke-Step "Remove directory '$dir'" {
        if (-not (Test-Path $dir)) {
            Write-Skip "Directory not found: $dir"
            return $false
        }
        if ($WhatIf) {
            Write-Info "WhatIf: Would Remove-Item -Recurse -Force '$dir'"
            return $true
        }
        Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction Stop
        Write-Ok "Removed directory: $dir"
        return $true
    }
}

# -- Relative directories beside this script ----------------------------------
$relativeDirs = Get-ChildItem -Path $_scriptDir -Directory -ErrorAction SilentlyContinue |
    Where-Object {
        $_.Name -eq 'pulse-node-bundle' -or
        $_.Name -eq 'clarix-pulse' -or
        $_.Name -like 'clarix-pulse-v*'
    } |
    Select-Object -ExpandProperty FullName -Unique

foreach ($fullPath in $relativeDirs) {
    $rel = Split-Path $fullPath -Leaf
    Invoke-Step "Remove relative directory '$rel'" {
        if (-not (Test-Path $fullPath)) {
            Write-Skip "Relative directory not found: $fullPath"
            return $false
        }
        if ($WhatIf) {
            Write-Info "WhatIf: Would Remove-Item -Recurse -Force '$fullPath'"
            return $true
        }
        Remove-Item -LiteralPath $fullPath -Recurse -Force -ErrorAction Stop
        Write-Ok "Removed directory: $fullPath"
        return $true
    }
}

# ============================================================================
# 4. REMOVE SCHEDULED TASKS
# ============================================================================

Write-Host ""
Write-Host "-- 4. Scheduled Tasks --------------------------------------" -ForegroundColor White

Invoke-Step "Remove ClarixPulse / clarix scheduled tasks" {
    $tasks = Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
        $_.TaskName -like '*ClarixPulse*' -or $_.TaskName -like '*clarix*'
    }
    if (-not $tasks -or $tasks.Count -eq 0) {
        Write-Skip "No matching scheduled tasks found"
        return $false
    }
    foreach ($task in $tasks) {
        if ($WhatIf) {
            Write-Info "WhatIf: Would Unregister-ScheduledTask '$($task.TaskName)' (path: $($task.TaskPath))"
            continue
        }
        try {
            Unregister-ScheduledTask -TaskName $task.TaskName -TaskPath $task.TaskPath -Confirm:$false -ErrorAction Stop
            Write-Ok "Removed scheduled task: $($task.TaskPath)$($task.TaskName)"
        } catch {
            Write-Fail "Could not remove scheduled task '$($task.TaskName)': $_"
            $script:failedItems.Add("Scheduled task: $($task.TaskName) ($_)") | Out-Null
        }
    }
    return $true
}

# ============================================================================
# 5. REMOVE REGISTRY KEYS
# ============================================================================

Write-Host ""
Write-Host "-- 5. Registry Keys ----------------------------------------" -ForegroundColor White

$regKeys = @(
    'HKLM:\SOFTWARE\ClarixPulse',
    'HKCU:\SOFTWARE\ClarixPulse'
)

foreach ($key in $regKeys) {
Invoke-Step "Remove registry key '$key'" {
        if (-not (Test-Path $key)) {
            Write-Skip "Registry key not found: $key"
            return $false
        }
        if ($WhatIf) {
            Write-Info "WhatIf: Would Remove-Item -Recurse -Force '$key'"
            return $true
        }
        Remove-Item -LiteralPath $key -Recurse -Force -ErrorAction Stop
        Write-Ok "Removed registry key: $key"
        return $true
    }
}

# ============================================================================
# 6. REMOVE STARTUP REMNANTS
# ============================================================================

Write-Host ""
Write-Host "-- 6. Startup Remnants -------------------------------------" -ForegroundColor White

Invoke-Step "Remove startup autorun remnants" {
    Remove-ClarixStartupRemnants
}

# ============================================================================
# 7. FINAL PROCESS SWEEP
# ============================================================================

Write-Host ""
Write-Host "-- 7. Final Process Sweep ----------------------------------" -ForegroundColor White

Invoke-Step "Ensure no Clarix process is still running" {
    Stop-ClarixProcesses -WhatIf:$WhatIf -MaxAttempts 5 -DelayMilliseconds 1200
}

# ============================================================================
# SUMMARY
# ============================================================================

Write-Host ""
Write-Host "===========================================================" -ForegroundColor Cyan
Write-Host "  Cleanup Summary" -ForegroundColor Cyan
Write-Host "===========================================================" -ForegroundColor Cyan

if ($script:removedItems.Count -gt 0) {
    Write-Host ""
    Write-Host "  Removed ($($script:removedItems.Count)):" -ForegroundColor Green
    foreach ($item in $script:removedItems) {
        Write-Host "    + $item" -ForegroundColor Green
    }
}

if ($script:skippedItems.Count -gt 0) {
    Write-Host ""
    Write-Host "  Not found / skipped ($($script:skippedItems.Count)):" -ForegroundColor Yellow
    foreach ($item in $script:skippedItems) {
        Write-Host "    - $item" -ForegroundColor Yellow
    }
}

if ($script:failedItems.Count -gt 0) {
    Write-Host ""
    Write-Host "  Failed ($($script:failedItems.Count)):" -ForegroundColor Red
    foreach ($item in $script:failedItems) {
        Write-Host "    ! $item" -ForegroundColor Red
    }
}

Write-Host ""
if ($WhatIf) {
    Write-Host "  [WHATIF] No changes were made." -ForegroundColor Cyan
} elseif ($script:failedItems.Count -eq 0) {
    Write-Host "  Clarix Pulse Agent cleanup complete." -ForegroundColor Green
} else {
    Write-Host "  Clarix Pulse Agent cleanup finished with $($script:failedItems.Count) error(s)." -ForegroundColor Yellow
}
if (-not $script:isAdmin) {
    Write-Host "  Administrator approval is still required to remove the Windows service and protected ClarixPulse folders on locked-down PCs." -ForegroundColor Yellow
}
Write-Host ""

if ($script:failedItems.Count -gt 0) {
    exit 1
}

exit 0

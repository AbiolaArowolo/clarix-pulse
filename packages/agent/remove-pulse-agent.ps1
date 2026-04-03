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
    [switch]$WhatIf
)

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

# -- Self-elevate to Administrator if not already ----------------------------
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
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

Invoke-Step "Kill clarix-agent process(es)" {
    $procs = Get-Process -Name 'clarix-agent' -ErrorAction SilentlyContinue
    if (-not $procs) {
        Write-Skip "No 'clarix-agent' process found"
        return $false
    }
    if ($WhatIf) {
        Write-Info "WhatIf: Would Stop-Process -Name clarix-agent -Force ($($procs.Count) process(es))"
        return $true
    }
    Stop-Process -Name 'clarix-agent' -Force -ErrorAction SilentlyContinue
    Write-Ok "Killed $($procs.Count) 'clarix-agent' process(es)"
    return $true
}

# ============================================================================
# 3. REMOVE DIRECTORIES
# ============================================================================

Write-Host ""
Write-Host "-- 3. Directories ------------------------------------------" -ForegroundColor White

$dirsToRemove = @(
    'C:\ProgramData\ClarixPulse',
    'C:\pulse-node-bundle',
    'C:\Program Files\ClarixPulse',
    'C:\Program Files (x86)\ClarixPulse'
)

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
$relativeDirs = @(
    'pulse-node-bundle',
    'clarix-pulse-v1.9'
)

foreach ($rel in $relativeDirs) {
    $fullPath = Join-Path $_scriptDir $rel
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
Write-Host ""

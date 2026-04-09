param(
    [string]$OutputPath = '',
    [ValidateSet('auto',
        'insta', 'admax',
        'cinegy_air', 'playbox_neo', 'grass_valley_itx', 'imagine_versio', 'broadstream_oasys',
        'pebble_marina', 'evertz_streampro', 'axel_xplayout', 'florical_airboss', 'ross_inception',
        'viz_mosart', 'chyron_prime', 'wideorbit', 'bitcentral', 'harmonic_spectrum',
        'etere', 'aveco', 'pixel_power', 'caspar_cg', 'enco_dad', 'rcs_zetta',
        'myriad_playout', 'playout_one', 'radio_dj', 'playit_live', 'zara_studio',
        'proppfrexx', 'sam_broadcaster', 'station_playlist', 'mairlist', 'radioboss',
        'jazler', 'hardata', 'nextkast', 'obs_studio', 'mixxx',
        'dalet', 'vsn_vsnexplorer', 'autocad_media', 'snell_morpheus', 'tv_one',
        'generic_windows')]
    [string]$PlayoutHint = 'auto',
    [switch]$StdOut
)

# -- PS version check --------------------------------------------------------
$_psVersion = $PSVersionTable.PSVersion.Major

# -- Fix execution policy silently if blocked --------------------------------
try {
    $policy = Get-ExecutionPolicy -Scope CurrentUser -ErrorAction SilentlyContinue
    if ($policy -eq 'Restricted' -or $policy -eq 'Undefined') {
        Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope CurrentUser -Force -ErrorAction SilentlyContinue
    }
} catch { }

# Note: Registry reads (HKLM) do not require Administrator — no elevation needed for discovery.

# -- Resolve script directory (safe for all run modes incl. iex/stdin pipe) --
# $PSScriptRoot is "" when piped via iex; fall back to $MyInvocation then CWD
$_scriptDir = if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $PSScriptRoot
} elseif (-not [string]::IsNullOrWhiteSpace($MyInvocation.MyCommand.Definition) -and
          $MyInvocation.MyCommand.Definition -notmatch '^<') {
    Split-Path -Parent $MyInvocation.MyCommand.Definition
} else {
    (Get-Location).Path
}

# -- Default output path: same folder as this script -------------------------
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $_scriptDir 'pulse-node-discovery-report.json'
}

$ErrorActionPreference = 'Stop'
# PS 5.1 strict mode causes crashes on empty array returns - use explicit @() wrapping instead
if ($_psVersion -ge 7) { Set-StrictMode -Version Latest } else { Set-StrictMode -Off }

function Is-PlaceholderValue {
    param(
        [string]$Value,
        [ValidateSet('generic', 'url', 'enrollment')]
        [string]$Kind = 'generic'
    )

    $trimmed = ([string]$Value).Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed)) { return $true }

    $normalized = $trimmed.ToLowerInvariant()
    $genericPatterns = @(
        '^<.*>$',
        '^\[.*\]$',
        'replace',
        'changeme',
        '^example$',
        'placeholder',
        'your[_\-\s]?',
        'to[_\-\s]?do',
        '^xxx+$',
        '^test$',
        '^null$'
    )
    foreach ($pattern in $genericPatterns) {
        if ($normalized -match $pattern) { return $true }
    }

    if ($Kind -eq 'url') {
        if ($normalized -match 'monitor\.example\.com' -or $normalized -match '^https?://(example|localhost)') {
            return $true
        }
    }

    if ($Kind -eq 'enrollment') {
        if ($normalized -match 'enroll' -and $normalized -match 'replace') { return $true }
        if ($normalized -match 'replace_with_hub_enrollment_key') { return $true }
    }

    return $false
}

# -- Read pulse-account.json (injected into the bundle per-tenant) ------------
$_accountHubUrl      = ''
$_accountEnrollmentKey = ''
$_accountJsonPath = Join-Path $_scriptDir 'pulse-account.json'
if (Test-Path -LiteralPath $_accountJsonPath -PathType Leaf) {
    try {
        $ErrorActionPreference = 'SilentlyContinue'
        $accountData = Get-Content -LiteralPath $_accountJsonPath -Raw | ConvertFrom-Json
        $accountHubCandidate = if ($accountData.hubUrl) { [string]$accountData.hubUrl } elseif ($accountData.hub_url) { [string]$accountData.hub_url } else { '' }
        $accountEnrollmentCandidate = if ($accountData.enrollmentKey) { [string]$accountData.enrollmentKey } elseif ($accountData.enrollment_key) { [string]$accountData.enrollment_key } else { '' }
        if ($accountHubCandidate -and -not (Is-PlaceholderValue -Value $accountHubCandidate -Kind 'url')) {
            $_accountHubUrl = $accountHubCandidate
        }
        if ($accountEnrollmentCandidate -and -not (Is-PlaceholderValue -Value $accountEnrollmentCandidate -Kind 'enrollment')) {
            $_accountEnrollmentKey = $accountEnrollmentCandidate
        }
        $ErrorActionPreference = 'Stop'
    } catch {
        $ErrorActionPreference = 'Stop'
    }
}

$script:DiscoveryScanStartedAt = Get-Date

function Write-DiscoveryStage {
    param([string]$Message)
    if ($StdOut) { return }
    $elapsedSeconds = [Math]::Max(0, [int]((Get-Date) - $script:DiscoveryScanStartedAt).TotalSeconds)
    Write-Host ("[Pulse Scan +{0}s] {1}" -f $elapsedSeconds, $Message)
}

$_discoveryStartedAt = Get-Date
$script:_discoveryPhaseTotal = 9

function Write-DiscoveryPhase {
    param([int]$Step, [string]$Message)
    if ($StdOut) { return }

    $phaseTotal = [Math]::Max(1, [int]$script:_discoveryPhaseTotal)
    $normalizedStep = [Math]::Min($phaseTotal, [Math]::Max(1, [int]$Step))
    $percent = [Math]::Min(100, [Math]::Max(0, [int](($normalizedStep - 1) * 100 / $phaseTotal)))

    Write-Progress -Activity 'Clarix Pulse discovery scan' -Status $Message -PercentComplete $percent
    Write-Host ('[{0}/{1}] {2}' -f $normalizedStep, $phaseTotal, $Message)
}

function Complete-DiscoveryPhase {
    param([string]$Message = 'Discovery scan complete')
    if ($StdOut) { return }

    $elapsedSeconds = [Math]::Max(0, [int]((Get-Date) - $_discoveryStartedAt).TotalSeconds)
    Write-Progress -Activity 'Clarix Pulse discovery scan' -Completed
    Write-Host ('[{0}/{0}] {1} ({2}s)' -f ([int]$script:_discoveryPhaseTotal), $Message, $elapsedSeconds)
}

# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

function Get-EnvPathOrFallback {
    param([string]$Name, [string]$Fallback)
    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) { return $Fallback }
    return $value
}

function Convert-ToNodeSlug {
    param([string]$Value)
    $raw = $Value
    if ([string]::IsNullOrWhiteSpace($raw)) { $raw = $env:COMPUTERNAME }
    $slug = $raw.ToLowerInvariant() -replace '[^a-z0-9]+', '-'
    $slug = $slug.Trim('-')
    if ([string]::IsNullOrWhiteSpace($slug)) { return 'windows-node' }
    return $slug
}

function Convert-ToObjectArray {
    param($Value)

    if ($null -eq $Value) { return @() }
    if ($Value -is [string]) { return @([string]$Value) }
    if ($Value -is [System.Collections.IEnumerable]) {
        return @($Value | ForEach-Object { $_ })
    }
    return @($Value)
}

function Get-DiscoveryThresholds {
    return [ordered]@{
        high   = 0.85
        medium = 0.60
        low    = 0.0
    }
}

function Get-ConfidenceBand {
    param(
        [double]$Confidence,
        [hashtable]$Thresholds = (Get-DiscoveryThresholds)
    )

    if ($Confidence -ge [double]$Thresholds.high) { return 'high' }
    if ($Confidence -ge [double]$Thresholds.medium) { return 'medium' }
    return 'low'
}

function Get-DiscoveryPythonCommand {
    foreach ($candidate in @('python.exe', 'python', 'py.exe', 'py')) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($command -and -not [string]::IsNullOrWhiteSpace([string]$command.Source)) {
            return [string]$command.Source
        }
    }
    return ''
}

function New-LegacyDetectionResult {
    param([object[]]$Players)

    $thresholds = Get-DiscoveryThresholds
    $detections = New-Object System.Collections.Generic.List[object]
    foreach ($player in @($Players)) {
        $playerId = [string]$player.player_id
        $playerType = if ($player.playout_type) { [string]$player.playout_type } else { 'generic_windows' }
        $legacyConfidence = 0.0
        if ($player.discovery -and $null -ne $player.discovery.confidence) {
            $legacyConfidence = [double]$player.discovery.confidence
        }
        $confidence = [Math]::Round($legacyConfidence, 2)
        $confidenceBand = Get-ConfidenceBand -Confidence $confidence -Thresholds $thresholds
        $instanceId = if ($playerId) { $playerId } else { '{0}:{1}' -f $playerType, ($detections.Count + 1) }
        $label = if ($player.label) { [string]$player.label } else { [string]$playerType }
        $evidenceSources = if ($player.discovery -and $player.discovery.evidence) { @($player.discovery.evidence) } else { @() }

        [void]$detections.Add([ordered]@{
            player_id           = $playerId
            player_type         = $playerType
            instance_id         = $instanceId
            confidence          = $confidence
            confidence_band     = $confidenceBand
            needs_confirmation  = $confidenceBand -ne 'high'
            suggested_label     = $label
            legacy_confidence   = $confidence
            learning_match      = $null
            evidence            = @(
                [ordered]@{
                    type         = 'legacy'
                    weight       = 1.0
                    strength     = $confidence
                    contribution = $confidence
                    summary      = 'Legacy PowerShell heuristics'
                    sources      = $evidenceSources
                }
            )
        })
    }

    $highCount = @($detections | Where-Object { $_.confidence_band -eq 'high' }).Count
    $mediumCount = @($detections | Where-Object { $_.confidence_band -eq 'medium' }).Count
    $lowCount = @($detections | Where-Object { $_.confidence_band -eq 'low' }).Count
    $needsConfirmationCount = @($detections | Where-Object { $_.needs_confirmation }).Count
    $summary = @{
        total              = $detections.Count
        high               = $highCount
        medium             = $mediumCount
        low                = $lowCount
        needs_confirmation = $needsConfirmationCount
    }
    $result = @{
        generated_at = (Get-Date).ToUniversalTime().ToString('o')
        thresholds   = $thresholds
        detections   = (Convert-ToObjectArray -Value $detections)
        summary      = $summary
        engine       = 'legacy-fallback'
    }
    return $result
}

function Invoke-DiscoveryConfidenceScorer {
    param([object[]]$Players)

    $players = @($Players)
    if ($players.Count -eq 0) {
        return (New-LegacyDetectionResult -Players @())
    }

    $thresholds = Get-DiscoveryThresholds
    $payload = [ordered]@{ players = $players }
    $inputPath = [System.IO.Path]::GetTempFileName()

    try {
        [System.IO.File]::WriteAllText(
            $inputPath,
            ($payload | ConvertTo-Json -Depth 16),
            (New-Object System.Text.UTF8Encoding $false)
        )

        $dbPath = Join-Path (Get-EnvPathOrFallback -Name 'ProgramData' -Fallback 'C:\ProgramData') 'ClarixPulse\learned_fingerprints.db'
        $scorerScript = Join-Path $_scriptDir 'confidence_scorer.py'
        $agentExeCandidates = @(
            (Join-Path $_scriptDir 'clarix-agent.exe'),
            (Join-Path (Join-Path $_scriptDir 'dist') 'clarix-agent.exe')
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf }

        $commandsToTry = New-Object System.Collections.Generic.List[object]
        $pythonCommand = Get-DiscoveryPythonCommand
        if ($pythonCommand -and (Test-Path -LiteralPath $scorerScript -PathType Leaf)) {
            [void]$commandsToTry.Add([ordered]@{
                engine = 'python'
                file   = $pythonCommand
                args   = @($scorerScript, '--input', $inputPath, '--db-path', $dbPath)
            })
        }
        foreach ($agentExe in $agentExeCandidates) {
            [void]$commandsToTry.Add([ordered]@{
                engine = 'agent-exe'
                file   = [string]$agentExe
                args   = @('--score-discovery', $inputPath, '--db-path', $dbPath)
            })
        }

        foreach ($command in $commandsToTry) {
            try {
                $rawLines = & $command.file @($command.args) 2>&1
                $exitCode = if ($null -ne $LASTEXITCODE) { [int]$LASTEXITCODE } else { 0 }
                if ($exitCode -ne 0) { continue }

                $outputText = (@($rawLines) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
                if ([string]::IsNullOrWhiteSpace($outputText)) { continue }

                $parsed = $outputText | ConvertFrom-Json
                if ($null -eq $parsed -or $null -eq $parsed.detections) { continue }

                return [ordered]@{
                    generated_at = if ($parsed.generated_at) { $parsed.generated_at } else { (Get-Date).ToUniversalTime().ToString('o') }
                    thresholds   = if ($parsed.thresholds) { $parsed.thresholds } else { $thresholds }
                    detections   = @($parsed.detections)
                    summary      = if ($parsed.summary) { $parsed.summary } else { [ordered]@{ total = @($parsed.detections).Count } }
                    engine       = [string]$command.engine
                }
            } catch {
                continue
            }
        }
    } finally {
        if (Test-Path -LiteralPath $inputPath) {
            Remove-Item -LiteralPath $inputPath -Force -ErrorAction SilentlyContinue
        }
    }

    return (New-LegacyDetectionResult -Players $players)
}

function Apply-DetectionMetadata {
    param(
        [object[]]$Players,
        [object[]]$Detections
    )

    $detectionByPlayerId = @{}
    foreach ($detection in @($Detections)) {
        $playerId = [string]$detection.player_id
        if (-not [string]::IsNullOrWhiteSpace($playerId)) {
            $detectionByPlayerId[$playerId] = $detection
        }
    }

    foreach ($player in @($Players)) {
        $playerId = [string]$player.player_id
        if (-not $detectionByPlayerId.ContainsKey($playerId)) { continue }

        $detection = $detectionByPlayerId[$playerId]
        $player.instance_id = [string]$detection.instance_id
        $player.discovery.confidence = [double]$detection.confidence
        $player.discovery.confidence_band = [string]$detection.confidence_band
        $player.discovery.needs_confirmation = [bool]$detection.needs_confirmation
        $player.discovery.suggested_label = [string]$detection.suggested_label
        $player.discovery.legacy_confidence = [double]$detection.legacy_confidence
        $player.discovery.evidence_breakdown = @($detection.evidence)
    }
}

function Get-UniqueStrings {
    param([string[]]$Values)
    $seen  = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $items = New-Object System.Collections.Generic.List[string]
    foreach ($value in ($Values | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
        $trimmed = $value.Trim()
        if ($seen.Add($trimmed)) { [void]$items.Add($trimmed) }
    }
    return @($items)
}

function Get-FirstExistingDirectory {
    param([string[]]$Candidates)
    foreach ($candidate in (Get-UniqueStrings -Values $Candidates)) {
        if (Test-Path -LiteralPath $candidate -PathType Container) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return ''
}

function Get-FirstExistingFile {
    param([string[]]$Candidates)
    foreach ($candidate in (Get-UniqueStrings -Values $Candidates)) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }
    return ''
}

function Get-SafeDirectories {
    param([string]$Path, [string]$Filter = '*', [switch]$Recurse)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path -PathType Container)) { return @() }
    try {
        if ($Recurse) { return @(Get-ChildItem -Path $Path -Directory -Filter $Filter -Recurse -ErrorAction SilentlyContinue) }
        return @(Get-ChildItem -Path $Path -Directory -Filter $Filter -ErrorAction SilentlyContinue)
    } catch { return @() }
}

function Get-SafeFiles {
    param([string]$Path, [string]$Filter = '*', [switch]$Recurse)
    if ([string]::IsNullOrWhiteSpace($Path) -or -not (Test-Path -LiteralPath $Path)) { return @() }
    try {
        if ($Recurse) { return @(Get-ChildItem -Path $Path -File -Filter $Filter -Recurse -ErrorAction SilentlyContinue) }
        return @(Get-ChildItem -Path $Path -File -Filter $Filter -ErrorAction SilentlyContinue)
    } catch { return @() }
}

function Get-RecentLogFileCount {
    param([string]$DirectoryPath)
    if ([string]::IsNullOrWhiteSpace($DirectoryPath) -or -not (Test-Path -LiteralPath $DirectoryPath -PathType Container)) { return 0 }
    $count = 0
    foreach ($filter in @('*.log', '*.txt')) { $count += @(Get-SafeFiles -Path $DirectoryPath -Filter $filter).Count }
    return $count
}

function New-PathMap {
    param([hashtable]$Entries)
    $result = [ordered]@{}
    foreach ($key in $Entries.Keys) {
        $value = $Entries[$key]
        if ($null -eq $value) { continue }
        if ($value -is [System.Collections.IEnumerable] -and -not ($value -is [string])) {
            $normalized = @($value | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
            if ($normalized.Count -gt 0) { $result[$key] = $normalized }
            continue
        }
        if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $result[$key] = [string]$value }
    }
    return $result
}

function New-PlayerReport {
    param(
        [string]$NodeId, [int]$Index, [string]$PlayoutType, [string]$Label,
        [hashtable]$Paths, [hashtable]$ProcessSelectors, [hashtable]$LogSelectors,
        [string[]]$Evidence, [double]$Confidence,
        [bool]$Installed = $true, [bool]$Running = $false
    )
    $playerId = '{0}-{1}-{2}' -f $NodeId, $PlayoutType, ($Index + 1)
    return [ordered]@{
        player_id          = $playerId
        label              = $Label
        playout_type       = $PlayoutType
        installed          = $Installed
        running            = $Running
        monitoring_enabled = $true
        paths              = (New-PathMap -Entries $Paths)
        process_selectors  = (New-PathMap -Entries $ProcessSelectors)
        log_selectors      = (New-PathMap -Entries $LogSelectors)
        udp_inputs         = @()
        discovery          = [ordered]@{
            confidence = [Math]::Round($Confidence, 2)
            evidence   = @(Get-UniqueStrings -Values $Evidence)
        }
    }
}

# ============================================================================
# PROCESS DETECTION
# ============================================================================

$_broadcastRuntimePatterns = '((^|[^a-z0-9])insta([^a-z0-9]|$)|(^|[^a-z0-9])admax([^a-z0-9]|$)|cinegy|airbox|itx|versio|broadstream|oasys|marina|evertz|xplayout|xtvsuit|youplay|mosart|florical|airboss|wideorbit|woplayout|bitcentral|inception|chyron|streampro|etere|aveco|astra|gallium|casparcg|enco|dad\.exe|zetta|dalet|galaxy|morpheus|vsn|myriad|playout|playoutone|radiodj|playit|zarastudio|zararadio|proppfrexx|sambroad|sam4|spl|mairlist|radioboss|jazler|dinesat|nextkast|nexgen|obs64|obs\.exe|mixxx|(^|[^a-z0-9])broadcast([^a-z0-9]|$)|(^|[^a-z0-9])onair([^a-z0-9]|$)|encoder\.exe|transcod|wirecast|vmix|xsplit|streamlabs|livestreamer|streamlink|vMix)'

# Broad folder-name patterns used by Find-GenericBroadcastFromFolders.
# These are intentionally wider than $_broadcastRuntimePatterns and are only
# applied after verifying a running process or service exists in that folder.
$_broadcastFolderPatterns = @(
    '*broadcast*',
    '*automation*',
    '*streaming*',
    '*encoder*',
    '*transmiss*',
    '*on-air*',
    '*onair*',
    '*playout*',
    '*radio*',
    '*media-server*',
    '*mediaserver*'
)

# Returns names of any running processes whose exe lives inside a given directory
function Get-ProcessNamesInDirectory {
    param([string]$DirectoryPath)
    $names = New-Object System.Collections.Generic.List[string]
    if ([string]::IsNullOrWhiteSpace($DirectoryPath)) { return @($names) }
    try {
        $dirNorm = $DirectoryPath.TrimEnd('\').ToLowerInvariant()
        $procs = Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_.ExecutablePath) -and $_.ExecutablePath.ToLowerInvariant().StartsWith($dirNorm) }
        foreach ($p in $procs) {
            if (-not [string]::IsNullOrWhiteSpace($p.Name)) { [void]$names.Add($p.Name) }
        }
    } catch { }
    return @(Get-UniqueStrings -Values @($names))
}

function Get-ExecutablePathFromCommand {
    param([string]$CommandText)
    $text = [string]$CommandText
    if ([string]::IsNullOrWhiteSpace($text)) { return '' }

    $candidate = ''
    if ($text -match '^\s*"([^"]+?\.exe)"') {
        $candidate = $matches[1]
    } elseif ($text -match "^\s*'([^']+?\.exe)'") {
        $candidate = $matches[1]
    } elseif ($text -match '^\s*([^\s]+?\.exe)\b') {
        $candidate = $matches[1]
    }

    if ([string]::IsNullOrWhiteSpace($candidate)) { return '' }
    try {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    } catch { }
    return $candidate.Trim()
}

function Get-CommandLineSelector {
    param([string]$CommandText, [string]$ExecutablePath = '')
    $selector = ([string]$CommandText).Trim()
    if ([string]::IsNullOrWhiteSpace($selector)) { return '' }

    foreach ($prefix in @(
        ('"{0}"' -f $ExecutablePath),
        ("'{0}'" -f $ExecutablePath),
        $ExecutablePath
    )) {
        if ([string]::IsNullOrWhiteSpace($prefix)) { continue }
        if ($selector.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
            $selector = $selector.Substring($prefix.Length).Trim()
            break
        }
    }

    return $selector
}

function Get-WindowTitleForProcessId {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return '' }
    try {
        $process = Get-Process -Id $ProcessId -ErrorAction Stop
        $title = [string]$process.MainWindowTitle
        if (-not [string]::IsNullOrWhiteSpace($title)) { return $title.Trim() }
    } catch { }
    return ''
}

function Get-RunningProcessHints {
    $rows = New-Object System.Collections.Generic.List[object]
    try {
        $processes = Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object {
                $_.Name -match $_broadcastRuntimePatterns -or
                $_.ExecutablePath -match $_broadcastRuntimePatterns -or
                $_.CommandLine -match $_broadcastRuntimePatterns
            }
        foreach ($process in $processes) {
            $processId = 0
            try { $processId = [int]$process.ProcessId } catch { $processId = 0 }
            [void]$rows.Add([ordered]@{
                name            = $process.Name
                executable_path = $process.ExecutablePath
                command_line    = $process.CommandLine
                process_id      = $processId
                window_title    = (Get-WindowTitleForProcessId -ProcessId $processId)
            })
        }
    } catch { return @() }
    return @($rows | Select-Object -First 50)
}

function Get-ServiceHints {
    $rows = New-Object System.Collections.Generic.List[object]
    try {
        $services = Get-CimInstance Win32_Service -ErrorAction Stop |
            Where-Object {
                $_.Name -match $_broadcastRuntimePatterns -or
                $_.DisplayName -match $_broadcastRuntimePatterns -or
                $_.PathName -match $_broadcastRuntimePatterns
            }
        foreach ($service in $services) {
            $processId = 0
            try { $processId = [int]$service.ProcessId } catch { $processId = 0 }
            $pathName = [string]$service.PathName
            $executablePath = Get-ExecutablePathFromCommand -CommandText $pathName
            [void]$rows.Add([ordered]@{
                name            = $service.Name
                display_name    = $service.DisplayName
                path_name       = $pathName
                executable_path = $executablePath
                process_id      = $processId
                started         = [bool]$service.Started
                state           = [string]$service.State
                start_mode      = [string]$service.StartMode
                window_title    = (Get-WindowTitleForProcessId -ProcessId $processId)
            })
        }
    } catch { return @() }
    return @($rows | Select-Object -First 50)
}

function Get-StartupCommandHints {
    $rows = New-Object System.Collections.Generic.List[object]
    try {
        $commands = Get-CimInstance Win32_StartupCommand -ErrorAction Stop |
            Where-Object {
                $_.Name -match $_broadcastRuntimePatterns -or
                $_.Command -match $_broadcastRuntimePatterns -or
                $_.Location -match $_broadcastRuntimePatterns
            }
        foreach ($command in $commands) {
            $commandText = [string]$command.Command
            [void]$rows.Add([ordered]@{
                name            = $command.Name
                command         = $commandText
                location        = [string]$command.Location
                executable_path = (Get-ExecutablePathFromCommand -CommandText $commandText)
            })
        }
    } catch { return @() }
    return @($rows | Select-Object -First 50)
}

function Get-ScheduledTaskHints {
    $rows = New-Object System.Collections.Generic.List[object]
    if (-not (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue)) { return @() }

    try {
        foreach ($task in (Get-ScheduledTask -ErrorAction SilentlyContinue)) {
            foreach ($action in @($task.Actions)) {
                $execute = [string]$action.Execute
                $arguments = [string]$action.Arguments
                $workingDirectory = [string]$action.WorkingDirectory
                $commandText = (@($execute, $arguments) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ' '
                $identity = @($task.TaskName, $task.TaskPath, $execute, $arguments, $workingDirectory) -join ' '
                if ($identity -notmatch $_broadcastRuntimePatterns) { continue }

                [void]$rows.Add([ordered]@{
                    task_name         = $task.TaskName
                    task_path         = $task.TaskPath
                    command           = $commandText.Trim()
                    executable_path   = (Get-ExecutablePathFromCommand -CommandText $commandText)
                    working_directory = $workingDirectory
                })
            }
        }
    } catch { return @() }

    return @($rows | Select-Object -First 50)
}

# ============================================================================
# INSTA PLAYER DISCOVERY
# ============================================================================

function Find-InstaPlayers {
    param([string]$NodeId)
    $programFiles    = Get-EnvPathOrFallback -Name 'ProgramFiles'    -Fallback 'C:\Program Files'
    $programFilesX86 = Get-EnvPathOrFallback -Name 'ProgramFiles(x86)' -Fallback 'C:\Program Files (x86)'
    $players = New-Object System.Collections.Generic.List[object]

    # Group all 'Insta Playout*' channel dirs by their parent Indytek folder.
    # 'Insta Playout', 'Insta Playout 2', 'Insta Playout 3' etc. are channel
    # instances of ONE installation — report as one player, not N players.
    $indytekParents = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($baseDir in @($programFiles, $programFilesX86)) {
        $indytekRoot = Join-Path $baseDir 'Indytek'
        if (Test-Path -LiteralPath $indytekRoot -PathType Container) {
            [void]$indytekParents.Add($indytekRoot)
        }
    }

    $playerIndex = 0
    foreach ($indytekRoot in $indytekParents) {
        $channelDirs = @(Get-SafeDirectories -Path $indytekRoot -Filter 'Insta Playout*')
        if ($channelDirs.Count -eq 0) { continue }

        # Require the actual executable to exist in at least one channel dir — folders alone are stale
        $hasExe = $false
        foreach ($ch in $channelDirs) {
            $candidate = Get-SafeFiles -Path $ch.FullName -Filter 'Insta Playout.exe' -Recurse | Select-Object -First 1
            if ($candidate) { $hasExe = $true; break }
        }
        # Running process also counts as confirmed
        $procCheck = $false
        try {
            $proc = Get-CimInstance Win32_Process -Filter "Name = 'Insta Playout.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($proc) { $procCheck = $true }
        } catch { }
        if (-not $hasExe -and -not $procCheck) { continue }

        # Collect paths across all channel dirs — first valid value wins for each field
        $firstChannelDir  = $channelDirs[0].FullName
        $sharedLogDir = Get-FirstExistingDirectory -Candidates @(
            (Join-Path $indytekRoot 'Insta log'),
            (Join-Path $firstChannelDir 'Insta log'),
            (Join-Path $firstChannelDir 'logs')
        )
        $fnfLog = Get-FirstExistingDirectory -Candidates @(
            (Join-Path $sharedLogDir 'FNF'),
            (Join-Path $sharedLogDir 'fnf')
        )
        $playlistScanLog = Get-FirstExistingDirectory -Candidates @(
            (Join-Path $firstChannelDir 'logs\playlistscan'),
            (Join-Path $firstChannelDir 'playlistscan')
        )

        # Check if any instance is currently running
        $isRunning = $false
        try {
            $proc = Get-CimInstance Win32_Process -Filter "Name = 'Insta Playout.exe'" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($proc) { $isRunning = $true }
        } catch { }

        $channelCount = $channelDirs.Count
        $evidence = New-Object System.Collections.Generic.List[string]
        [void]$evidence.Add("Insta Playout installed at $indytekRoot ($channelCount channel$(if ($channelCount -ne 1) {'s'}))")
        foreach ($ch in $channelDirs) { [void]$evidence.Add("Channel folder: $($ch.FullName)") }
        if ($sharedLogDir)    { [void]$evidence.Add("Shared log folder: $sharedLogDir") }
        if ($fnfLog)          { [void]$evidence.Add("FNF log folder: $fnfLog") }
        if ($playlistScanLog) { [void]$evidence.Add("Playlist scan log: $playlistScanLog") }
        if ($isRunning)       { [void]$evidence.Add("Process is currently running") }

        $label = if ($channelCount -gt 1) { "Insta Playout ($channelCount ch)" } else { 'Insta Playout' }

        [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $playerIndex -PlayoutType 'insta' -Label $label -Paths @{
            install_dir      = $indytekRoot
            shared_log_dir   = $sharedLogDir
            fnf_log          = $fnfLog
            playlistscan_log = $playlistScanLog
        } -ProcessSelectors @{ process_names = @('Insta Playout.exe') } -LogSelectors @{} -Evidence @($evidence) -Confidence 0.92 -Installed $true -Running $isRunning))
        $playerIndex += 1
    }

    return @($players | ForEach-Object { $_ })
}

# Override the earlier aggregate-channel implementation so each Insta channel
# is surfaced as its own monitored player on older and newer PowerShell builds.
function Get-InstaSharedExecutable {
    param([string]$IndytekRoot, [string]$ChannelPath)
    return Get-FirstExistingFile -Candidates @(
        (Join-Path $ChannelPath 'Insta Playout.exe'),
        (Join-Path $ChannelPath 'Insta Helper.exe'),
        (Join-Path $IndytekRoot 'Insta Playout.exe'),
        (Join-Path $IndytekRoot 'Insta Helper.exe')
    )
}

function Test-InstaChannelRuntimeEvidence {
    param([string]$ChannelPath, [string]$InstanceRoot)
    $candidateFiles = @(
        (Join-Path $InstanceRoot 'runningstatus.txt'),
        (Join-Path $InstanceRoot 'filebar.txt'),
        (Join-Path $InstanceRoot 'Mainplaylist.xml'),
        (Join-Path $InstanceRoot 'MainplaylistOrig.xml'),
        (Join-Path $ChannelPath 'Mainplaylist.xml'),
        (Join-Path $ChannelPath 'MainplaylistOrig.xml')
    )

    if (Test-Path -LiteralPath $InstanceRoot -PathType Container) { return $true }
    foreach ($candidate in $candidateFiles) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $true }
    }
    return $false
}

function Get-InstaRuntimeFlags {
    param([string]$InstanceRoot)
    $statusPath = Join-Path $InstanceRoot 'runningstatus.txt'
    $filebarPath = Join-Path $InstanceRoot 'filebar.txt'
    $runningFlag = $null
    $pauseFlag = $null
    $rawStatus = ''

    if (Test-Path -LiteralPath $statusPath -PathType Leaf) {
        try {
            $rawStatus = ((Get-Content -LiteralPath $statusPath -ErrorAction Stop | Select-Object -First 1) -as [string]).Trim()
        } catch { }
        if ($rawStatus -match '^\s*(\d+)\s*\|\s*(\d+)') {
            $runningFlag = [int]$matches[1]
            $pauseFlag = [int]$matches[2]
        }
    }

    return [ordered]@{
        has_status_file = (Test-Path -LiteralPath $statusPath -PathType Leaf)
        has_filebar     = (Test-Path -LiteralPath $filebarPath -PathType Leaf)
        running_flag    = $runningFlag
        pause_flag      = $pauseFlag
        raw_status      = $rawStatus
    }
}

function Find-InstaPlayers {
    param([string]$NodeId)
    $programFiles    = Get-EnvPathOrFallback -Name 'ProgramFiles'    -Fallback 'C:\Program Files'
    $programFilesX86 = Get-EnvPathOrFallback -Name 'ProgramFiles(x86)' -Fallback 'C:\Program Files (x86)'
    $players = New-Object System.Collections.Generic.List[object]
    $indytekRoots = New-Object System.Collections.Generic.List[string]

    foreach ($baseDir in @($programFiles, $programFilesX86)) {
        $indytekRoot = Join-Path $baseDir 'Indytek'
        if (Test-Path -LiteralPath $indytekRoot -PathType Container) {
            [void]$indytekRoots.Add($indytekRoot)
        }
    }

    $playerIndex = 0
    foreach ($indytekRoot in (Get-UniqueStrings -Values @($indytekRoots))) {
        $channelDirs = @(Get-SafeDirectories -Path $indytekRoot -Filter 'Insta Playout*' | Sort-Object FullName)
        foreach ($channelDir in $channelDirs) {
            $channelPath = $channelDir.FullName
            $instanceRoot = Get-FirstExistingDirectory -Candidates @(
                (Join-Path $channelPath 'Settings'),
                $channelPath
            )
            $detectedProcessNames = @(Get-ProcessNamesInDirectory -DirectoryPath $channelPath)
            $sharedExecutablePath = Get-InstaSharedExecutable -IndytekRoot $indytekRoot -ChannelPath $channelPath
            # Compute runtime flags early so they can inform the channel-evidence filter below.
            $runtimeFlags = Get-InstaRuntimeFlags -InstanceRoot $instanceRoot

            # Require channel-specific evidence, not just "directory exists" or "shared exe present".
            # A channel folder is only a real player when at least one of these is true:
            #   1. A process is currently running from this channel dir.
            #   2. The channel has its own copy of the exe (not just the shared root exe).
            #   3. A Settings subfolder was found (means the channel has been configured).
            #   4. Runtime state files exist (runningstatus.txt, filebar.txt, playlist XML).
            #   5. A playlist-scan log dir exists (the channel has been used).
            $hasChannelEvidence =
                ($detectedProcessNames.Count -gt 0) -or
                (Test-Path -LiteralPath (Join-Path $channelPath 'Insta Playout.exe') -PathType Leaf) -or
                (Test-Path -LiteralPath (Join-Path $channelPath 'Insta Helper.exe')  -PathType Leaf) -or
                ($instanceRoot -ne $channelPath) -or
                $runtimeFlags.has_status_file -or
                $runtimeFlags.has_filebar -or
                (Test-Path -LiteralPath (Join-Path $channelPath 'Mainplaylist.xml')     -PathType Leaf) -or
                (Test-Path -LiteralPath (Join-Path $channelPath 'MainplaylistOrig.xml') -PathType Leaf)
            if (-not $hasChannelEvidence) { continue }

            $sharedLogDir = Get-FirstExistingDirectory -Candidates @(
                (Join-Path $indytekRoot 'Insta log'),
                (Join-Path $channelPath 'Insta log'),
                (Join-Path $channelPath 'logs')
            )
            $fnfCandidates = @()
            if ($sharedLogDir) {
                $fnfCandidates = @(
                    (Join-Path $sharedLogDir 'FNF'),
                    (Join-Path $sharedLogDir 'fnf')
                )
            }
            $fnfLog = Get-FirstExistingDirectory -Candidates $fnfCandidates
            $playlistScanLog = Get-FirstExistingDirectory -Candidates @(
                (Join-Path $channelPath 'logs\playlistscan'),
                (Join-Path $channelPath 'playlistscan')
            )
            $processNames = if ($detectedProcessNames.Count -gt 0) { $detectedProcessNames } else { @('Insta Playout.exe') }
            $processSelectors = @{ process_names = $processNames }
            if (-not [string]::IsNullOrWhiteSpace($sharedExecutablePath)) {
                $processSelectors.executable_path_contains = @($sharedExecutablePath)
            } else {
                $processSelectors.executable_path_contains = @($channelPath)
            }
            $isRunning = ($detectedProcessNames.Count -gt 0) -or (
                ($runtimeFlags.running_flag -ne $null -and [int]$runtimeFlags.running_flag -ne 0) -or
                ($runtimeFlags.pause_flag -eq 1) -or
                ($runtimeFlags.has_filebar -and $detectedProcessNames.Count -gt 0)
            )
            $label = $channelDir.Name

            $evidence = New-Object System.Collections.Generic.List[string]
            [void]$evidence.Add("Insta channel found at $channelPath")
            if ($instanceRoot)    { [void]$evidence.Add("Instance root: $instanceRoot") }
            if ($sharedExecutablePath) { [void]$evidence.Add("Shared executable: $sharedExecutablePath") }
            if ($sharedLogDir)    { [void]$evidence.Add("Shared log folder: $sharedLogDir") }
            if ($fnfLog)          { [void]$evidence.Add("FNF log folder: $fnfLog") }
            if ($playlistScanLog) { [void]$evidence.Add("Playlist scan log: $playlistScanLog") }
            if ($runtimeFlags.has_status_file) { [void]$evidence.Add("runningstatus.txt detected") }
            if ($runtimeFlags.has_filebar)     { [void]$evidence.Add("filebar.txt detected") }
            foreach ($processName in $processNames) {
                [void]$evidence.Add("Process selector: $processName")
            }

            [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $playerIndex -PlayoutType 'insta' -Label $label -Paths @{
                install_dir      = $channelPath
                instance_root    = $instanceRoot
                shared_log_dir   = $sharedLogDir
                fnf_log          = $fnfLog
                playlistscan_log = $playlistScanLog
            } -ProcessSelectors $processSelectors -LogSelectors @{} -Evidence @($evidence) -Confidence 0.92 -Installed $true -Running $isRunning))
            $playerIndex += 1
        }
    }

    return @($players | ForEach-Object { $_ })
}

# ============================================================================
# ADMAX PLAYER DISCOVERY
# ============================================================================

function Get-AdmaxExecutableFilters {
    return @(
        'admax.exe',
        'AdmaxPlayout.exe',
        'AdmaxService.exe',
        'admax_service.exe',
        'AdmaxOne.exe',
        'unistreamer.exe',
        'Admax-One Playout2.0.exe',
        'Admax-One Playout2.0.2.exe',
        'AdmaxBroadcast.exe',
        'AdmaxLauncher.exe',
        'AdmaxEngine.exe',
        'AdmaxPlayer.exe',
        'AdmaxScheduler.exe',
        'AdmaxController.exe',
        'Admax-One*.exe',
        'Admax*.exe'
    )
}

function Resolve-AdmaxRootCandidate {
    param([string]$ExecutablePath)
    if ([string]::IsNullOrWhiteSpace($ExecutablePath)) { return '' }

    $parentCandidates = New-Object System.Collections.Generic.List[string]
    $current = Split-Path -Path $ExecutablePath -Parent
    for ($depth = 0; $depth -lt 4 -and -not [string]::IsNullOrWhiteSpace($current); $depth++) {
        [void]$parentCandidates.Add($current)
        $next = Split-Path -Path $current -Parent
        if ([string]::IsNullOrWhiteSpace($next) -or $next -eq $current) { break }
        $current = $next
    }

    $bestCandidate = ''
    $bestScore = -1
    foreach ($candidate in (Get-UniqueStrings -Values @($parentCandidates))) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Container)) { continue }
        $leaf = (Split-Path -Path $candidate -Leaf)
        $settingsIni = Get-FirstExistingFile -Candidates @(
            (Join-Path $candidate 'Settings.ini'),
            (Join-Path $candidate 'bin\Settings.ini'),
            (Join-Path $candidate 'bin\64bit\Settings.ini')
        )
        $logDir = Get-FirstExistingDirectory -Candidates @(
            (Join-Path $candidate 'logs'),
            (Join-Path $candidate 'logs\Playout'),
            (Join-Path $candidate 'logs\logs\Playout'),
            (Join-Path $candidate 'bin\64bit\logs'),
            (Join-Path $candidate 'bin\64bit\logs\Playout'),
            (Join-Path $candidate 'bin\64bit\logs\logs\Playout')
        )
        $score = -1
        if ($leaf -match 'admax') {
            $score = 4
        } elseif ($settingsIni -or $logDir) {
            $score = 3
        } elseif ($leaf -match 'unimedia') {
            $score = 2
        }
        if ($score -gt $bestScore) {
            $bestScore = $score
            $bestCandidate = (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    return $bestCandidate
}

function Find-AdmaxRootCandidates {
    param(
        [object[]]$RunningProcesses = @(),
        [object[]]$ServiceHints = @(),
        [object[]]$StartupHints = @(),
        [object[]]$ScheduledTaskHints = @(),
        [object[]]$UninstallEntries = @()
    )
    $programFiles    = Get-EnvPathOrFallback -Name 'ProgramFiles'    -Fallback 'C:\Program Files'
    $programFilesX86 = Get-EnvPathOrFallback -Name 'ProgramFiles(x86)' -Fallback 'C:\Program Files (x86)'
    $roots = New-Object System.Collections.Generic.List[string]
    # Dedup by normalized product-folder name (remove spaces, lowercase) so that
    # 'Admax One 2.0' and 'Admax One2.0' are not counted as separate installations.
    $seenNormalized = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($baseDir in @($programFilesX86, $programFiles)) {
        # Standard location: C:\Program Files (x86)\Unimedia\Admax*
        $unimediaRoot = Join-Path $baseDir 'Unimedia'
        foreach ($productDir in (Get-SafeDirectories -Path $unimediaRoot -Filter 'Admax*')) {
            $normalizedName = ($productDir.Name -replace '\s','').ToLowerInvariant()
            if (-not $seenNormalized.Add($normalizedName)) { continue }
            [void]$roots.Add($productDir.FullName)
            foreach ($admaxDir in (Get-SafeDirectories -Path $productDir.FullName -Filter 'admax*')) {
                [void]$roots.Add($admaxDir.FullName)
            }
        }
        # Direct location: C:\Program Files\Admax* (no Unimedia parent)
        foreach ($productDir in (Get-SafeDirectories -Path $baseDir -Filter 'Admax*')) {
            $normalizedName = ($productDir.Name -replace '\s','').ToLowerInvariant()
            if (-not $seenNormalized.Add($normalizedName)) { continue }
            [void]$roots.Add($productDir.FullName)
            foreach ($admaxDir in (Get-SafeDirectories -Path $productDir.FullName -Filter 'admax*')) {
                [void]$roots.Add($admaxDir.FullName)
            }
        }
    }

    foreach ($hint in @($RunningProcesses + $ServiceHints + $StartupHints + $ScheduledTaskHints)) {
        $executablePath = [string]$hint.executable_path
        $identity = @(
            [string]$hint.name,
            [string]$hint.display_name,
            [string]$hint.path_name,
            [string]$hint.command,
            [string]$hint.task_name,
            [string]$hint.task_path,
            $executablePath
        ) -join ' '
        if ($identity -notmatch 'admax|unimedia|admaxone|admax.one|admax-one') { continue }

        $rootCandidate = Resolve-AdmaxRootCandidate -ExecutablePath $executablePath
        if ($rootCandidate) { [void]$roots.Add($rootCandidate) }
    }

    foreach ($entry in @($UninstallEntries)) {
        $displayName = [string]$entry.name
        $publisher = [string]$entry.publisher
        if (($displayName + ' ' + $publisher) -notmatch 'admax|unimedia|clarity systems|admax systems|admax broadcast') { continue }

        $installLocation = [string]$entry.install_loc
        if ([string]::IsNullOrWhiteSpace($installLocation) -or -not (Test-Path -LiteralPath $installLocation -PathType Container)) {
            continue
        }

        [void]$roots.Add((Resolve-Path -LiteralPath $installLocation).Path)
        foreach ($admaxDir in (Get-SafeDirectories -Path $installLocation -Filter 'admax*' -Recurse | Select-Object -First 20)) {
            [void]$roots.Add($admaxDir.FullName)
        }
    }

    $orderedRoots = @(Get-UniqueStrings -Values @($roots))
    $filteredRoots = New-Object System.Collections.Generic.List[string]
    foreach ($rootPath in $orderedRoots) {
        $normalizedRoot = $rootPath.TrimEnd('\')
        $parentRoot = (Split-Path -Path $normalizedRoot -Parent).TrimEnd('\')
        $isNestedAdmaxRoot = $normalizedRoot -match '[\\/]admax[^\\/]*$'
        $parentAlreadyTracked = $false
        if ($isNestedAdmaxRoot -and -not [string]::IsNullOrWhiteSpace($parentRoot)) {
            $parentAlreadyTracked = @($orderedRoots | Where-Object { $_.TrimEnd('\') -eq $parentRoot }).Count -gt 0
        }
        if ($isNestedAdmaxRoot -and $parentAlreadyTracked) { continue }
        [void]$filteredRoots.Add($rootPath)
    }

    return @($filteredRoots | ForEach-Object { $_ })
}

function Get-AdmaxChannelRoots {
    param(
        [string]$InstallRoot,
        [string[]]$DataRoots = @()
    )
    # Returns channel-specific subdirectory paths when multiple Admax channels are
    # detected within one installation root. Returns empty array for single-channel
    # installs so the caller falls through to the standard single-instance path.
    #
    # Strategy 1 — process command-line inspection (most reliable when running):
    #   Admax passes its per-channel config file as a CLI argument, e.g.
    #   AdmaxBroadcast.exe -config "D:\Admax One\Channel 1\config.xml"
    #   Each unique config directory under this root => one distinct channel.
    #
    # Strategy 2 — named/numbered subdirectory scanning (catches not-yet-running):
    #   Scans for Channel*, ch[0-9]*, Instance*, etc. that contain config evidence.
    $channelPaths = New-Object System.Collections.Generic.List[string]

    # Strategy 1: running process command lines
    try {
        $admaxProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object {
                $ep = [string]$_.ExecutablePath
                -not [string]::IsNullOrWhiteSpace($ep) -and
                $ep.ToLowerInvariant().StartsWith($InstallRoot.ToLowerInvariant())
            }
        foreach ($proc in $admaxProcs) {
            $cmdLine = [string]$proc.CommandLine
            if ([string]::IsNullOrWhiteSpace($cmdLine)) { continue }
            $pathMatches = [regex]::Matches($cmdLine, '"([^"]{4,}\.(?:ini|xml|cfg|json))"')
            foreach ($m in $pathMatches) {
                $configPath = $m.Groups[1].Value.Trim()
                $configDir = if (Test-Path $configPath -PathType Container) {
                    $configPath
                } elseif (Test-Path $configPath -PathType Leaf) {
                    Split-Path $configPath -Parent
                } else { $null }
                if (-not [string]::IsNullOrWhiteSpace($configDir) -and
                    $configDir.ToLowerInvariant().StartsWith($InstallRoot.ToLowerInvariant()) -and
                    $configDir.ToLowerInvariant() -ne $InstallRoot.ToLowerInvariant()) {
                    [void]$channelPaths.Add($configDir)
                }
            }
        }
    } catch { }

    # Strategy 2: named/numbered channel subdirectories with config evidence
    $channelNamePatterns = @('Channel*', 'ch*', 'Instance*', 'Output*', 'Station*', 'admax*')
    $channelNameRegex = '(?i)^(channel[\s\-_]*\d+|ch\d+|instance\d+|output\d+|station\d+|admax\d+)$'
    $ignoredLeafNames = @(
        'bin', 'bin64', 'bin32', '64bit', '32bit',
        'logs', 'log', 'playlist', 'playlists',
        'playlistscan', 'fnf', 'config', 'settings', 'data'
    )
    $configFileHints = @(
        'Settings.ini', 'admax.ini', 'config.ini', 'config.xml',
        'AdmaxBroadcast.ini', 'channel.ini', 'schedule.xml', 'admax.xml'
    )
    foreach ($dataRoot in $DataRoots) {
        foreach ($pattern in $channelNamePatterns) {
            foreach ($subDir in (Get-SafeDirectories -Path $dataRoot -Filter $pattern)) {
                $leaf = ([string]$subDir.Name).Trim()
                if ([string]::IsNullOrWhiteSpace($leaf)) { continue }
                $leafLower = $leaf.ToLowerInvariant()
                if ($ignoredLeafNames -contains $leafLower) { continue }
                if ($leaf -notmatch $channelNameRegex) { continue }

                $hasEvidence = $false
                foreach ($hint in $configFileHints) {
                    if (Test-Path (Join-Path $subDir.FullName $hint) -PathType Leaf) {
                        $hasEvidence = $true; break
                    }
                }
                if (-not $hasEvidence) {
                    $hasEvidence =
                        (Test-Path (Join-Path $subDir.FullName 'logs')      -PathType Container) -or
                        (Test-Path (Join-Path $subDir.FullName 'Playlist')  -PathType Container) -or
                        (Test-Path (Join-Path $subDir.FullName 'Playlists') -PathType Container) -or
                        (@(Get-SafeFiles -Path $subDir.FullName -Filter '*.xml' | Select-Object -First 1).Count -gt 0)
                }
                if ($hasEvidence) { [void]$channelPaths.Add($subDir.FullName) }
            }
        }
    }

    # Only trigger multi-channel mode when 2+ distinct channel paths are found
    $unique = @(Get-UniqueStrings -Values @($channelPaths))
    if ($unique.Count -ge 2) { return $unique }
    return @()
}

function Find-AdmaxPlayers {
    param(
        [string]$NodeId,
        [object[]]$RunningProcesses = @(),
        [object[]]$ServiceHints = @(),
        [object[]]$StartupHints = @(),
        [object[]]$ScheduledTaskHints = @(),
        [object[]]$UninstallEntries = @()
    )
    $players = New-Object System.Collections.Generic.List[object]
    $roots   = @(Find-AdmaxRootCandidates -RunningProcesses $RunningProcesses -ServiceHints $ServiceHints -StartupHints $StartupHints -ScheduledTaskHints $ScheduledTaskHints -UninstallEntries $UninstallEntries)
    $knownExeNames = @(Get-AdmaxExecutableFilters)

    for ($offset = 0; $offset -lt $roots.Count; $offset++) {
        $admaxRoot = $roots[$offset]
        $rootLeaf = (Split-Path -Path $admaxRoot -Leaf)
        if ($rootLeaf -match '^admax') {
            $parentRoot = Split-Path -Path $admaxRoot -Parent
            if (-not [string]::IsNullOrWhiteSpace($parentRoot) -and (Get-UniqueStrings -Values @($roots)) -contains $parentRoot) {
                continue
            }
        }
        $dataRootCandidates = New-Object System.Collections.Generic.List[string]
        [void]$dataRootCandidates.Add($admaxRoot)
        foreach ($nestedAdmaxDir in (Get-SafeDirectories -Path $admaxRoot -Filter 'admax*')) {
            [void]$dataRootCandidates.Add($nestedAdmaxDir.FullName)
        }
        $dataRoots = @(Get-UniqueStrings -Values @($dataRootCandidates))

        # ── Smart multi-channel detection ─────────────────────────────────
        # Some Admax installs run multiple simultaneous channels from named
        # subdirs within one root. Detect and emit one player entry per channel.
        $channelRoots = @(Get-AdmaxChannelRoots -InstallRoot $admaxRoot -DataRoots @($dataRoots))
        if ($channelRoots.Count -ge 2) {
            $channelIdx = 0
            foreach ($channelRoot in $channelRoots) {
                $chSettingsCandidates = @(
                    (Join-Path $channelRoot 'Settings.ini'),
                    (Join-Path $channelRoot 'admax.ini'),
                    (Join-Path $channelRoot 'config.ini'),
                    (Join-Path $channelRoot 'config.xml'),
                    (Join-Path $channelRoot 'channel.ini')
                )
                $chSettingsIni = Get-FirstExistingFile -Candidates $chSettingsCandidates
                $chPlayoutLog  = Get-FirstExistingDirectory -Candidates @(
                    (Join-Path $channelRoot 'logs\logs\Playout'),
                    (Join-Path $channelRoot 'logs\Playout'),
                    (Join-Path $channelRoot 'logs')
                )
                $chFnfLog = Get-FirstExistingDirectory -Candidates @(
                    (Join-Path $channelRoot 'logs\FNF'),
                    (Join-Path $channelRoot 'FNF')
                )
                $chEvidence = [System.Collections.Generic.List[string]]::new()
                [void]$chEvidence.Add("Admax multi-channel install at $admaxRoot")
                [void]$chEvidence.Add("Channel directory: $channelRoot")
                if ($chSettingsIni) { [void]$chEvidence.Add("Config: $chSettingsIni") }
                if ($chPlayoutLog)  { [void]$chEvidence.Add("Playout log: $chPlayoutLog") }
                if ($chFnfLog)      { [void]$chEvidence.Add("FNF log: $chFnfLog") }

                $channelLeaf = (Split-Path -Path $channelRoot -Leaf)
                $channelProcessNames = @(
                    Get-UniqueStrings -Values @(
                        foreach ($procHint in $RunningProcesses) {
                            $exePath = ([string]$procHint.executable_path).Trim()
                            $name = ([string]$procHint.name).Trim()
                            if ([string]::IsNullOrWhiteSpace($exePath) -or [string]::IsNullOrWhiteSpace($name)) { continue }
                            if ($exePath.ToLowerInvariant().StartsWith($channelRoot.ToLowerInvariant())) {
                                $name
                            }
                        }
                    )
                )
                if ($channelProcessNames.Count -eq 0) {
                    $channelProcessNames = @(Get-ProcessNamesInDirectory -DirectoryPath $channelRoot)
                }
                $channelCommandHints = @(
                    Get-UniqueStrings -Values @(
                        @($channelRoot)
                        @($channelLeaf)
                    )
                )
                $chProcessSelectors = @{
                    executable_path_contains = @($channelRoot)
                    command_line_contains    = $channelCommandHints
                }
                if ($channelProcessNames.Count -gt 0) {
                    $chProcessSelectors.process_names = $channelProcessNames
                }
                [void]$chEvidence.Add("Instance selector root: $channelRoot")
                foreach ($pn in $channelProcessNames) {
                    [void]$chEvidence.Add("Instance process detected: $pn")
                }

                $chLabel      = 'Admax {0} Ch{1}' -f ($offset + 1), ($channelIdx + 1)
                $chConfidence = if ($chSettingsIni -or $chPlayoutLog -or $chFnfLog) { 0.91 } else { 0.80 }
                [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index ($players.Count) `
                    -PlayoutType 'admax' -Label $chLabel -Paths @{
                        admax_root_candidates = @($admaxRoot)
                        install_dir           = $admaxRoot
                        channel_dir           = $channelRoot
                        admax_state_path      = $chSettingsIni
                        playout_log_dir       = $chPlayoutLog
                        fnf_log               = $chFnfLog
                    } `
                    -ProcessSelectors $chProcessSelectors `
                    -LogSelectors @{} `
                    -Evidence @($chEvidence) `
                    -Confidence $chConfidence))
                $channelIdx++
            }
            continue  # skip single-instance report for this root
        }
        # ── end multi-channel ──────────────────────────────────────────────

        $playoutCandidates = New-Object System.Collections.Generic.List[string]
        $fnfCandidates = New-Object System.Collections.Generic.List[string]
        $playlistCandidates = New-Object System.Collections.Generic.List[string]
        $settingsCandidates = New-Object System.Collections.Generic.List[string]
        foreach ($dataRoot in $dataRoots) {
            [void]$playoutCandidates.Add((Join-Path $dataRoot 'logs\logs\Playout'))
            [void]$playoutCandidates.Add((Join-Path $dataRoot 'logs\Playout'))
            [void]$playoutCandidates.Add((Join-Path $dataRoot 'bin\64bit\logs\logs\Playout'))
            [void]$playoutCandidates.Add((Join-Path $dataRoot 'bin\64bit\logs\Playout'))
            [void]$fnfCandidates.Add((Join-Path $dataRoot 'logs\FNF'))
            [void]$fnfCandidates.Add((Join-Path $dataRoot 'bin\64bit\logs\FNF'))
            [void]$playlistCandidates.Add((Join-Path $dataRoot 'logs\playlistscan'))
            [void]$playlistCandidates.Add((Join-Path $dataRoot 'bin\64bit\logs\playlistscan'))
            [void]$settingsCandidates.Add((Join-Path $dataRoot 'Settings.ini'))
            [void]$settingsCandidates.Add((Join-Path $dataRoot 'bin\Settings.ini'))
            [void]$settingsCandidates.Add((Join-Path $dataRoot 'bin\64bit\Settings.ini'))
        }

        # Require at least one known executable to exist — folders alone are stale leftovers
        $hasExe = $false
        $matchedExecutableNames = New-Object System.Collections.Generic.List[string]
        foreach ($searchRoot in $dataRoots) {
            foreach ($exeName in $knownExeNames) {
                $candidate = Get-SafeFiles -Path $searchRoot -Filter $exeName -Recurse | Select-Object -First 1
                if ($candidate) {
                    $hasExe = $true
                    [void]$matchedExecutableNames.Add($candidate.Name)
                    break
                }
            }
            if ($hasExe) { break }
        }
        $runningRoots = @($dataRoots | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        # Also count as installed if a process is running from this dir or registry confirms it
        $isRunningNow = $false
        try {
            $proc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                Where-Object {
                    $exePath = [string]$_.ExecutablePath
                    if ([string]::IsNullOrWhiteSpace($exePath)) { return $false }
                    foreach ($rootPath in $runningRoots) {
                        if ($exePath.ToLowerInvariant().StartsWith($rootPath.ToLowerInvariant())) {
                            return $true
                        }
                    }
                    return $false
                } |
                Select-Object -First 1
            if ($proc) { $isRunningNow = $true }
        } catch { }
        $runningProcessNames = @(
            Get-UniqueStrings -Values @(
                foreach ($dataRoot in $dataRoots) {
                    @(Get-ProcessNamesInDirectory -DirectoryPath $dataRoot)
                }
            )
        )

        $playoutLogDir = Get-FirstExistingDirectory -Candidates @($playoutCandidates)
        $fnfLog = Get-FirstExistingDirectory -Candidates @($fnfCandidates)
        $playlistScanLog = Get-FirstExistingDirectory -Candidates @($playlistCandidates)
        $settingsIni = Get-FirstExistingFile -Candidates @($settingsCandidates)
        $hasInstallEvidence = $hasExe -or $isRunningNow -or $playoutLogDir -or $fnfLog -or $playlistScanLog -or $settingsIni
        if (-not $hasInstallEvidence) { continue }

        $rootAnchors = @(
            Get-UniqueStrings -Values @(
                @($runningRoots)
                @($admaxRoot)
            )
        )
        $hintPattern = 'admax|unimedia|admaxone|admax.one|admax-one|unistreamer'
        $hasServiceAnchor = @(
            $ServiceHints | Where-Object {
                $identity = @(
                    [string]$_.name,
                    [string]$_.display_name,
                    [string]$_.path_name,
                    [string]$_.command,
                    [string]$_.executable_path
                ) -join ' '
                if ($identity -match $hintPattern) { return $true }
                $exePath = [string]$_.executable_path
                if ([string]::IsNullOrWhiteSpace($exePath)) { return $false }
                foreach ($rootPath in $rootAnchors) {
                    if ($exePath.ToLowerInvariant().StartsWith($rootPath.ToLowerInvariant())) { return $true }
                }
                return $false
            }
        ).Count -gt 0
        $hasStartupAnchor = @(
            @($StartupHints + $ScheduledTaskHints) | Where-Object {
                $identity = @(
                    [string]$_.name,
                    [string]$_.display_name,
                    [string]$_.path_name,
                    [string]$_.command,
                    [string]$_.task_name,
                    [string]$_.task_path,
                    [string]$_.executable_path
                ) -join ' '
                if ($identity -match $hintPattern) { return $true }
                $exePath = [string]$_.executable_path
                if ([string]::IsNullOrWhiteSpace($exePath)) { return $false }
                foreach ($rootPath in $rootAnchors) {
                    if ($exePath.ToLowerInvariant().StartsWith($rootPath.ToLowerInvariant())) { return $true }
                }
                return $false
            }
        ).Count -gt 0
        $hasRegistryAnchor = @(
            $UninstallEntries | Where-Object {
                $identity = @(
                    [string]$_.name,
                    [string]$_.publisher,
                    [string]$_.install_loc
                ) -join ' '
                if ($identity -match $hintPattern) { return $true }
                $installLocation = [string]$_.install_loc
                if ([string]::IsNullOrWhiteSpace($installLocation)) { return $false }
                foreach ($rootPath in $rootAnchors) {
                    if ($installLocation.ToLowerInvariant().StartsWith($rootPath.ToLowerInvariant())) { return $true }
                }
                return $false
            }
        ).Count -gt 0

        # Avoid false positives from stale folders/cached logs by requiring at least one
        # strong Admax anchor (runtime/service/startup/registry/config).
        $hasStrongAnchorEvidence =
            $isRunningNow -or
            ($runningProcessNames.Count -gt 0) -or
            -not [string]::IsNullOrWhiteSpace($settingsIni) -or
            $hasServiceAnchor -or
            $hasStartupAnchor -or
            $hasRegistryAnchor
        if (-not $hasStrongAnchorEvidence) { continue }

        # Auto-detect running processes whose exe lives inside this Admax product tree.
        $detectedProcessNames = @($runningProcessNames)

        $evidence = New-Object System.Collections.Generic.List[string]
        [void]$evidence.Add("Admax root found at $admaxRoot")
        foreach ($dataRoot in ($dataRoots | Where-Object { $_ -ne $admaxRoot })) {
            [void]$evidence.Add("Admax data root found at $dataRoot")
        }
        if ($playoutLogDir)    { [void]$evidence.Add("Playout log folder found at $playoutLogDir") }
        if ($fnfLog)           { [void]$evidence.Add("FNF log folder found at $fnfLog") }
        if ($playlistScanLog)  { [void]$evidence.Add("Playlist scan log found at $playlistScanLog") }
        if ($settingsIni)      { [void]$evidence.Add("Settings.ini found at $settingsIni") }
        foreach ($exeName in (Get-UniqueStrings -Values @($matchedExecutableNames))) {
            [void]$evidence.Add("Executable found: $exeName")
        }
        if ($hasServiceAnchor)  { [void]$evidence.Add('Service hint linked to Admax installation') }
        if ($hasStartupAnchor)  { [void]$evidence.Add('Startup/scheduled-task hint linked to Admax installation') }
        if ($hasRegistryAnchor) { [void]$evidence.Add('Registry uninstall entry linked to Admax installation') }
        foreach ($pn in $detectedProcessNames) { [void]$evidence.Add("Running process detected: $pn") }

        $processSelectors = @{
            executable_path_contains = @($runningRoots)
        }
        if ($detectedProcessNames.Count -gt 0) {
            $processSelectors.process_names = $detectedProcessNames
        } else {
            $processSelectors.process_name_regex = '(?i)admax|unistreamer'
        }

        $label = 'Admax {0}' -f ($offset + 1)
        $confidence = if ($hasExe -or $isRunningNow) { 0.94 } elseif ($settingsIni -or $playoutLogDir -or $fnfLog -or $playlistScanLog) { 0.86 } else { 0.78 }
        [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $offset -PlayoutType 'admax' -Label $label -Paths @{
            admax_root_candidates = $dataRoots
            install_dir           = $admaxRoot
            admax_state_path      = $settingsIni
            playout_log_dir       = $playoutLogDir
            fnf_log               = $fnfLog
            playlistscan_log      = $playlistScanLog
        } -ProcessSelectors $processSelectors -LogSelectors @{} -Evidence @($evidence) -Confidence $confidence))
    }

    return @($players | ForEach-Object { $_ })
}

# ============================================================================
# REGISTRY-BASED BROADCAST SOFTWARE DISCOVERY
# ============================================================================

$_broadcastVendorPatterns = @(
    # ── TV Broadcast ─────────────────────────────────────────────────────────
    @{ id='playbox_neo';       label='PlayBox AirBox';           publisher='playbox';                exe=@('AirBox.exe','ListBox.exe','TitleBox.exe');            installPattern='PlayBox Technology*'; logPattern='' },
    @{ id='cinegy_air';        label='Cinegy Air';               publisher='cinegy';                 exe=@('CinegyAir.exe','PlayOutExApp.exe','CinegyAirSrv.exe'); installPattern='Cinegy*';            logPattern='C:\ProgramData\Cinegy\CinegyAir' },
    @{ id='grass_valley_itx';  label='Grass Valley iTX';         publisher='grass valley';           exe=@('OutputServer.exe','iTXDesktop.exe','iTXD.exe');        installPattern='Grass Valley\iTX*';  logPattern='' },
    @{ id='imagine_versio';    label='Imagine Versio';           publisher='imagine|harris';         exe=@('Versio.exe','VersioServer.exe','Nexio.exe');           installPattern='Imagine Communications\Versio*'; logPattern='C:\ProgramData\Imagine Communications\Versio\Logs' },
    @{ id='broadstream_oasys'; label='BroadStream OASYS';        publisher='broadstream';            exe=@('OASYSPlayout.exe','OASYSServer.exe','OASYS.exe');      installPattern='BroadStream*\OASYS*'; logPattern='C:\ProgramData\BroadStream\OASYS\Logs' },
    @{ id='pebble_marina';     label='Pebble Marina';            publisher='pebble beach';           exe=@('Marina.exe','MarinaClient.exe','MarinaServer.exe');    installPattern='Pebble Beach Systems\Marina*'; logPattern='' },
    @{ id='evertz_streampro';  label='Evertz StreamPro';         publisher='evertz';                 exe=@('StreamPro.exe','StreamProService.exe','Overture.exe'); installPattern='Evertz\StreamPro*';  logPattern='C:\ProgramData\Evertz\StreamPro\Logs' },
    @{ id='axel_xplayout';     label='Axel XPlayout';           publisher='axel technology|axeltech'; exe=@('XPlayout.exe','XScheduler.exe','XTV.exe','YouPlay.exe'); installPattern='Axel Technology*'; logPattern='' },
    @{ id='florical_airboss';  label='Florical AirBoss';         publisher='florical';               exe=@('AirBoss.exe','AirBossX.exe','Acuitas.exe');            installPattern='Florical Systems\AirBoss*'; logPattern='' },
    @{ id='ross_inception';    label='Ross Inception';           publisher='ross video';             exe=@('Inception.exe','InceptionServer.exe');                 installPattern='Ross Video\Inception*'; logPattern='C:\ProgramData\Ross Video\Inception\Logs' },
    @{ id='viz_mosart';        label='Viz Mosart';               publisher='mosart|vizrt|vizrt group'; exe=@('VizMosartServer.exe','VizMosartGUI.exe','Mosart.exe'); installPattern='Mosart Medialab\Mosart*'; logPattern='C:\ProgramData\Mosart Medialab' },
    @{ id='chyron_prime';      label='Chyron PRIME';             publisher='chyron|chyronhego';      exe=@('Prime.exe','PrimeEngine.exe','HyperX.exe');            installPattern='Chyron\PRIME*';      logPattern='C:\ProgramData\Chyron\PRIME\Logs' },
    @{ id='wideorbit';         label='WideOrbit Automation';     publisher='wideorbit';              exe=@('WOAutomation.exe','WOAudio.exe','WOPlayout.exe');      installPattern='WideOrbit\*';         logPattern='C:\ProgramData\WideOrbit' },
    @{ id='bitcentral';        label='Bitcentral Central';       publisher='bitcentral';             exe=@('CentralControl.exe','BitcentralSrv.exe');              installPattern='Bitcentral\Central Control*'; logPattern='C:\ProgramData\Bitcentral\Central Control\Logs' },
    @{ id='harmonic_spectrum'; label='Harmonic Spectrum';        publisher='harmonic|omneon';        exe=@('SpectrumMediaManager.exe','OmneonControl.exe','Polaris.exe'); installPattern='Omneon*';   logPattern='C:\ProgramData\Harmonic\Logs' },
    @{ id='etere';             label='Etere Automation';         publisher='etere';                  exe=@('Etere.exe','EtereMX.exe','EtereSrv.exe','EtereAgent.exe'); installPattern='Etere*';      logPattern='C:\ProgramData\Etere\Logs' },
    @{ id='aveco';             label='Aveco ASTRA';              publisher='aveco';                  exe=@('Astra.exe','AvecoBroker.exe','AvecoPlayout.exe');      installPattern='Aveco*';              logPattern='C:\ProgramData\Aveco\Logs' },
    @{ id='pixel_power';       label='Pixel Power Gallium';      publisher='pixel power|rohde';      exe=@('Gallium.exe','PixelPower.exe','PPGallium.exe');         installPattern='Pixel Power*';        logPattern='C:\ProgramData\Pixel Power\Logs' },
    @{ id='caspar_cg';         label='CasparCG Server';          publisher='casparcg|svt';           exe=@('casparcg.exe','CasparCG Server.exe','scanner.exe');    installPattern='CasparCG*';           logPattern='' },
    @{ id='enco_dad';          label='ENCO DAD';                 publisher='enco systems|enco';      exe=@('dad.exe','DAD.exe','EncoDAD.exe','DADPro.exe');         installPattern='ENCO Systems*';       logPattern='C:\ProgramData\ENCO\Logs' },
    @{ id='rcs_zetta';         label='RCS Zetta';                publisher='rcs|radio computing';    exe=@('Zetta.exe','ZettaApp.exe','RCSMasterControl.exe','MasterControl.exe'); installPattern='RCS*'; logPattern='C:\ProgramData\RCS\Logs' },
    @{ id='dalet';             label='Dalet Galaxy';             publisher='dalet';                  exe=@('Dalet.exe','DaletPlus.exe','GalaxyServer.exe','DaletGalaxy.exe'); installPattern='Dalet*'; logPattern='C:\ProgramData\Dalet\Logs' },
    @{ id='snell_morpheus';    label='Snell/GV Morpheus';        publisher='snell|grass valley advanced'; exe=@('Morpheus.exe','MorpheusPlayout.exe');             installPattern='Snell*';              logPattern='' },
    @{ id='vsn_vsnexplorer';   label='VSN VSNExplorer';          publisher='vsn|videonet';           exe=@('VSNExplorer.exe','VSNPlayout.exe','VSNServer.exe');    installPattern='VSN*';                logPattern='C:\ProgramData\VSN\Logs' },
    # ── Radio Automation ─────────────────────────────────────────────────────
    @{ id='myriad_playout';    label='Broadcast Radio Myriad';   publisher='broadcast radio|p squared'; exe=@('Myriad.exe','MyriadPlayout.exe','Myriad5.exe');    installPattern='Broadcast Radio*';    logPattern='C:\ProgramData\Broadcast Radio\Logs' },
    @{ id='playout_one';       label='PlayoutONE';               publisher='playoutone|playout one'; exe=@('PlayoutONE.exe','PlayoutOneService.exe');             installPattern='PlayoutONE*';          logPattern='C:\ProgramData\PlayoutONE\Logs' },
    @{ id='radio_dj';          label='RadioDJ';                  publisher='radiodj';                exe=@('RadioDJ.exe');                                         installPattern='RadioDJ*';             logPattern='' },
    @{ id='playit_live';       label='PlayIt Live';              publisher='playit software';         exe=@('PlayItLive.exe','PlayItAgent.exe');                    installPattern='PlayIt Software*';    logPattern='C:\ProgramData\PlayIt Software\Logs' },
    @{ id='zara_studio';       label='ZaraStudio';               publisher='digital dj|zarastudio';  exe=@('ZaraStudio.exe','ZaraRadio.exe');                      installPattern='ZaraStudio*';          logPattern='' },
    @{ id='proppfrexx';        label='ProppFrexx OnAir';         publisher='proppfrexx|rb soft';     exe=@('ProppFrexx.exe','OnAir.exe','pfOnAir.exe');            installPattern='ProppFrexx*';          logPattern='C:\ProgramData\ProppFrexx\Logs' },
    @{ id='sam_broadcaster';   label='SAM Broadcaster';          publisher='spacial audio|spacialaudio|sam broadcaster'; exe=@('SAMBroadcaster.exe','SAM4.exe','SAMPro.exe'); installPattern='Spacial Audio*'; logPattern='C:\ProgramData\Spacial Audio\Logs' },
    @{ id='station_playlist';  label='Station Playlist';         publisher='station playlist';        exe=@('SPLStudio.exe','StationPlaylist.exe','SPLCreator.exe'); installPattern='Station Playlist*';  logPattern='C:\ProgramData\Station Playlist\Logs' },
    @{ id='mairlist';          label='mAirList';                 publisher='mairlist|torben';         exe=@('mAirList.exe','mAirListSvc.exe');                      installPattern='mAirList*';            logPattern='C:\ProgramData\mAirList\Logs' },
    @{ id='radioboss';         label='RadioBOSS';                publisher='dj software|radioboss|djsoft'; exe=@('RadioBOSS.exe','RadioBOSSService.exe');          installPattern='RadioBOSS*';           logPattern='C:\ProgramData\RadioBOSS\Logs' },
    @{ id='jazler';            label='Jazler RadioStar';         publisher='jazler|jazler software';  exe=@('Jazler.exe','RadioStar2.exe','JazlerRec.exe');         installPattern='Jazler*';              logPattern='C:\ProgramData\Jazler\Logs' },
    @{ id='hardata';           label='Hardata Dinesat';          publisher='hardata';                 exe=@('Dinesat.exe','HDXRadio.exe','HardataService.exe');     installPattern='Hardata*';             logPattern='C:\ProgramData\Hardata\Logs' },
    @{ id='nextkast';          label='NextKast';                 publisher='nextkast|nexgen';         exe=@('NextKast.exe','NextGen.exe','NexGenD.exe');            installPattern='NextKast*';            logPattern='C:\ProgramData\NextKast\Logs' },
    @{ id='obs_studio';        label='OBS Studio';               publisher='obs project';             exe=@('obs64.exe','obs.exe','obs32.exe');                      installPattern='OBS Studio*';          logPattern='C:\ProgramData\obs-studio\logs' },
    @{ id='mixxx';             label='Mixxx DJ';                 publisher='mixxx';                   exe=@('mixxx.exe');                                           installPattern='Mixxx*';               logPattern='' }
)

function Get-UninstallEntries {
    $entries = New-Object System.Collections.Generic.List[object]
    $hives = @(
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($hive in $hives) {
        if (-not (Test-Path $hive)) { continue }
        try {
            foreach ($key in (Get-ChildItem $hive -ErrorAction SilentlyContinue)) {
                try {
                    $props = $key | Get-ItemProperty -ErrorAction SilentlyContinue
                    if ($null -eq $props) { continue }
                    # Registry values can be any type (byte[], int, string). Cast via "$(...)" for safety.
                    $dn  = try { "$($props.DisplayName)".Trim()    } catch { '' }
                    $pub = try { "$($props.Publisher)".Trim()       } catch { '' }
                    $ver = try { "$($props.DisplayVersion)".Trim()  } catch { '' }
                    $loc = try { "$($props.InstallLocation)".Trim() } catch { '' }
                    [void]$entries.Add([ordered]@{
                        name        = $dn
                        publisher   = $pub
                        version     = $ver
                        install_loc = $loc
                    })
                } catch { }
            }
        } catch { }
    }
    return @($entries | ForEach-Object { $_ })
}

function Find-RegistryBroadcastPlayers {
    param(
        [string]$NodeId,
        [int]$StartIndex = 0,
        [object[]]$UninstallEntries = @()
    )
    $players  = New-Object System.Collections.Generic.List[object]
    $entries  = if ($PSBoundParameters.ContainsKey('UninstallEntries')) { @($UninstallEntries) } else { @(Get-UninstallEntries) }
    $seen     = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $pf       = Get-EnvPathOrFallback -Name 'ProgramFiles'       -Fallback 'C:\Program Files'
    $pfx86    = Get-EnvPathOrFallback -Name 'ProgramFiles(x86)'  -Fallback 'C:\Program Files (x86)'
    $idx      = $StartIndex

    foreach ($profile in $_broadcastVendorPatterns) {
        foreach ($entry in $entries) {
            $pubLower  = $entry.publisher.ToLowerInvariant()
            $nameLower = $entry.name.ToLowerInvariant()
            $pubMatch  = $pubLower -match $profile.publisher
            $nameMatch = $nameLower -match ($profile.publisher -replace '\|','|')

            if (-not ($pubMatch -or $nameMatch)) { continue }
            $keywordGuard = if ($profile.id -eq 'admax') {
                'admax|unimedia|playout|streamer|playlist'
            } elseif ($profile.id -eq 'insta') {
                'insta|indytek|playout'
            } else {
                'air|playout|automation|cinegy|versio|marina|mosart|oasys|xplayout|inception|prime|wideorbit|bitcentral|spectrum|streampro|airboss'
            }
            if (-not ($nameLower -match $keywordGuard)) { continue }

            # Allow multiple instances of the same software type (e.g. AirBox Ch1/Ch2)
            # Dedupe on type + install location so different install dirs = separate entries
            $dedupeKey = '{0}|{1}' -f $profile.id, ($entry.install_loc.ToLowerInvariant().TrimEnd('\'))
            if (-not $seen.Add($dedupeKey)) { continue }

            # Resolve install dir
            $installDir = ''
            if (-not [string]::IsNullOrWhiteSpace($entry.install_loc) -and (Test-Path -LiteralPath $entry.install_loc -PathType Container)) {
                $installDir = $entry.install_loc
            }
            if ([string]::IsNullOrWhiteSpace($installDir)) {
                foreach ($base in @($pfx86, $pf)) {
                    foreach ($subdir in (Get-SafeDirectories -Path $base -Filter ($profile.installPattern.Split('\')[0]))) {
                        $candidate = Join-Path $subdir.FullName ($profile.installPattern.Split('\',2)[1] -replace '\*','')
                        if (Test-Path -LiteralPath ($subdir.FullName) -PathType Container) {
                            $installDir = $subdir.FullName; break
                        }
                    }
                    if ($installDir) { break }
                }
            }

            # Find executable
            $exePath = ''
            foreach ($exeName in $profile.exe) {
                if ($installDir) {
                    $candidate = Get-SafeFiles -Path $installDir -Filter $exeName -Recurse | Select-Object -First 1
                    if ($candidate) { $exePath = $candidate.FullName; break }
                }
                # Fallback: search process list
                try {
                    $proc = Get-CimInstance Win32_Process -Filter "Name = '$exeName'" -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($proc -and $proc.ExecutablePath) { $exePath = $proc.ExecutablePath; break }
                } catch { }
            }
            if (-not $exePath -and $installDir) { $exePath = $installDir }

            # Determine running state
            $isRunning = $false
            foreach ($exeName in $profile.exe) {
                try {
                    $running = Get-CimInstance Win32_Process -Filter "Name = '$exeName'" -ErrorAction SilentlyContinue | Select-Object -First 1
                    if ($running) { $isRunning = $true; break }
                } catch { }
            }

            # Find log dir
            $logDir = ''
            if (-not [string]::IsNullOrWhiteSpace($profile.logPattern) -and (Test-Path -LiteralPath $profile.logPattern -PathType Container)) {
                $logDir = $profile.logPattern
            }
            if ([string]::IsNullOrWhiteSpace($logDir) -and $installDir) {
                $logDir = Get-FirstExistingDirectory -Candidates @(
                    (Join-Path $installDir 'Logs'),
                    (Join-Path $installDir 'logs'),
                    (Join-Path $installDir 'Log'),
                    (Join-Path $installDir 'asrun')
                )
            }

            $evidence = New-Object System.Collections.Generic.List[string]
            [void]$evidence.Add("Found in Windows registry: $($entry.name) by $($entry.publisher) v$($entry.version)")
            if ($installDir) { [void]$evidence.Add("Install location: $installDir") }
            if ($exePath)    { [void]$evidence.Add("Executable: $exePath") }
            if ($isRunning)  { [void]$evidence.Add("Process is currently running") }
            if ($logDir)     { [void]$evidence.Add("Log directory: $logDir") }

            $processSelectors = @{}
            if ($profile.exe.Count -gt 0) { $processSelectors.process_names = @($profile.exe) }
            if ($exePath) {
                $processSelectors.executable_path_contains = @($exePath)
            } elseif ($installDir) {
                $processSelectors.executable_path_contains = @($installDir)
            }

            $confidence = if ($isRunning) { 0.93 } elseif ($installDir) { 0.87 } else { 0.78 }
            # Label multiple instances of same type: "PlayBox AirBox", "PlayBox AirBox 2", etc.
            $sameTypeCount = @($players | Where-Object { $_.playout_type -eq $profile.id }).Count
            $instanceLabel = if ($sameTypeCount -eq 0) { $profile.label } else { '{0} {1}' -f $profile.label, ($sameTypeCount + 1) }
            [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $idx -PlayoutType $profile.id -Label $instanceLabel -Paths @{
                install_dir = $installDir
                executable  = $exePath
                log_dir     = $logDir
            } -ProcessSelectors $processSelectors -LogSelectors @{} -Evidence @($evidence) -Confidence $confidence -Installed $true -Running $isRunning))
            $idx += 1
        }
    }

    return @($players | ForEach-Object { $_ })
}

# ============================================================================
# GENERIC PLAYER DISCOVERY
# ============================================================================

function Get-GenericLogHints {
    $programFiles    = Get-EnvPathOrFallback -Name 'ProgramFiles'    -Fallback 'C:\Program Files'
    $programFilesX86 = Get-EnvPathOrFallback -Name 'ProgramFiles(x86)' -Fallback 'C:\Program Files (x86)'
    $programData     = Get-EnvPathOrFallback -Name 'ProgramData'     -Fallback 'C:\ProgramData'
    $vendorNames = @('Cinegy','PlayBox*','Grass Valley','Imagine*','BroadStream*','Pebble*','Evertz*','WideOrbit*','Bitcentral*','Harmonic*','Etere*','Aveco*','CasparCG*','Dalet*','VSN*','Myriad*','Station Playlist*','mAirList*','RadioBOSS*','Jazler*','Hardata*')
    $logHints = New-Object System.Collections.Generic.List[string]

    foreach ($baseDir in @($programFiles, $programFilesX86, $programData)) {
        foreach ($vendorName in $vendorNames) {
            foreach ($vendorDir in (Get-SafeDirectories -Path $baseDir -Filter $vendorName)) {
                foreach ($candidate in (Get-SafeDirectories -Path $vendorDir.FullName -Recurse)) {
                    if ($candidate.Name -notmatch '^(log|logs|asrun|playout|trace|traces|diagnostic|diagnostics)$') { continue }
                    if ((Get-RecentLogFileCount -DirectoryPath $candidate.FullName) -gt 0) {
                        [void]$logHints.Add($candidate.FullName)
                    }
                }
            }
        }
    }

    return @(Get-UniqueStrings -Values @($logHints) | Select-Object -First 25)
}

function Get-PlayoutProfileDescriptor {
    param([string]$Text)
    $haystack = [string]$Text
    if ([string]::IsNullOrWhiteSpace($haystack)) { return $null }
    $lower = $haystack.ToLowerInvariant()
    $descriptors = @(
        # ── TV Broadcast ──────────────────────────────────────────────────
        @{ id='insta';             label='Indytek Insta';            match='indytek|(^|[^a-z0-9])insta([^a-z0-9]|$)';              log_keywords=@('indytek','insta') },
        @{ id='admax';             label='Unimedia Admax';           match='unimedia|(^|[^a-z0-9])admax([^a-z0-9]|$)';             log_keywords=@('unimedia','admax') },
        @{ id='cinegy_air';        label='Cinegy Air';               match='cinegy';                                                log_keywords=@('cinegy') },
        @{ id='playbox_neo';       label='PlayBox AirBox';           match='playbox|airbox|titlebox';                               log_keywords=@('playbox','airbox') },
        @{ id='grass_valley_itx';  label='Grass Valley iTX';         match='grass[\s\-_]*valley|(^|[^a-z0-9])itx([^a-z0-9]|$)';   log_keywords=@('grass valley','itx') },
        @{ id='imagine_versio';    label='Imagine Versio';           match='imagine[\s\-_]*communications|(^|[^a-z0-9])versio([^a-z0-9]|$)|nexio';            log_keywords=@('imagine','versio','nexio') },
        @{ id='broadstream_oasys'; label='BroadStream OASYS';        match='broadstream|oasys';                                     log_keywords=@('broadstream','oasys') },
        @{ id='pebble_marina';     label='Pebble Marina';            match='pebble[\s\-_]*beach|marina';                            log_keywords=@('pebble','marina') },
        @{ id='evertz_streampro';  label='Evertz StreamPro';         match='evertz|streampro|overture';                             log_keywords=@('evertz','streampro','overture') },
        @{ id='axel_xplayout';     label='Axel XPlayout';           match='axel[\s\-_]*tech|xplayout|xtvsuit|youplay';             log_keywords=@('axel','xplayout','youplay') },
        @{ id='florical_airboss';  label='Florical AirBoss';         match='florical|airboss|acuitas';                              log_keywords=@('florical','airboss','acuitas') },
        @{ id='ross_inception';    label='Ross Inception';           match='ross[\s\-_]*video|inception';                           log_keywords=@('ross','inception') },
        @{ id='viz_mosart';        label='Viz Mosart';               match='mosart|vizrt';                                          log_keywords=@('mosart','vizrt') },
        @{ id='chyron_prime';      label='Chyron PRIME';             match='chyron|chyronhego';                                     log_keywords=@('chyron','prime') },
        @{ id='wideorbit';         label='WideOrbit Automation';     match='wideorbit';                                             log_keywords=@('wideorbit') },
        @{ id='bitcentral';        label='Bitcentral Central';       match='bitcentral';                                            log_keywords=@('bitcentral') },
        @{ id='harmonic_spectrum'; label='Harmonic Spectrum';        match='harmonic|omneon|polaris[\s\-_]*play';                   log_keywords=@('harmonic','omneon','spectrum') },
        @{ id='etere';             label='Etere Automation';         match='etere';                                                 log_keywords=@('etere') },
        @{ id='aveco';             label='Aveco ASTRA';              match='aveco|astra[\s\-_]*broadcast';                          log_keywords=@('aveco','astra') },
        @{ id='pixel_power';       label='Pixel Power Gallium';      match='pixel[\s\-_]*power|gallium|rohde[\s\-_]*schwarz';       log_keywords=@('pixel power','gallium') },
        @{ id='caspar_cg';         label='CasparCG Server';          match='casparcg|caspar[\s\-_]*cg';                             log_keywords=@('casparcg') },
        @{ id='enco_dad';          label='ENCO DAD';                 match='enco[\s\-_]*systems|(^|[^a-z0-9])dad([^a-z0-9]|$)';    log_keywords=@('enco','dad') },
        @{ id='rcs_zetta';         label='RCS Zetta';                match='rcs[\s\-_]*zetta|zettacloud|(^|[^a-z0-9])zetta([^a-z0-9]|$)|radio[\s\-_]*computing'; log_keywords=@('rcs','zetta') },
        @{ id='dalet';             label='Dalet Galaxy';             match='dalet|galaxy[\s\-_]*five';                              log_keywords=@('dalet','galaxy') },
        @{ id='snell_morpheus';    label='Snell/GV Morpheus';        match='morpheus|snell[\s\-_]*advanced';                        log_keywords=@('morpheus','snell') },
        @{ id='vsn_vsnexplorer';   label='VSN VSNExplorer';          match='vsnexplorer|vsn[\s\-_]*playout';                        log_keywords=@('vsn','vsnexplorer') },
        # ── Radio Automation ──────────────────────────────────────────────
        @{ id='myriad_playout';    label='Broadcast Radio Myriad';   match='myriad|broadcast[\s\-_]*radio|p[\s\-_]*squared';        log_keywords=@('myriad','broadcast radio') },
        @{ id='playout_one';       label='PlayoutONE';               match='playoutone|playout[\s\-_]*one';                         log_keywords=@('playoutone') },
        @{ id='radio_dj';          label='RadioDJ';                  match='radiodj';                                               log_keywords=@('radiodj') },
        @{ id='playit_live';       label='PlayIt Live';              match='playit[\s\-_]*live|playit[\s\-_]*software';             log_keywords=@('playit') },
        @{ id='zara_studio';       label='ZaraStudio';               match='zarastudio|zararadio|digital[\s\-_]*dj[\s\-_]*soft';    log_keywords=@('zara','zarastudio') },
        @{ id='proppfrexx';        label='ProppFrexx OnAir';         match='proppfrexx|rb[\s\-_]*soft';                             log_keywords=@('proppfrexx') },
        @{ id='sam_broadcaster';   label='SAM Broadcaster';          match='sam[\s\-_]*broadcaster|spacial[\s\-_]*audio';           log_keywords=@('sam','spacial') },
        @{ id='station_playlist';  label='Station Playlist';         match='station[\s\-_]*playlist';                               log_keywords=@('station playlist','spl') },
        @{ id='mairlist';          label='mAirList';                 match='mairlist';                                              log_keywords=@('mairlist') },
        @{ id='radioboss';         label='RadioBOSS';                match='radioboss|djsoft';                                      log_keywords=@('radioboss') },
        @{ id='jazler';            label='Jazler RadioStar';         match='jazler|radiostar';                                      log_keywords=@('jazler','radiostar') },
        @{ id='hardata';           label='Hardata Dinesat';          match='hardata|dinesat|hdx[\s\-_]*radio';                      log_keywords=@('hardata','dinesat') },
        @{ id='nextkast';          label='NextKast';                 match='nextkast|nexgen[\s\-_]*radio';                          log_keywords=@('nextkast','nexgen') },
        @{ id='obs_studio';        label='OBS Studio';               match='obs[\s\-_]*studio|obs[\s\-_]*project';                  log_keywords=@('obs','obs-studio') },
        @{ id='mixxx';             label='Mixxx DJ';                 match='mixxx';                                                 log_keywords=@('mixxx') }
    )
    foreach ($descriptor in $descriptors) {
        if ($lower -match $descriptor.match) { return $descriptor }
    }
    return $null
}

function Get-PlayoutProfileDescriptorById {
    param([string]$PlayoutType)
    $normalized = ([string]$PlayoutType).Trim().ToLowerInvariant()
    $map = @{
        'insta'             = @{ id='insta';             label='Indytek Insta';           match='indytek|(^|[^a-z0-9])insta([^a-z0-9]|$)';             log_keywords=@('indytek','insta') }
        'admax'             = @{ id='admax';             label='Unimedia Admax';          match='unimedia|(^|[^a-z0-9])admax([^a-z0-9]|$)';            log_keywords=@('unimedia','admax') }
        'cinegy_air'        = @{ id='cinegy_air';        label='Cinegy Air';              match='cinegy';                                               log_keywords=@('cinegy') }
        'playbox_neo'       = @{ id='playbox_neo';       label='PlayBox AirBox';          match='playbox|airbox';                                       log_keywords=@('playbox','airbox') }
        'grass_valley_itx'  = @{ id='grass_valley_itx';  label='Grass Valley iTX';        match='grass[\s\-_]*valley|(^|[^a-z0-9])itx([^a-z0-9]|$)';  log_keywords=@('grass valley','itx') }
        'imagine_versio'    = @{ id='imagine_versio';    label='Imagine Versio';          match='imagine|(^|[^a-z0-9])versio([^a-z0-9]|$)';           log_keywords=@('imagine','versio') }
        'broadstream_oasys' = @{ id='broadstream_oasys'; label='BroadStream OASYS';       match='broadstream|oasys';                                    log_keywords=@('broadstream','oasys') }
        'pebble_marina'     = @{ id='pebble_marina';     label='Pebble Marina';           match='pebble|marina';                                        log_keywords=@('pebble','marina') }
        'evertz_streampro'  = @{ id='evertz_streampro';  label='Evertz StreamPro';        match='evertz|streampro|overture';                            log_keywords=@('evertz','streampro','overture') }
        'axel_xplayout'     = @{ id='axel_xplayout';     label='Axel XPlayout';           match='axel[\s\-_]*technology|xplayout';                      log_keywords=@('axel','xplayout') }
        'florical_airboss'  = @{ id='florical_airboss';  label='Florical AirBoss';        match='florical|airboss';                                     log_keywords=@('florical','airboss') }
        'ross_inception'    = @{ id='ross_inception';    label='Ross Inception';          match='ross[\s\-_]*video|inception';                          log_keywords=@('ross','inception') }
        'viz_mosart'        = @{ id='viz_mosart';        label='Viz Mosart';              match='mosart|vizrt';                                         log_keywords=@('mosart') }
        'chyron_prime'      = @{ id='chyron_prime';      label='Chyron PRIME';            match='chyron|chyronhego';                                    log_keywords=@('chyron') }
        'wideorbit'         = @{ id='wideorbit';         label='WideOrbit Automation';    match='wideorbit';                                            log_keywords=@('wideorbit') }
        'bitcentral'        = @{ id='bitcentral';        label='Bitcentral Central';      match='bitcentral';                                           log_keywords=@('bitcentral') }
        'harmonic_spectrum' = @{ id='harmonic_spectrum'; label='Harmonic Spectrum';       match='harmonic|omneon';                                      log_keywords=@('harmonic','omneon') }
        'generic_windows'   = @{ id='generic_windows';   label='Generic Windows Playout'; match='playout';                                              log_keywords=@('log','logs','asrun','playout','automation') }
    }
    if ($map.ContainsKey($normalized)) { return $map[$normalized] }
    return $null
}

function Get-NearbyLogHint {
    param([string]$ExecutablePath)
    if ([string]::IsNullOrWhiteSpace($ExecutablePath) -or -not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { return '' }
    $searchRoots = Get-UniqueStrings -Values @(
        (Split-Path -Path $ExecutablePath -Parent),
        (Split-Path -Path (Split-Path -Path $ExecutablePath -Parent) -Parent),
        (Split-Path -Path (Split-Path -Path (Split-Path -Path $ExecutablePath -Parent) -Parent) -Parent)
    )
    $logDirNames = @('log','logs','asrun','playout','trace','traces','diagnostic','diagnostics')
    foreach ($root in $searchRoots) {
        if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($dirName in $logDirNames) {
            $directCandidate = Join-Path $root $dirName
            if ((Get-RecentLogFileCount -DirectoryPath $directCandidate) -gt 0) { return (Resolve-Path -LiteralPath $directCandidate).Path }
            foreach ($nested in (Get-SafeDirectories -Path $root -Filter $dirName -Recurse | Select-Object -First 10)) {
                if ((Get-RecentLogFileCount -DirectoryPath $nested.FullName) -gt 0) { return $nested.FullName }
            }
        }
    }
    return ''
}

function Get-ProfileLogHint {
    param([hashtable]$Descriptor, [string[]]$LogHints, [string]$ExecutablePath = '')
    $nearbyHint = Get-NearbyLogHint -ExecutablePath $ExecutablePath
    if ($nearbyHint) { return $nearbyHint }
    $keywords = @($Descriptor.log_keywords | Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_) })
    foreach ($logHint in @($LogHints)) {
        $lower = ([string]$logHint).ToLowerInvariant()
        foreach ($keyword in $keywords) {
            if ($lower.Contains(([string]$keyword).ToLowerInvariant())) { return $logHint }
        }
    }
    if ($Descriptor.id -eq 'generic_windows' -and @($LogHints).Count -gt 0) { return $LogHints[0] }
    return ''
}

function Get-NearbyConfigHint {
    param([string]$ExecutablePath)
    if ([string]::IsNullOrWhiteSpace($ExecutablePath) -or -not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) { return '' }
    $searchRoots = Get-UniqueStrings -Values @(
        (Split-Path -Path $ExecutablePath -Parent),
        (Split-Path -Path (Split-Path -Path $ExecutablePath -Parent) -Parent),
        (Split-Path -Path (Split-Path -Path (Split-Path -Path $ExecutablePath -Parent) -Parent) -Parent)
    )
    $configDirNames = @('config','configs','configuration','settings','profiles','channels','data')
    $configFileFilters = @('*.ini','*.cfg','*.xml','*.json','*.db','*.sqlite')
    foreach ($root in $searchRoots) {
        if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($dirName in $configDirNames) {
            $directCandidate = Join-Path $root $dirName
            if (Test-Path -LiteralPath $directCandidate -PathType Container) {
                return (Resolve-Path -LiteralPath $directCandidate).Path
            }
            foreach ($nested in (Get-SafeDirectories -Path $root -Filter $dirName -Recurse | Select-Object -First 5)) {
                return $nested.FullName
            }
        }
        foreach ($filter in $configFileFilters) {
            $configFile = Get-SafeFiles -Path $root -Filter $filter -Recurse | Select-Object -First 1
            if ($configFile) { return $configFile.FullName }
        }
    }
    return ''
}

function Get-ListSignature {
    param([object]$Value)
    if ($null -eq $Value) { return '' }
    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $items = @($Value | ForEach-Object { ([string]$_).Trim().ToLowerInvariant() } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Sort-Object -Unique)
        return ($items -join ';')
    }
    return ([string]$Value).Trim().ToLowerInvariant()
}

function Get-PlayerIdentitySignature {
    param([object]$Player)
    $selectors = if ($Player.process_selectors) { $Player.process_selectors } else { @{} }
    $paths = if ($Player.paths) { $Player.paths } else { @{} }
    $parts = @(
        ([string]$Player.playout_type).Trim().ToLowerInvariant(),
        (Get-ListSignature -Value $selectors['service_names']),
        (Get-ListSignature -Value $selectors['service_path_contains']),
        (Get-ListSignature -Value $selectors['command_line_contains']),
        (Get-ListSignature -Value $selectors['window_title_contains']),
        (Get-ListSignature -Value $selectors['executable_path_contains']),
        (Get-ListSignature -Value $paths['install_dir']),
        (Get-ListSignature -Value $paths['executable'])
    )
    if ((@($parts | Select-Object -Skip 1 | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })).Count -eq 0) {
        $parts += (Get-ListSignature -Value $selectors['process_names'])
    }
    return ($parts -join '|')
}

function Get-DistinctInstanceLabel {
    param(
        [string]$BaseLabel,
        [string]$CommandLineSelector = '',
        [string]$WindowTitle = '',
        [string]$ServiceName = '',
        [string]$DisplayName = '',
        [int]$FallbackNumber = 1
    )
    $base = ([string]$BaseLabel).Trim()
    if ([string]::IsNullOrWhiteSpace($base)) { $base = 'Player' }

    foreach ($candidate in @($WindowTitle, $DisplayName)) {
        $trimmed = ([string]$candidate).Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed)) { continue }
        if ($trimmed -match [regex]::Escape($base)) { return $trimmed }
        return ('{0} - {1}' -f $base, $trimmed)
    }

    $commandHint = ([string]$CommandLineSelector).Trim()
    if (-not [string]::IsNullOrWhiteSpace($commandHint)) {
        if ($commandHint -match '(?i)(?:^|\s)--?channel(?:=|\s+)([^ ]+)') {
            return ('{0} Channel {1}' -f $base, $matches[1])
        }
        if ($commandHint -match '(?i)(?:^|\s)--?instance(?:=|\s+)([^ ]+)') {
            return ('{0} Instance {1}' -f $base, $matches[1])
        }
        if ($commandHint -match '(?i)(?:^|\s)--?service(?:=|\s+)([^ ]+)') {
            return ('{0} Service {1}' -f $base, $matches[1])
        }
        return ('{0} - {1}' -f $base, $commandHint)
    }

    $serviceHint = ([string]$ServiceName).Trim()
    if (-not [string]::IsNullOrWhiteSpace($serviceHint)) {
        return ('{0} - {1}' -f $base, $serviceHint)
    }

    return ('{0} {1}' -f $base, $FallbackNumber)
}

function Get-DedupedPlayers {
    param([object[]]$Players)
    $deduped = New-Object System.Collections.Generic.List[object]
    $seen = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($player in @($Players)) {
        $signature = Get-PlayerIdentitySignature -Player $player
        if ([string]::IsNullOrWhiteSpace($signature)) {
            $signature = [string]$player.player_id
        }
        if ($seen.Add($signature)) {
            [void]$deduped.Add($player)
        }
    }
    return @($deduped | ForEach-Object { $_ })
}

function Find-GenericProfilePlayers {
    param(
        [string]$NodeId,
        [int]$StartIndex = 0,
        [string]$PlayoutHint = 'auto',
        [object[]]$RunningProcesses = @(),
        [object[]]$ServiceHints = @(),
        [object[]]$StartupHints = @(),
        [object[]]$ScheduledTaskHints = @(),
        [string[]]$LogHints = @()
    )
    $players            = New-Object System.Collections.Generic.List[object]
    $runningProcesses   = if ($PSBoundParameters.ContainsKey('RunningProcesses')) { @($RunningProcesses) } else { @(Get-RunningProcessHints) }
    $serviceHints       = if ($PSBoundParameters.ContainsKey('ServiceHints')) { @($ServiceHints) } else { @(Get-ServiceHints) }
    $startupHints       = if ($PSBoundParameters.ContainsKey('StartupHints')) { @($StartupHints) } else { @(Get-StartupCommandHints) }
    $scheduledTaskHints = if ($PSBoundParameters.ContainsKey('ScheduledTaskHints')) { @($ScheduledTaskHints) } else { @(Get-ScheduledTaskHints) }
    $logHints           = if ($PSBoundParameters.ContainsKey('LogHints')) { @($LogHints) } else { @(Get-GenericLogHints) }
    $seen               = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $profileCounts      = @{}
    $nextIndex          = $StartIndex
    $hintDescriptor     = if ($PlayoutHint -and $PlayoutHint -ne 'auto') { Get-PlayoutProfileDescriptorById -PlayoutType $PlayoutHint } else { $null }

    foreach ($process in $runningProcesses) {
        $name = [string]$process.name
        $executablePath = [string]$process.executable_path
        $commandLine = [string]$process.command_line
        $windowTitle = [string]$process.window_title
        $identityText = @($name, $executablePath, $commandLine, $windowTitle) -join ' '
        $descriptor = Get-PlayoutProfileDescriptor -Text $identityText
        if ($null -eq $descriptor -and $hintDescriptor) { $descriptor = $hintDescriptor }
        if ($null -eq $descriptor -or $descriptor.id -in @('insta','admax')) { continue }

        $commandLineSelector = Get-CommandLineSelector -CommandText $commandLine -ExecutablePath $executablePath
        $dedupeSource = if ($commandLineSelector) { "proc:$commandLineSelector" } elseif ($windowTitle) { "proc:$windowTitle" } elseif ($executablePath) { "proc:$executablePath" } else { "proc:$name" }
        $dedupeKey = '{0}|{1}' -f $descriptor.id, $dedupeSource
        if (-not $seen.Add($dedupeKey)) { continue }

        if ($profileCounts.ContainsKey($descriptor.id)) { $profileCounts[$descriptor.id] += 1 } else { $profileCounts[$descriptor.id] = 1 }
        $labelNumber = $profileCounts[$descriptor.id]
        $matchedLog = Get-ProfileLogHint -Descriptor $descriptor -LogHints $logHints -ExecutablePath $executablePath
        $configHint = Get-NearbyConfigHint -ExecutablePath $executablePath
        $installDir = ''
        if ($executablePath) { $installDir = Split-Path -Path $executablePath -Parent }

        $evidence = New-Object System.Collections.Generic.List[string]
        if ($name) { [void]$evidence.Add("Running process detected: $name") }
        if ($executablePath) { [void]$evidence.Add("Executable path: $executablePath") }
        if ($commandLineSelector) { [void]$evidence.Add("Command line selector: $commandLineSelector") }
        if ($windowTitle) { [void]$evidence.Add("Window title: $windowTitle") }
        if ($matchedLog) { [void]$evidence.Add("Likely log folder found at $matchedLog") }
        if ($configHint) { [void]$evidence.Add("Nearby config hint: $configHint") }

        $processSelectors = @{}
        if ($name) { $processSelectors.process_names = @($name) }
        if ($executablePath) { $processSelectors.executable_path_contains = @($executablePath) }
        if ($commandLineSelector) { $processSelectors.command_line_contains = @($commandLineSelector) }
        if ($windowTitle -and -not $commandLineSelector) { $processSelectors.window_title_contains = @($windowTitle) }

        $paths = @{}
        if ($matchedLog) { $paths.log_path = $matchedLog }
        if ($installDir) { $paths.install_dir = $installDir }
        if ($configHint) { $paths.config_path = $configHint }

        $confidence = if ($matchedLog -or $configHint) { 0.74 } else { 0.62 }
        if ($descriptor.id -eq 'generic_windows') { $confidence = if ($matchedLog -or $configHint) { 0.6 } else { 0.47 } }

        $label = Get-DistinctInstanceLabel -BaseLabel ([string]$descriptor.label) -CommandLineSelector $commandLineSelector -WindowTitle $windowTitle -FallbackNumber $labelNumber
        [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $nextIndex -PlayoutType $descriptor.id -Label $label -Paths $paths -ProcessSelectors $processSelectors -LogSelectors @{} -Evidence @($evidence) -Confidence $confidence -Running $true))
        $nextIndex += 1
    }

    foreach ($service in $serviceHints) {
        $serviceName = [string]$service.name
        $displayName = [string]$service.display_name
        $pathName = [string]$service.path_name
        $executablePath = [string]$service.executable_path
        $windowTitle = [string]$service.window_title
        $identityText = @($serviceName, $displayName, $pathName, $executablePath, $windowTitle) -join ' '
        $descriptor = Get-PlayoutProfileDescriptor -Text $identityText
        if ($null -eq $descriptor -and $hintDescriptor) { $descriptor = $hintDescriptor }
        if ($null -eq $descriptor -or $descriptor.id -in @('insta','admax')) { continue }

        $commandLineSelector = Get-CommandLineSelector -CommandText $pathName -ExecutablePath $executablePath
        $dedupeSource = if ($serviceName) { "svc:$serviceName" } elseif ($commandLineSelector) { "svc:$commandLineSelector" } elseif ($executablePath) { "svc:$executablePath" } else { "svc:$displayName" }
        $dedupeKey = '{0}|{1}' -f $descriptor.id, $dedupeSource
        if (-not $seen.Add($dedupeKey)) { continue }

        if ($profileCounts.ContainsKey($descriptor.id)) { $profileCounts[$descriptor.id] += 1 } else { $profileCounts[$descriptor.id] = 1 }
        $labelNumber = $profileCounts[$descriptor.id]
        $matchedLog = Get-ProfileLogHint -Descriptor $descriptor -LogHints $logHints -ExecutablePath $executablePath
        $configHint = Get-NearbyConfigHint -ExecutablePath $executablePath
        $installDir = ''
        if ($executablePath) { $installDir = Split-Path -Path $executablePath -Parent }

        $evidence = New-Object System.Collections.Generic.List[string]
        if ($serviceName) { [void]$evidence.Add("Windows service detected: $serviceName") }
        if ($displayName) { [void]$evidence.Add("Service display name: $displayName") }
        if ($pathName) { [void]$evidence.Add("Service path: $pathName") }
        if ($commandLineSelector) { [void]$evidence.Add("Command line selector: $commandLineSelector") }
        if ($windowTitle) { [void]$evidence.Add("Window title: $windowTitle") }
        if ($service.state) { [void]$evidence.Add("Service state: $($service.state)") }
        if ($service.start_mode) { [void]$evidence.Add("Service start mode: $($service.start_mode)") }
        if ($matchedLog) { [void]$evidence.Add("Likely log folder found at $matchedLog") }
        if ($configHint) { [void]$evidence.Add("Nearby config hint: $configHint") }

        $processSelectors = @{}
        if ($serviceName) { $processSelectors.service_names = @($serviceName) }
        if ($displayName) { $processSelectors.service_display_name_contains = @($displayName) }
        if ($pathName) { $processSelectors.service_path_contains = @($pathName) }
        if ($executablePath) {
            $processSelectors.executable_path_contains = @($executablePath)
            $leafName = Split-Path -Path $executablePath -Leaf
            if ($leafName) { $processSelectors.process_names = @($leafName) }
        }
        if ($commandLineSelector) { $processSelectors.command_line_contains = @($commandLineSelector) }
        if ($windowTitle -and -not $commandLineSelector) { $processSelectors.window_title_contains = @($windowTitle) }

        $paths = @{}
        if ($matchedLog) { $paths.log_path = $matchedLog }
        if ($installDir) { $paths.install_dir = $installDir }
        if ($configHint) { $paths.config_path = $configHint }

        $running = $false
        if ($service.started) { $running = $true }
        if (-not $running -and $service.state -match 'running') { $running = $true }
        $confidence = if ($running) { 0.83 } elseif ($matchedLog -or $configHint) { 0.71 } else { 0.64 }

        $label = Get-DistinctInstanceLabel -BaseLabel ([string]$descriptor.label) -CommandLineSelector $commandLineSelector -WindowTitle $windowTitle -ServiceName $serviceName -DisplayName $displayName -FallbackNumber $labelNumber
        [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $nextIndex -PlayoutType $descriptor.id -Label $label -Paths $paths -ProcessSelectors $processSelectors -LogSelectors @{} -Evidence @($evidence) -Confidence $confidence -Running $running))
        $nextIndex += 1
    }

    foreach ($startup in $startupHints) {
        $name = [string]$startup.name
        $commandText = [string]$startup.command
        $executablePath = [string]$startup.executable_path
        $identityText = @($name, $commandText, $startup.location, $executablePath) -join ' '
        $descriptor = Get-PlayoutProfileDescriptor -Text $identityText
        if ($null -eq $descriptor -and $hintDescriptor) { $descriptor = $hintDescriptor }
        if ($null -eq $descriptor -or $descriptor.id -in @('insta','admax')) { continue }

        $commandLineSelector = Get-CommandLineSelector -CommandText $commandText -ExecutablePath $executablePath
        $dedupeSource = if ($commandLineSelector) { "startup:$commandLineSelector" } elseif ($name) { "startup:$name" } else { "startup:$executablePath" }
        $dedupeKey = '{0}|{1}' -f $descriptor.id, $dedupeSource
        if (-not $seen.Add($dedupeKey)) { continue }

        if ($profileCounts.ContainsKey($descriptor.id)) { $profileCounts[$descriptor.id] += 1 } else { $profileCounts[$descriptor.id] = 1 }
        $labelNumber = $profileCounts[$descriptor.id]
        $matchedLog = Get-ProfileLogHint -Descriptor $descriptor -LogHints $logHints -ExecutablePath $executablePath
        $configHint = Get-NearbyConfigHint -ExecutablePath $executablePath
        $installDir = ''
        if ($executablePath) { $installDir = Split-Path -Path $executablePath -Parent }

        $evidence = New-Object System.Collections.Generic.List[string]
        if ($name) { [void]$evidence.Add("Startup command detected: $name") }
        if ($commandText) { [void]$evidence.Add("Startup command line: $commandText") }
        if ($startup.location) { [void]$evidence.Add("Startup location: $($startup.location)") }
        if ($matchedLog) { [void]$evidence.Add("Likely log folder found at $matchedLog") }
        if ($configHint) { [void]$evidence.Add("Nearby config hint: $configHint") }

        $processSelectors = @{}
        if ($executablePath) {
            $processSelectors.executable_path_contains = @($executablePath)
            $leafName = Split-Path -Path $executablePath -Leaf
            if ($leafName) { $processSelectors.process_names = @($leafName) }
        }
        if ($commandLineSelector) { $processSelectors.command_line_contains = @($commandLineSelector) }

        $paths = @{}
        if ($matchedLog) { $paths.log_path = $matchedLog }
        if ($installDir) { $paths.install_dir = $installDir }
        if ($configHint) { $paths.config_path = $configHint }

        $confidence = if ($matchedLog -or $configHint) { 0.68 } else { 0.57 }
        $label = Get-DistinctInstanceLabel -BaseLabel ([string]$descriptor.label) -CommandLineSelector $commandLineSelector -ServiceName $name -FallbackNumber $labelNumber
        [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $nextIndex -PlayoutType $descriptor.id -Label $label -Paths $paths -ProcessSelectors $processSelectors -LogSelectors @{} -Evidence @($evidence) -Confidence $confidence -Running $false))
        $nextIndex += 1
    }

    foreach ($taskHint in $scheduledTaskHints) {
        $taskName = [string]$taskHint.task_name
        $commandText = [string]$taskHint.command
        $executablePath = [string]$taskHint.executable_path
        $identityText = @($taskName, $taskHint.task_path, $commandText, $executablePath) -join ' '
        $descriptor = Get-PlayoutProfileDescriptor -Text $identityText
        if ($null -eq $descriptor -and $hintDescriptor) { $descriptor = $hintDescriptor }
        if ($null -eq $descriptor -or $descriptor.id -in @('insta','admax')) { continue }

        $commandLineSelector = Get-CommandLineSelector -CommandText $commandText -ExecutablePath $executablePath
        $dedupeSource = if ($commandLineSelector) { "task:$commandLineSelector" } elseif ($taskName) { "task:$taskName" } else { "task:$executablePath" }
        $dedupeKey = '{0}|{1}' -f $descriptor.id, $dedupeSource
        if (-not $seen.Add($dedupeKey)) { continue }

        if ($profileCounts.ContainsKey($descriptor.id)) { $profileCounts[$descriptor.id] += 1 } else { $profileCounts[$descriptor.id] = 1 }
        $labelNumber = $profileCounts[$descriptor.id]
        $matchedLog = Get-ProfileLogHint -Descriptor $descriptor -LogHints $logHints -ExecutablePath $executablePath
        $configHint = Get-NearbyConfigHint -ExecutablePath $executablePath
        $installDir = ''
        if ($executablePath) { $installDir = Split-Path -Path $executablePath -Parent }

        $evidence = New-Object System.Collections.Generic.List[string]
        if ($taskName) { [void]$evidence.Add("Scheduled task detected: $taskName") }
        if ($taskHint.task_path) { [void]$evidence.Add("Task path: $($taskHint.task_path)") }
        if ($commandText) { [void]$evidence.Add("Task command line: $commandText") }
        if ($taskHint.working_directory) { [void]$evidence.Add("Task working directory: $($taskHint.working_directory)") }
        if ($matchedLog) { [void]$evidence.Add("Likely log folder found at $matchedLog") }
        if ($configHint) { [void]$evidence.Add("Nearby config hint: $configHint") }

        $processSelectors = @{}
        if ($executablePath) {
            $processSelectors.executable_path_contains = @($executablePath)
            $leafName = Split-Path -Path $executablePath -Leaf
            if ($leafName) { $processSelectors.process_names = @($leafName) }
        }
        if ($commandLineSelector) { $processSelectors.command_line_contains = @($commandLineSelector) }

        $paths = @{}
        if ($matchedLog) { $paths.log_path = $matchedLog }
        if ($installDir) { $paths.install_dir = $installDir }
        if ($configHint) { $paths.config_path = $configHint }

        $confidence = if ($matchedLog -or $configHint) { 0.66 } else { 0.55 }
        $label = Get-DistinctInstanceLabel -BaseLabel ([string]$descriptor.label) -CommandLineSelector $commandLineSelector -ServiceName $taskName -FallbackNumber $labelNumber
        [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $nextIndex -PlayoutType $descriptor.id -Label $label -Paths $paths -ProcessSelectors $processSelectors -LogSelectors @{} -Evidence @($evidence) -Confidence $confidence -Running $false))
        $nextIndex += 1
    }

    # NOTE: No fallback phantom player is created when no real playout software is found.
    # The Remote Setup UI provides an "Add player" button for manual addition.

    return @($players | ForEach-Object { $_ })
}

# ============================================================================
# FOLDER-BASED GENERIC BROADCAST DISCOVERY
# ============================================================================
# Scans C:\Program Files* for directories whose names match $_broadcastFolderPatterns.
# A candidate is accepted only when at least two independent evidence signals are present:
#   - Broadcast-related folder exists (baseline - always true)
#   - A running process whose executable lives inside that folder
#   - A Windows service whose PathName points inside that folder
# This catches unknown broadcast/automation/encoding software that does not match
# any named profile in $_broadcastVendorPatterns or Get-PlayoutProfileDescriptor.

function Find-GenericBroadcastFromFolders {
    param(
        [string]$NodeId,
        [int]$StartIndex = 0,
        [string[]]$KnownInstallDirs = @()
    )
    $programFiles    = Get-EnvPathOrFallback -Name 'ProgramFiles'       -Fallback 'C:\Program Files'
    $programFilesX86 = Get-EnvPathOrFallback -Name 'ProgramFiles(x86)'  -Fallback 'C:\Program Files (x86)'
    $players  = New-Object System.Collections.Generic.List[object]
    $seen     = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $nextIndex = $StartIndex

    # Build a fast lookup for paths already claimed by named scanners so we do
    # not emit a duplicate generic_windows entry for (e.g.) Admax or PlayBox.
    $knownLower = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($kp in ($KnownInstallDirs | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
        [void]$knownLower.Add($kp.TrimEnd('\').ToLowerInvariant())
    }

    # Snapshot of running processes and services to avoid repeated CIM queries
    $allProcesses = @()
    try { $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { -not [string]::IsNullOrWhiteSpace($_.ExecutablePath) }) } catch { }
    $allServices = @()
    try { $allServices = @(Get-CimInstance Win32_Service -ErrorAction SilentlyContinue | Where-Object { -not [string]::IsNullOrWhiteSpace($_.PathName) }) } catch { }

    foreach ($baseDir in @($programFiles, $programFilesX86)) {
        if (-not (Test-Path -LiteralPath $baseDir -PathType Container)) { continue }
        $vendorDirs = @(Get-SafeDirectories -Path $baseDir)

        foreach ($vendorDir in $vendorDirs) {
            # Test vendor dir itself and one level of subdirectories
            $candidates = New-Object System.Collections.Generic.List[string]
            [void]$candidates.Add($vendorDir.FullName)
            foreach ($sub in (Get-SafeDirectories -Path $vendorDir.FullName)) {
                [void]$candidates.Add($sub.FullName)
            }

            foreach ($dirPath in $candidates) {
                $dirLeaf  = (Split-Path -Path $dirPath -Leaf).ToLowerInvariant()
                $dirLower = $dirPath.TrimEnd('\').ToLowerInvariant()

                # Check if the leaf directory name matches a broadcast folder pattern
                $isMatch = $false
                foreach ($pattern in $_broadcastFolderPatterns) {
                    if ($dirLeaf -like $pattern) { $isMatch = $true; break }
                }
                if (-not $isMatch) { continue }

                # Skip Windows/system paths
                if ($dirPath -match '\\Windows\\|\\System32\\|\\SysWOW64\\|\\WindowsPowerShell\\|Microsoft\.NET|Windows Defender|Windows Security') { continue }

                # Skip paths already claimed by a specific named scanner
                $isKnown = $false
                foreach ($kp in $knownLower) {
                    if ($dirLower.StartsWith($kp) -or $kp.StartsWith($dirLower)) {
                        $isKnown = $true; break
                    }
                }
                if ($isKnown) { continue }

                # SIGNAL 1: running process whose exe is inside this folder
                $runningNames = New-Object System.Collections.Generic.List[string]
                foreach ($proc in $allProcesses) {
                    $exePath = [string]$proc.ExecutablePath
                    if ($exePath.ToLowerInvariant().StartsWith($dirLower + '\')) {
                        if (-not [string]::IsNullOrWhiteSpace($proc.Name)) {
                            [void]$runningNames.Add($proc.Name)
                        }
                    }
                }
                $hasProcess = $runningNames.Count -gt 0

                # SIGNAL 2: Windows service whose PathName points into this folder
                $matchedService = $null
                foreach ($svc in $allServices) {
                    $pn = [string]$svc.PathName
                    $exeFromPath = Get-ExecutablePathFromCommand -CommandText $pn
                    if ([string]::IsNullOrWhiteSpace($exeFromPath)) { continue }
                    if ($exeFromPath.ToLowerInvariant().StartsWith($dirLower + '\')) {
                        $matchedService = $svc; break
                    }
                }
                $hasService = $null -ne $matchedService

                # Require at least 2 signals (folder + process OR folder + service)
                if (-not $hasProcess -and -not $hasService) { continue }

                $dedupeKey = $dirLower
                if (-not $seen.Add($dedupeKey)) { continue }

                $evidence = New-Object System.Collections.Generic.List[string]
                [void]$evidence.Add("Broadcast-related folder detected: $dirPath")
                foreach ($pn in (Get-UniqueStrings -Values @($runningNames))) {
                    [void]$evidence.Add("Running process in folder: $pn")
                }
                if ($hasService) {
                    [void]$evidence.Add("Windows service in folder: $([string]$matchedService.Name) ($([string]$matchedService.DisplayName))")
                }

                $processSelectors = @{
                    executable_path_contains = @($dirPath)
                }
                $uniqueNames = @(Get-UniqueStrings -Values @($runningNames))
                if ($uniqueNames.Count -gt 0) { $processSelectors.process_names = $uniqueNames }
                if ($hasService) { $processSelectors.service_names = @([string]$matchedService.Name) }

                $confidence = if ($hasProcess -and $hasService) { 0.68 } elseif ($hasProcess) { 0.58 } else { 0.52 }
                $labelBase = if ($hasService -and -not [string]::IsNullOrWhiteSpace([string]$matchedService.DisplayName)) {
                    [string]$matchedService.DisplayName
                } elseif ($hasService -and -not [string]::IsNullOrWhiteSpace([string]$matchedService.Name)) {
                    [string]$matchedService.Name
                } elseif ($uniqueNames.Count -gt 0) {
                    [string]$uniqueNames[0]
                } else {
                    'Broadcast Software'
                }
                [void]$players.Add((New-PlayerReport `
                    -NodeId $NodeId `
                    -Index $nextIndex `
                    -PlayoutType 'generic_windows' `
                    -Label (Get-DistinctInstanceLabel -BaseLabel $labelBase -ServiceName ([string]$matchedService.Name) -DisplayName ([string]$matchedService.DisplayName) -FallbackNumber ($nextIndex + 1)) `
                    -Paths @{ install_dir = $dirPath } `
                    -ProcessSelectors $processSelectors `
                    -LogSelectors @{} `
                    -Evidence @($evidence) `
                    -Confidence $confidence `
                    -Running $hasProcess))
                $nextIndex += 1
            }
        }
    }

    return @($players | ForEach-Object { $_ })
}

# ============================================================================
# CONFIG / KEY DISCOVERY
# ============================================================================

function Read-TopLevelYamlScalar {
    param([string[]]$Lines, [string]$Key, [switch]$IncludeCommented)

    # Active (uncommented) line first
    foreach ($line in $Lines) {
        if ($line -match "^\s*$Key\s*:\s*(.+?)\s*$") {
            $value = $matches[1].Trim()
            if ($value -match '^REPLACE_WITH_') { continue }   # skip placeholder
            if (($value.StartsWith("'") -and $value.EndsWith("'")) -or ($value.StartsWith('"') -and $value.EndsWith('"'))) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            return $value
        }
    }

    # Commented line - e.g.  # enrollment_key: ABC123KEY
    if ($IncludeCommented) {
        foreach ($line in $Lines) {
            if ($line -match "^\s*#\s*$Key\s*:\s*(.+?)\s*$") {
                $value = $matches[1].Trim()
                if ($value -match '^REPLACE_WITH_') { continue }
                if (($value.StartsWith("'") -and $value.EndsWith("'")) -or ($value.StartsWith('"') -and $value.EndsWith('"'))) {
                    $value = $value.Substring(1, $value.Length - 2)
                }
                return $value
            }
        }
    }

    return ''
}

function Find-PulseConfigPaths {
    $programData     = Get-EnvPathOrFallback -Name 'ProgramData'       -Fallback 'C:\ProgramData'
    $programFiles    = Get-EnvPathOrFallback -Name 'ProgramFiles'      -Fallback 'C:\Program Files'
    $programFilesX86 = Get-EnvPathOrFallback -Name 'ProgramFiles(x86)' -Fallback 'C:\Program Files (x86)'
    $localAppData    = Get-EnvPathOrFallback -Name 'LocalAppData'      -Fallback (Join-Path $env:USERPROFILE 'AppData\Local')

    $fixed = @(
        # Installed / live agent config - highest priority (has active agent_token)
        (Join-Path $programData     'ClarixPulse\Agent\config.yaml'),
        (Join-Path $programFiles    'ClarixPulse\Agent\config.yaml'),
        (Join-Path $programFilesX86 'ClarixPulse\Agent\config.yaml'),
        # Beside this script
        (Join-Path $_scriptDir  'config.yaml'),
        (Join-Path (Get-Location) 'config.yaml'),
        # Common bundle roots beside or above the script
        (Join-Path $_scriptDir                          'clarix-pulse\config.yaml'),
        (Join-Path (Split-Path $_scriptDir -Parent)     'clarix-pulse\config.yaml'),
        (Join-Path (Split-Path $_scriptDir -Parent)     'config.yaml'),
        # Current install-from-url.ps1 destination
        (Join-Path $localAppData   'ClarixPulse\Bundles\clarix-pulse\config.yaml'),
        (Join-Path $localAppData   'ClarixPulse\Bundles\config.yaml'),
        # Legacy install-from-url.ps1 destination
        'C:\pulse-node-bundle\clarix-pulse\config.yaml',
        'C:\pulse-node-bundle\config.yaml'
    )

    # Dynamic search - any config.yaml found recursively near the script or bundle roots
    $searchRoots = @(
        (Join-Path $localAppData 'ClarixPulse\Bundles'),
        'C:\pulse-node-bundle',
        $_scriptDir,
        (Split-Path $_scriptDir -Parent)
    )
    $dynamic = New-Object System.Collections.Generic.List[string]
    foreach ($root in (Get-UniqueStrings -Values $searchRoots)) {
        foreach ($found in (Get-SafeFiles -Path $root -Filter 'config.yaml' -Recurse)) {
            [void]$dynamic.Add($found.FullName)
        }
    }

    return @(Get-UniqueStrings -Values (@($fixed) + @($dynamic)))
}

function Get-PulseConfigHints {
    $allPaths = @(Find-PulseConfigPaths)

    $merged = [ordered]@{
        source_path    = ''
        node_id        = ''
        node_name      = ''
        site_id        = ''
        hub_url        = ''
        agent_token    = ''
        enrollment_key = ''
    }

    foreach ($candidatePath in $allPaths) {
        if (-not (Test-Path -LiteralPath $candidatePath -PathType Leaf)) { continue }
        try { $lines = Get-Content -LiteralPath $candidatePath -ErrorAction Stop } catch { continue }

        if ([string]::IsNullOrWhiteSpace($merged.source_path)) { $merged.source_path = $candidatePath }

        if ([string]::IsNullOrWhiteSpace($merged.node_id)) {
            $v = Read-TopLevelYamlScalar -Lines $lines -Key 'node_id'
            if (-not $v) { $v = Read-TopLevelYamlScalar -Lines $lines -Key 'agent_id' }
            if ($v) { $merged.node_id = $v; $merged.source_path = $candidatePath }
        }
        if ([string]::IsNullOrWhiteSpace($merged.node_name)) {
            $v = Read-TopLevelYamlScalar -Lines $lines -Key 'node_name'
            if ($v) { $merged.node_name = $v }
        }
        if ([string]::IsNullOrWhiteSpace($merged.site_id)) {
            $v = Read-TopLevelYamlScalar -Lines $lines -Key 'site_id'
            if ($v) { $merged.site_id = $v }
        }
        if ([string]::IsNullOrWhiteSpace($merged.hub_url)) {
            $v = Read-TopLevelYamlScalar -Lines $lines -Key 'hub_url'
            if ($v -and -not (Is-PlaceholderValue -Value $v -Kind 'url')) { $merged.hub_url = $v }
        }
        if ([string]::IsNullOrWhiteSpace($merged.agent_token)) {
            $v = Read-TopLevelYamlScalar -Lines $lines -Key 'agent_token'
            if ($v) { $merged.agent_token = $v }
        }
        if ([string]::IsNullOrWhiteSpace($merged.enrollment_key)) {
            # Check active lines first, then commented lines (VPS bundles sometimes ship key commented)
            $v = Read-TopLevelYamlScalar -Lines $lines -Key 'enrollment_key' -IncludeCommented
            if ($v -and -not (Is-PlaceholderValue -Value $v -Kind 'enrollment')) { $merged.enrollment_key = $v }
        }
    }

    # Apply pulse-account.json values as final fallbacks (lowest priority - YAML config wins)
    if ([string]::IsNullOrWhiteSpace($merged.hub_url) -and -not [string]::IsNullOrWhiteSpace($_accountHubUrl)) {
        $merged.hub_url = $_accountHubUrl
    }
    if ([string]::IsNullOrWhiteSpace($merged.enrollment_key) -and -not [string]::IsNullOrWhiteSpace($_accountEnrollmentKey)) {
        $merged.enrollment_key = $_accountEnrollmentKey
    }

    return $merged
}

# ============================================================================
# MAIN
# ============================================================================

try {
    $hostname = $env:COMPUTERNAME

    Write-DiscoveryPhase -Step 1 -Message 'Loading existing Pulse configuration hints'
    $existingPulseConfig = Get-PulseConfigHints
    $nodeSeed = if ($existingPulseConfig.node_id) { $existingPulseConfig.node_id } else { $hostname }
    $nodeId = if ($existingPulseConfig.node_id) { [string]$existingPulseConfig.node_id } else { Convert-ToNodeSlug -Value $nodeSeed }

    Write-DiscoveryPhase -Step 2 -Message 'Inspecting running broadcast processes'
    $runningProcessHints = @(Get-RunningProcessHints)

    Write-DiscoveryPhase -Step 3 -Message 'Inspecting Windows services'
    $serviceHints = @(Get-ServiceHints)

    Write-DiscoveryPhase -Step 4 -Message 'Inspecting startup commands and scheduled tasks'
    $startupHints = @(Get-StartupCommandHints)
    $scheduledTaskHints = @(Get-ScheduledTaskHints)

    Write-DiscoveryPhase -Step 5 -Message 'Collecting registry and log hints'
    $uninstallEntries = @(Get-UninstallEntries)
    $genericLogHints = @(Get-GenericLogHints)

    Write-DiscoveryPhase -Step 6 -Message 'Scanning dedicated Insta and Admax installations'
    $instaPlayers = @(Find-InstaPlayers -NodeId $nodeId)
    $admaxPlayers = @(
        Find-AdmaxPlayers `
            -NodeId $nodeId `
            -RunningProcesses $runningProcessHints `
            -ServiceHints $serviceHints `
            -StartupHints $startupHints `
            -ScheduledTaskHints $scheduledTaskHints `
            -UninstallEntries $uninstallEntries
    )

    Write-DiscoveryPhase -Step 7 -Message 'Matching registry and generic playout profiles'
    $registryPlayers = @(
        Find-RegistryBroadcastPlayers `
            -NodeId $nodeId `
            -StartIndex ($instaPlayers.Count + $admaxPlayers.Count) `
            -UninstallEntries $uninstallEntries
    )
    # Exclude registry-detected Insta duplicates (the dedicated scanner is stronger there).
    # Keep Admax as a registry fallback only when the dedicated scan did not find it.
    $registryPlayers = @($registryPlayers | Where-Object { $_.playout_type -ne 'insta' })
    if ($admaxPlayers.Count -gt 0) {
        $registryPlayers = @($registryPlayers | Where-Object { $_.playout_type -ne 'admax' })
    }
    $knownCount = $instaPlayers.Count + $admaxPlayers.Count + $registryPlayers.Count
    $genericPlayers = @(
        Find-GenericProfilePlayers `
            -NodeId $nodeId `
            -StartIndex $knownCount `
            -PlayoutHint $PlayoutHint `
            -RunningProcesses $runningProcessHints `
            -ServiceHints $serviceHints `
            -StartupHints $startupHints `
            -ScheduledTaskHints $scheduledTaskHints `
            -LogHints $genericLogHints
    )
    # Collect all install dirs claimed by specific named scanners to prevent
    # the folder-based generic scan from re-detecting the same software.
    $namedInstallDirs = New-Object System.Collections.Generic.List[string]
    foreach ($p in @($instaPlayers + $admaxPlayers + $registryPlayers + $genericPlayers)) {
        $rawInstallDir = $p.paths['install_dir']
        $installDir = if ($null -ne $rawInstallDir) { [string]$rawInstallDir } else { '' }
        if (-not [string]::IsNullOrWhiteSpace($installDir)) { [void]$namedInstallDirs.Add($installDir) }
        foreach ($pathVal in @($p.paths.Values | Where-Object { $_ -is [string] -and -not [string]::IsNullOrWhiteSpace($_) })) {
            [void]$namedInstallDirs.Add([string]$pathVal)
        }
    }
    $folderPlayers = @(
        Find-GenericBroadcastFromFolders `
            -NodeId $nodeId `
            -StartIndex ($instaPlayers.Count + $admaxPlayers.Count + $registryPlayers.Count + $genericPlayers.Count) `
            -KnownInstallDirs (Convert-ToObjectArray -Value $namedInstallDirs)
    )

    $players = @(Get-DedupedPlayers -Players @($instaPlayers + $admaxPlayers + $registryPlayers + $genericPlayers + $folderPlayers))

    Write-DiscoveryPhase -Step 8 -Message 'Scoring detections and assigning instance confidence'
    $detectionResult = Invoke-DiscoveryConfidenceScorer -Players $players
    Apply-DetectionMetadata -Players $players -Detections $detectionResult.detections

    Write-DiscoveryPhase -Step 9 -Message 'Writing discovery report'
    $localTimeZone = [TimeZoneInfo]::Local
    $utcOffsetMinutes = [int]$localTimeZone.GetUtcOffset((Get-Date)).TotalMinutes

    $report = [ordered]@{
        report_version = 2
        generated_at   = (Get-Date).ToUniversalTime().ToString('o')
        machine        = [ordered]@{
            hostname           = $hostname
            username           = $env:USERNAME
            timezone_id        = $localTimeZone.Id
            utc_offset_minutes = $utcOffsetMinutes
        }
        node_id        = $nodeId
        node_name      = if ($existingPulseConfig.node_name)      { $existingPulseConfig.node_name }      else { $hostname }
        site_id        = if ($existingPulseConfig.site_id)        { $existingPulseConfig.site_id }        else { $nodeId }
        hub_url        = if ($existingPulseConfig.hub_url)        { $existingPulseConfig.hub_url }        else { '' }
        agent_token    = if ($existingPulseConfig.agent_token)    { $existingPulseConfig.agent_token }    else { '' }
        enrollment_key = if ($existingPulseConfig.enrollment_key) { $existingPulseConfig.enrollment_key } else { '' }
        players        = $players
        detections     = @($detectionResult.detections)
        discovery      = [ordered]@{
            playout_hint            = $PlayoutHint
            detected_player_count   = $players.Count
            detected_playout_types  = @(Get-UniqueStrings -Values @($players | ForEach-Object { $_.playout_type }))
            running_processes       = $runningProcessHints
            generic_log_hints       = $genericLogHints
            scoring                 = [ordered]@{
                engine     = [string]$detectionResult.engine
                thresholds = $detectionResult.thresholds
                summary    = $detectionResult.summary
            }
            existing_pulse_config   = $existingPulseConfig
        }
    }

    $json = $report | ConvertTo-Json -Depth 16

    if (-not $StdOut) {
        $directory = Split-Path -Path $OutputPath -Parent
        if (-not [string]::IsNullOrWhiteSpace($directory) -and -not (Test-Path -LiteralPath $directory)) {
            New-Item -Path $directory -ItemType Directory -Force | Out-Null
        }
        [System.IO.File]::WriteAllText($OutputPath, $json, (New-Object System.Text.UTF8Encoding $false))
        Complete-DiscoveryPhase -Message 'Discovery scan complete'
        Write-Host "Pulse discovery report written to $OutputPath"
        return
    }

    $json
} catch {
    if (-not $StdOut) {
        Write-Progress -Activity 'Clarix Pulse discovery scan' -Completed
        Write-Host ('ERROR: Pulse discovery scan failed: {0}' -f $_.Exception.Message)
    }
    throw
}

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

# -- Read pulse-account.json (injected into the bundle per-tenant) ------------
$_accountHubUrl      = ''
$_accountEnrollmentKey = ''
$_accountJsonPath = Join-Path $_scriptDir 'pulse-account.json'
if (Test-Path -LiteralPath $_accountJsonPath -PathType Leaf) {
    try {
        $ErrorActionPreference = 'SilentlyContinue'
        $accountData = Get-Content -LiteralPath $_accountJsonPath -Raw | ConvertFrom-Json
        if ($accountData.hubUrl)        { $_accountHubUrl        = [string]$accountData.hubUrl }
        if ($accountData.enrollmentKey) { $_accountEnrollmentKey = [string]$accountData.enrollmentKey }
        $ErrorActionPreference = 'Stop'
    } catch {
        $ErrorActionPreference = 'Stop'
    }
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

function Get-RunningProcessHints {
    $patterns = '(insta|admax|cinegy|airbox|itx|versio|broadstream|oasys|marina|evertz|xplayout|xtvsuit|youplay|mosart|florical|airboss|wideorbit|woplayout|bitcentral|inception|chyron|streampro|etere|aveco|astra|gallium|casparcg|enco|dad\.exe|zetta|dalet|galaxy|morpheus|vsn|myriad|playout|playoutone|radiodj|playit|zarastudio|zararadio|proppfrexx|sambroad|sam4|spl|mairlist|radioboss|jazler|dinesat|nextkast|nexgen|obs64|obs\.exe|mixxx)'
    $rows = New-Object System.Collections.Generic.List[object]
    try {
        $processes = Get-CimInstance Win32_Process -ErrorAction Stop |
            Where-Object { $_.Name -match $patterns -or $_.ExecutablePath -match $patterns }
        foreach ($process in $processes) {
            [void]$rows.Add([ordered]@{
                name            = $process.Name
                executable_path = $process.ExecutablePath
                command_line    = $process.CommandLine
            })
        }
    } catch { return @() }
    return @($rows | Select-Object -First 25)
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
            $detectedProcessNames = @(Get-ProcessNamesInDirectory -DirectoryPath $channelPath)

            $hasExe = $false
            foreach ($exeName in @('Insta Playout.exe', 'Insta Helper.exe')) {
                $candidate = Get-SafeFiles -Path $channelPath -Filter $exeName -Recurse | Select-Object -First 1
                if ($candidate) { $hasExe = $true; break }
            }
            if (-not $hasExe -and $detectedProcessNames.Count -eq 0) { continue }

            $instanceRoot = Get-FirstExistingDirectory -Candidates @(
                (Join-Path $channelPath 'Settings'),
                $channelPath
            )
            $sharedLogDir = Get-FirstExistingDirectory -Candidates @(
                (Join-Path $indytekRoot 'Insta log'),
                (Join-Path $channelPath 'Insta log'),
                (Join-Path $channelPath 'logs')
            )
            $fnfLog = Get-FirstExistingDirectory -Candidates @(
                (Join-Path $sharedLogDir 'FNF'),
                (Join-Path $sharedLogDir 'fnf')
            )
            $playlistScanLog = Get-FirstExistingDirectory -Candidates @(
                (Join-Path $channelPath 'logs\playlistscan'),
                (Join-Path $channelPath 'playlistscan')
            )
            $processNames = if ($detectedProcessNames.Count -gt 0) { $detectedProcessNames } else { @('Insta Playout.exe') }
            $isRunning = ($detectedProcessNames.Count -gt 0)
            $label = $channelDir.Name

            $evidence = New-Object System.Collections.Generic.List[string]
            [void]$evidence.Add("Insta channel found at $channelPath")
            if ($instanceRoot)    { [void]$evidence.Add("Instance root: $instanceRoot") }
            if ($sharedLogDir)    { [void]$evidence.Add("Shared log folder: $sharedLogDir") }
            if ($fnfLog)          { [void]$evidence.Add("FNF log folder: $fnfLog") }
            if ($playlistScanLog) { [void]$evidence.Add("Playlist scan log: $playlistScanLog") }
            foreach ($processName in $processNames) {
                [void]$evidence.Add("Process selector: $processName")
            }

            [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $playerIndex -PlayoutType 'insta' -Label $label -Paths @{
                install_dir      = $channelPath
                instance_root    = $instanceRoot
                shared_log_dir   = $sharedLogDir
                fnf_log          = $fnfLog
                playlistscan_log = $playlistScanLog
            } -ProcessSelectors @{ process_names = $processNames } -LogSelectors @{} -Evidence @($evidence) -Confidence 0.92 -Installed $true -Running $isRunning))
            $playerIndex += 1
        }
    }

    return @($players | ForEach-Object { $_ })
}

# ============================================================================
# ADMAX PLAYER DISCOVERY
# ============================================================================

function Find-AdmaxRootCandidates {
    $programFiles    = Get-EnvPathOrFallback -Name 'ProgramFiles'    -Fallback 'C:\Program Files'
    $programFilesX86 = Get-EnvPathOrFallback -Name 'ProgramFiles(x86)' -Fallback 'C:\Program Files (x86)'
    $roots = New-Object System.Collections.Generic.List[string]
    # Dedup by normalized product-folder name (remove spaces, lowercase) so that
    # 'Admax One 2.0' and 'Admax One2.0' are not counted as separate installations.
    $seenNormalized = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($baseDir in @($programFilesX86, $programFiles)) {
        $unimediaRoot = Join-Path $baseDir 'Unimedia'
        foreach ($productDir in (Get-SafeDirectories -Path $unimediaRoot -Filter 'Admax*')) {
            $normalizedName = ($productDir.Name -replace '\s','').ToLowerInvariant()
            if (-not $seenNormalized.Add($normalizedName)) { continue }
            foreach ($admaxDir in (Get-SafeDirectories -Path $productDir.FullName -Filter 'admax*')) {
                [void]$roots.Add($admaxDir.FullName)
            }
        }
    }

    return @(Get-UniqueStrings -Values @($roots))
}

function Find-AdmaxPlayers {
    param([string]$NodeId)
    $players = New-Object System.Collections.Generic.List[object]
    $roots   = @(Find-AdmaxRootCandidates)

    for ($offset = 0; $offset -lt $roots.Count; $offset++) {
        $admaxRoot = $roots[$offset]

        # Require at least one known executable to exist — folders alone are stale leftovers
        $knownExeNames = @('admax.exe','AdmaxPlayout.exe','AdmaxService.exe','admax_service.exe','AdmaxOne.exe')
        $hasExe = $false
        foreach ($exeName in $knownExeNames) {
            $candidate = Get-SafeFiles -Path $admaxRoot -Filter $exeName -Recurse | Select-Object -First 1
            if ($candidate) { $hasExe = $true; break }
        }
        # Also count as installed if a process is running from this dir or registry confirms it
        $isRunningNow = $false
        try {
            $proc = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
                Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLowerInvariant().StartsWith($admaxRoot.ToLowerInvariant()) } |
                Select-Object -First 1
            if ($proc) { $isRunningNow = $true }
        } catch { }
        if (-not $hasExe -and -not $isRunningNow) { continue }

        $playoutLogDir = Get-FirstExistingDirectory -Candidates @(
            (Join-Path $admaxRoot 'logs\logs\Playout'),
            (Join-Path $admaxRoot 'logs\Playout'),
            (Join-Path $admaxRoot 'bin\64bit\logs\logs\Playout'),
            (Join-Path $admaxRoot 'bin\64bit\logs\Playout')
        )
        $fnfLog = Get-FirstExistingDirectory -Candidates @(
            (Join-Path $admaxRoot 'logs\FNF'),
            (Join-Path $admaxRoot 'bin\64bit\logs\FNF')
        )
        $playlistScanLog = Get-FirstExistingDirectory -Candidates @(
            (Join-Path $admaxRoot 'logs\playlistscan'),
            (Join-Path $admaxRoot 'bin\64bit\logs\playlistscan')
        )
        $settingsIni = Get-FirstExistingFile -Candidates @(
            (Join-Path $admaxRoot 'Settings.ini'),
            (Join-Path $admaxRoot 'bin\Settings.ini'),
            (Join-Path $admaxRoot 'bin\64bit\Settings.ini')
        )

        # Auto-detect running processes whose exe lives inside this admax root
        $detectedProcessNames = @(Get-ProcessNamesInDirectory -DirectoryPath $admaxRoot)

        $evidence = New-Object System.Collections.Generic.List[string]
        [void]$evidence.Add("Admax root found at $admaxRoot")
        if ($playoutLogDir)    { [void]$evidence.Add("Playout log folder found at $playoutLogDir") }
        if ($fnfLog)           { [void]$evidence.Add("FNF log folder found at $fnfLog") }
        if ($playlistScanLog)  { [void]$evidence.Add("Playlist scan log found at $playlistScanLog") }
        if ($settingsIni)      { [void]$evidence.Add("Settings.ini found at $settingsIni") }
        foreach ($pn in $detectedProcessNames) { [void]$evidence.Add("Running process detected: $pn") }

        # Only populate process_selectors when a process was actually found
        $processSelectors = @{}
        if ($detectedProcessNames.Count -gt 0) {
            $processSelectors = @{ process_names = $detectedProcessNames }
        }

        $label = 'Admax {0}' -f ($offset + 1)
        [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $offset -PlayoutType 'admax' -Label $label -Paths @{
            admax_root_candidates = @($admaxRoot)
            admax_state_path      = $settingsIni
            playout_log_dir       = $playoutLogDir
            fnf_log               = $fnfLog
            playlistscan_log      = $playlistScanLog
        } -ProcessSelectors $processSelectors -LogSelectors @{} -Evidence @($evidence) -Confidence 0.94))
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
    param([string]$NodeId, [int]$StartIndex = 0)
    $players  = New-Object System.Collections.Generic.List[object]
    $entries  = @(Get-UninstallEntries)
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
            if (-not ($nameLower -match 'air|playout|automation|cinegy|versio|marina|mosart|oasys|xplayout|inception|prime|wideorbit|bitcentral|spectrum|streampro|airboss')) { continue }

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
            if ($profile.exe.Count -gt 0) { $processSelectors = @{ process_names = @($profile.exe) } }

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
    $vendorNames = @('Cinegy','PlayBox*','Grass Valley','Imagine*','BroadStream*','Pebble*','Evertz*')
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
        @{ id='imagine_versio';    label='Imagine Versio';           match='imagine[\s\-_]*communications|versio|nexio';            log_keywords=@('imagine','versio','nexio') },
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
        'imagine_versio'    = @{ id='imagine_versio';    label='Imagine Versio';          match='imagine|versio';                                       log_keywords=@('imagine','versio') }
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

function Find-GenericProfilePlayers {
    param([string]$NodeId, [int]$StartIndex = 0, [string]$PlayoutHint = 'auto')
    $players          = New-Object System.Collections.Generic.List[object]
    $runningProcesses = @(Get-RunningProcessHints)
    $logHints         = @(Get-GenericLogHints)
    $seen             = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    $profileCounts    = @{}
    $nextIndex        = $StartIndex
    $hintDescriptor   = if ($PlayoutHint -and $PlayoutHint -ne 'auto') { Get-PlayoutProfileDescriptorById -PlayoutType $PlayoutHint } else { $null }

    foreach ($process in $runningProcesses) {
        $name           = [string]$process.name
        $executablePath = [string]$process.executable_path
        $commandLine    = [string]$process.command_line
        $identityText   = @($name, $executablePath, $commandLine) -join ' '
        $descriptor     = Get-PlayoutProfileDescriptor -Text $identityText
        if ($null -eq $descriptor -and $hintDescriptor) { $descriptor = $hintDescriptor }
        if ($null -eq $descriptor) { continue }
        if ($descriptor.id -in @('insta','admax')) { continue }

        $dedupeKey = '{0}|{1}' -f $descriptor.id, ($(if ($executablePath) { $executablePath } else { $name }))
        if (-not $seen.Add($dedupeKey)) { continue }

        if ($profileCounts.ContainsKey($descriptor.id)) { $profileCounts[$descriptor.id] += 1 } else { $profileCounts[$descriptor.id] = 1 }
        $labelNumber = $profileCounts[$descriptor.id]
        $matchedLog  = Get-ProfileLogHint -Descriptor $descriptor -LogHints $logHints -ExecutablePath $executablePath

        $evidence = New-Object System.Collections.Generic.List[string]
        if ($name)           { [void]$evidence.Add("Running process detected: $name") }
        if ($executablePath) { [void]$evidence.Add("Executable path: $executablePath") }
        if ($matchedLog)     { [void]$evidence.Add("Likely log folder found at $matchedLog") }

        $processNames = @()
        if ($name) { $processNames = @($name) }

        $confidence = if ($matchedLog) { 0.72 } else { 0.61 }
        if ($descriptor.id -eq 'generic_windows') { $confidence = if ($matchedLog) { 0.58 } else { 0.46 } }

        [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $nextIndex -PlayoutType $descriptor.id -Label ('{0} {1}' -f $descriptor.label, $labelNumber) -Paths @{
            log_path = $matchedLog
        } -ProcessSelectors @{ process_names = $processNames } -LogSelectors @{} -Evidence @($evidence) -Confidence $confidence))
        $nextIndex += 1
    }

    # NOTE: No fallback phantom player is created when no real playout software is found.
    # The Remote Setup UI provides an "Add player" button for manual addition.

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

    $fixed = @(
        # Installed / live agent config - highest priority (has active agent_token)
        (Join-Path $programData     'ClarixPulse\Agent\config.yaml'),
        (Join-Path $programFiles    'ClarixPulse\Agent\config.yaml'),
        (Join-Path $programFilesX86 'ClarixPulse\Agent\config.yaml'),
        # Beside this script
        (Join-Path $_scriptDir  'config.yaml'),
        (Join-Path (Get-Location) 'config.yaml'),
        # Common bundle subfolder names beside or above the script
        (Join-Path $_scriptDir                          'clarix-pulse-v1.17\config.yaml'),
        (Join-Path $_scriptDir                          'clarix-pulse\config.yaml'),
        (Join-Path (Split-Path $_scriptDir -Parent)     'clarix-pulse-v1.17\config.yaml'),
        (Join-Path (Split-Path $_scriptDir -Parent)     'clarix-pulse\config.yaml'),
        (Join-Path (Split-Path $_scriptDir -Parent)     'config.yaml'),
        # Default install-from-url.ps1 destination
        'C:\pulse-node-bundle\clarix-pulse-v1.17\config.yaml',
        'C:\pulse-node-bundle\clarix-pulse\config.yaml',
        'C:\pulse-node-bundle\config.yaml'
    )

    # Dynamic search - any config.yaml found recursively near the script or bundle roots
    $searchRoots = @(
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
            # Ignore the default example placeholder
            if ($v -and $v -notmatch 'monitor\.example\.com') { $merged.hub_url = $v }
        }
        if ([string]::IsNullOrWhiteSpace($merged.agent_token)) {
            $v = Read-TopLevelYamlScalar -Lines $lines -Key 'agent_token'
            if ($v) { $merged.agent_token = $v }
        }
        if ([string]::IsNullOrWhiteSpace($merged.enrollment_key)) {
            # Check active lines first, then commented lines (VPS bundles sometimes ship key commented)
            $v = Read-TopLevelYamlScalar -Lines $lines -Key 'enrollment_key' -IncludeCommented
            if ($v) { $merged.enrollment_key = $v }
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

$hostname            = $env:COMPUTERNAME
$existingPulseConfig = Get-PulseConfigHints
$nodeSeed            = if ($existingPulseConfig.node_id) { $existingPulseConfig.node_id } else { $hostname }
$nodeId              = if ($existingPulseConfig.node_id) { [string]$existingPulseConfig.node_id } else { Convert-ToNodeSlug -Value $nodeSeed }
$instaPlayers        = @(Find-InstaPlayers   -NodeId $nodeId)
$admaxPlayers        = @(Find-AdmaxPlayers   -NodeId $nodeId)
$registryPlayers     = @(Find-RegistryBroadcastPlayers -NodeId $nodeId -StartIndex ($instaPlayers.Count + $admaxPlayers.Count))
# Exclude registry-detected duplicates of insta/admax (already handled by dedicated scanners)
$registryPlayers     = @($registryPlayers | Where-Object { $_.playout_type -notin @('insta','admax') })
$knownCount          = $instaPlayers.Count + $admaxPlayers.Count + $registryPlayers.Count
$genericPlayers      = @(Find-GenericProfilePlayers -NodeId $nodeId -StartIndex $knownCount -PlayoutHint $PlayoutHint)
# Exclude generic detections already covered by registry scan
$registryTypes       = @($registryPlayers | ForEach-Object { $_.playout_type })
$genericPlayers      = @($genericPlayers | Where-Object { $_.playout_type -notin $registryTypes })
$players             = @($instaPlayers + $admaxPlayers + $registryPlayers + $genericPlayers)
$localTimeZone       = [TimeZoneInfo]::Local
$utcOffsetMinutes    = [int]$localTimeZone.GetUtcOffset((Get-Date)).TotalMinutes

$report = [ordered]@{
    report_version = 1
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
    discovery      = [ordered]@{
        playout_hint            = $PlayoutHint
        detected_player_count   = $players.Count
        detected_playout_types  = @(Get-UniqueStrings -Values @($players | ForEach-Object { $_.playout_type }))
        running_processes       = @(Get-RunningProcessHints)
        generic_log_hints       = @(Get-GenericLogHints)
        existing_pulse_config   = $existingPulseConfig
    }
}

$json = $report | ConvertTo-Json -Depth 12

if (-not $StdOut) {
    $directory = Split-Path -Path $OutputPath -Parent
    if (-not [string]::IsNullOrWhiteSpace($directory) -and -not (Test-Path -LiteralPath $directory)) {
        New-Item -Path $directory -ItemType Directory -Force | Out-Null
    }
    [System.IO.File]::WriteAllText($OutputPath, $json, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "Pulse discovery report written to $OutputPath"
    return
}

$json

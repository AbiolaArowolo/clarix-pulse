param(
    [string]$OutputPath = '',
    [ValidateSet('auto', 'insta', 'admax', 'cinegy_air', 'playbox_neo', 'grass_valley_itx', 'imagine_versio', 'broadstream_oasys', 'pebble_marina', 'evertz_streampro', 'generic_windows')]
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

# -- Self-elevate to Administrator if not already ----------------------------
if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $scriptPath = $MyInvocation.MyCommand.Definition
    $psExe = if (Get-Command pwsh -ErrorAction SilentlyContinue) { 'pwsh' } else { 'powershell.exe' }
    try {
        Start-Process $psExe -ArgumentList "-ExecutionPolicy Bypass -NoProfile -File `"$scriptPath`"" -Verb RunAs -ErrorAction Stop
        exit
    } catch {
        Write-Warning "Could not elevate to Administrator. Continuing without elevation..."
    }
}

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
    $seen  = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
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
        [string[]]$Evidence, [double]$Confidence
    )
    $playerId = '{0}-{1}-{2}' -f $NodeId, $PlayoutType, ($Index + 1)
    return [ordered]@{
        player_id          = $playerId
        label              = $Label
        playout_type       = $PlayoutType
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
    $patterns = '(insta|admax|cinegy|airbox|itx|versio|broadstream|oasys|marina|evertz|playout)'
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
    $roots   = New-Object System.Collections.Generic.List[string]

    foreach ($baseDir in @($programFiles, $programFilesX86)) {
        $indytekRoot = Join-Path $baseDir 'Indytek'
        foreach ($installDir in (Get-SafeDirectories -Path $indytekRoot -Filter 'Insta Playout*')) {
            [void]$roots.Add($installDir.FullName)
        }
    }

    # FIX: wrap in @() - PS 5.1 returns $null for empty array from function, causing .Count crash in strict mode
    $instaRoots = @(Get-UniqueStrings -Values @($roots))
    for ($index = 0; $index -lt $instaRoots.Count; $index++) {
        $installRoot = $instaRoots[$index]
        $instanceRoot = Get-FirstExistingDirectory -Candidates @(
            (Join-Path $installRoot 'Settings'),
            (Join-Path $installRoot 'settings')
        )
        $sharedLogDir = Get-FirstExistingDirectory -Candidates @(
            (Join-Path (Split-Path $installRoot -Parent) 'Insta log'),
            (Join-Path $installRoot 'Insta log'),
            (Join-Path $installRoot 'logs')
        )
        $fnfLog = Get-FirstExistingDirectory -Candidates @(
            (Join-Path $sharedLogDir 'FNF'),
            (Join-Path $sharedLogDir 'fnf'),
            (Join-Path $installRoot 'logs\FNF'),
            (Join-Path $installRoot 'logs\fnf'),
            (Join-Path $installRoot 'FNF')
        )
        $playlistScanLog = Get-FirstExistingDirectory -Candidates @(
            (Join-Path $installRoot 'logs\playlistscan'),
            (Join-Path $installRoot 'playlistscan')
        )

        $evidence = New-Object System.Collections.Generic.List[string]
        [void]$evidence.Add("Insta install root found at $installRoot")
        if ($instanceRoot)    { [void]$evidence.Add("Settings folder found at $instanceRoot") }
        if ($sharedLogDir)    { [void]$evidence.Add("Shared log folder found at $sharedLogDir") }
        if ($fnfLog)          { [void]$evidence.Add("FNF log folder found at $fnfLog") }
        if ($playlistScanLog) { [void]$evidence.Add("Playlist scan log found at $playlistScanLog") }

        $label = 'Insta {0}' -f ($index + 1)
        [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $index -PlayoutType 'insta' -Label $label -Paths @{
            shared_log_dir   = $sharedLogDir
            instance_root    = $instanceRoot
            fnf_log          = $fnfLog
            playlistscan_log = $playlistScanLog
        } -ProcessSelectors @{ process_names = @('Insta Playout.exe') } -LogSelectors @{} -Evidence @($evidence) -Confidence 0.92))
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

    foreach ($baseDir in @($programFilesX86, $programFiles)) {
        $unimediaRoot = Join-Path $baseDir 'Unimedia'
        foreach ($productDir in (Get-SafeDirectories -Path $unimediaRoot -Filter 'Admax*')) {
            # Find all admax instance folders: admax, admax2, admax3, admax4 etc.
            foreach ($admaxDir in (Get-SafeDirectories -Path $productDir.FullName -Filter 'admax*')) {
                [void]$roots.Add($admaxDir.FullName)
            }
            # Also recurse one level deeper for nested layouts
            foreach ($nested in (Get-SafeDirectories -Path $productDir.FullName -Filter 'admax*' -Recurse)) {
                [void]$roots.Add($nested.FullName)
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
        @{ id='insta';             label='Indytek Insta';            match='indytek|(^|[^a-z0-9])insta([^a-z0-9]|$)';              log_keywords=@('indytek','insta') },
        @{ id='admax';             label='Unimedia Admax';           match='unimedia|(^|[^a-z0-9])admax([^a-z0-9]|$)';             log_keywords=@('unimedia','admax') },
        @{ id='cinegy_air';        label='Cinegy Air';               match='cinegy';                                                log_keywords=@('cinegy') },
        @{ id='playbox_neo';       label='PlayBox Neo';              match='playbox|airbox';                                        log_keywords=@('playbox','airbox') },
        @{ id='grass_valley_itx';  label='Grass Valley iTX';         match='grass[\s\-_]*valley|(^|[^a-z0-9])itx([^a-z0-9]|$)';   log_keywords=@('grass valley','itx') },
        @{ id='imagine_versio';    label='Imagine Versio';           match='imagine|versio';                                        log_keywords=@('imagine','versio') },
        @{ id='broadstream_oasys'; label='BroadStream OASYS';        match='broadstream|oasys';                                     log_keywords=@('broadstream','oasys') },
        @{ id='pebble_marina';     label='Pebble Marina';            match='pebble|marina';                                         log_keywords=@('pebble','marina') },
        @{ id='evertz_streampro';  label='Evertz StreamPro';         match='evertz|streampro|overture';                             log_keywords=@('evertz','streampro','overture') }
    )
    foreach ($descriptor in $descriptors) {
        if ($lower -match $descriptor.match) { return $descriptor }
    }
    if ($lower -match 'playout|automation|channel|asrun|schedule') {
        return @{ id='generic_windows'; label='Generic Windows Playout'; match='playout'; log_keywords=@('log','logs','asrun','playout','automation') }
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
        'playbox_neo'       = @{ id='playbox_neo';       label='PlayBox Neo';             match='playbox|airbox';                                       log_keywords=@('playbox','airbox') }
        'grass_valley_itx'  = @{ id='grass_valley_itx';  label='Grass Valley iTX';        match='grass[\s\-_]*valley|(^|[^a-z0-9])itx([^a-z0-9]|$)';  log_keywords=@('grass valley','itx') }
        'imagine_versio'    = @{ id='imagine_versio';    label='Imagine Versio';          match='imagine|versio';                                       log_keywords=@('imagine','versio') }
        'broadstream_oasys' = @{ id='broadstream_oasys'; label='BroadStream OASYS';       match='broadstream|oasys';                                    log_keywords=@('broadstream','oasys') }
        'pebble_marina'     = @{ id='pebble_marina';     label='Pebble Marina';           match='pebble|marina';                                        log_keywords=@('pebble','marina') }
        'evertz_streampro'  = @{ id='evertz_streampro';  label='Evertz StreamPro';        match='evertz|streampro|overture';                            log_keywords=@('evertz','streampro','overture') }
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
    $seen             = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
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

    if ($players.Count -eq 0 -and $logHints.Count -gt 0) {
        $fallbackDescriptor = if ($hintDescriptor) { $hintDescriptor } else { Get-PlayoutProfileDescriptorById -PlayoutType 'generic_windows' }
        [void]$players.Add((New-PlayerReport -NodeId $NodeId -Index $nextIndex -PlayoutType $fallbackDescriptor.id -Label ('{0} 1' -f $fallbackDescriptor.label) -Paths @{
            log_path = $logHints[0]
        } -ProcessSelectors @{} -LogSelectors @{} -Evidence @("Generic log folder found at $($logHints[0])") -Confidence 0.42))
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

    $fixed = @(
        # Installed / live agent config - highest priority (has active agent_token)
        (Join-Path $programData     'ClarixPulse\Agent\config.yaml'),
        (Join-Path $programFiles    'ClarixPulse\Agent\config.yaml'),
        (Join-Path $programFilesX86 'ClarixPulse\Agent\config.yaml'),
        # Beside this script
        (Join-Path $_scriptDir  'config.yaml'),
        (Join-Path (Get-Location) 'config.yaml'),
        # Common bundle subfolder names beside or above the script
        (Join-Path $_scriptDir                          'clarix-pulse-v1.9\config.yaml'),
        (Join-Path $_scriptDir                          'clarix-pulse\config.yaml'),
        (Join-Path (Split-Path $_scriptDir -Parent)     'clarix-pulse-v1.9\config.yaml'),
        (Join-Path (Split-Path $_scriptDir -Parent)     'clarix-pulse\config.yaml'),
        (Join-Path (Split-Path $_scriptDir -Parent)     'config.yaml'),
        # Default install-from-url.ps1 destination
        'C:\pulse-node-bundle\clarix-pulse-v1.9\config.yaml',
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
$genericPlayers      = @(Find-GenericProfilePlayers -NodeId $nodeId -StartIndex ($instaPlayers.Count + $admaxPlayers.Count) -PlayoutHint $PlayoutHint)
$players             = @($instaPlayers + $admaxPlayers + $genericPlayers)
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
    $json | Set-Content -Path $OutputPath -Encoding UTF8
    Write-Host "Pulse discovery report written to $OutputPath"
    return
}

$json

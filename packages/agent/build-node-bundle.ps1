param(
    [string]$OutputRoot = (Join-Path $PSScriptRoot 'release'),
    [string]$BundleName = 'pulse-node-bundle',
    [string]$VersionLabel = '',
    [string]$ConfigPath = '',
    [switch]$Zip,
    [switch]$SkipVendorValidation,
    [switch]$LegacyFlatZip,
    [switch]$Sign,
    [string]$SignCertificateThumbprint = '',
    [string]$SignCertificatePath = '',
    [string]$SignCertificatePassword = '',
    [string]$SignTimestampUrl = '',
    [switch]$SignUseMachineStore,
    [string]$SignToolPath = ''
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
$setupExecutableName = 'ClarixPulseSetup.exe'
$uninstallExecutableName = 'Uninstall.exe'

# Optional signing inputs (CLI or env):
#   CLARIX_SIGN_ENABLE=true
#   CLARIX_SIGN_CERT_THUMBPRINT=<thumbprint>  OR  CLARIX_SIGN_CERT_PATH=<path-to-pfx>
#   CLARIX_SIGN_CERT_PASSWORD=<pfx-password>
#   CLARIX_SIGN_TIMESTAMP_URL=http://timestamp.digicert.com
#   CLARIX_SIGN_USE_MACHINE_STORE=true
#   CLARIX_SIGNTOOL_PATH=<path-to-signtool.exe>

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
    $archivePath = $ZipPath
    $temporaryZipPath = $null

    # Expand-Archive only supports .zip; Chocolatey packages are .nupkg.
    if ([string]::Equals([System.IO.Path]::GetExtension($ZipPath), '.nupkg', [System.StringComparison]::OrdinalIgnoreCase)) {
        $temporaryZipPath = [System.IO.Path]::ChangeExtension([System.IO.Path]::GetTempFileName(), '.zip')
        Copy-Item -Path $ZipPath -Destination $temporaryZipPath -Force
        $archivePath = $temporaryZipPath
    }

    try {
        Expand-Archive -Path $archivePath -DestinationPath $Destination -Force
    } finally {
        if ($temporaryZipPath -and (Test-Path -LiteralPath $temporaryZipPath -PathType Leaf)) {
            Remove-Item -LiteralPath $temporaryZipPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-FirstMatch {
    param(
        [string]$Root,
        [string]$Filter
    )
    Get-ChildItem -Path $Root -Recurse -File -Filter $Filter | Select-Object -First 1
}

function Ensure-IExpressBinary {
    $iexpress = Get-Command 'iexpress.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $iexpress -or -not (Test-Path -LiteralPath $iexpress.Source -PathType Leaf)) {
        throw 'iexpress.exe was not found. This bundle build requires Windows IExpress.'
    }
    return [string]$iexpress.Source
}

function Ensure-7ZipBinary {
    $commands = @(
        (Get-Command '7z.exe' -ErrorAction SilentlyContinue | Select-Object -First 1),
        (Get-Command '7za.exe' -ErrorAction SilentlyContinue | Select-Object -First 1),
        (Get-Command '7zr.exe' -ErrorAction SilentlyContinue | Select-Object -First 1)
    ) | Where-Object { $_ -and (Test-Path -LiteralPath $_.Source -PathType Leaf) }

    if ($commands) {
        return [string]$commands[0].Source
    }

    foreach ($candidate in @(
        'C:\Program Files\7-Zip\7z.exe',
        'C:\Program Files (x86)\7-Zip\7z.exe'
    )) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [string](Resolve-Path -LiteralPath $candidate).Path
        }
    }

    throw '7z.exe was not found. Install 7-Zip or add it to PATH before building node bundles.'
}

function Get-7ZipSfxModulePath {
    param([string]$SevenZipPath)

    $sevenZipDirectory = Split-Path -Path $SevenZipPath -Parent
    foreach ($moduleName in @('7z.sfx', '7zCon.sfx')) {
        $modulePath = Join-Path $sevenZipDirectory $moduleName
        if (Test-Path -LiteralPath $modulePath -PathType Leaf) {
            return [string](Resolve-Path -LiteralPath $modulePath).Path
        }
    }

    throw "7-Zip SFX module was not found beside $SevenZipPath"
}

function Get-BooleanValue {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return $false }
    return @('1','true','yes','y','on') -contains $Value.Trim().ToLowerInvariant()
}

function Ensure-SignToolBinary {
    param([string]$PreferredPath = '')
    if (-not [string]::IsNullOrWhiteSpace($PreferredPath)) {
        if (Test-Path -LiteralPath $PreferredPath -PathType Leaf) {
            return [string](Resolve-Path -LiteralPath $PreferredPath).Path
        }
        throw "Configured signtool path not found: $PreferredPath"
    }
    $signtool = Get-Command 'signtool.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $signtool -or -not (Test-Path -LiteralPath $signtool.Source -PathType Leaf)) {
        throw 'signtool.exe was not found. Install Windows SDK signing tools or set CLARIX_SIGNTOOL_PATH.'
    }
    return [string]$signtool.Source
}

function Resolve-SigningOptions {
    $enabled = $Sign.IsPresent -or (Get-BooleanValue -Value ([string]$env:CLARIX_SIGN_ENABLE))
    if (-not $enabled) {
        return [ordered]@{ enabled = $false }
    }

    $timestampUrl = if (-not [string]::IsNullOrWhiteSpace($SignTimestampUrl)) {
        $SignTimestampUrl
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$env:CLARIX_SIGN_TIMESTAMP_URL)) {
        [string]$env:CLARIX_SIGN_TIMESTAMP_URL
    } else {
        'http://timestamp.digicert.com'
    }
    $thumbprint = if (-not [string]::IsNullOrWhiteSpace($SignCertificateThumbprint)) {
        $SignCertificateThumbprint
    } else {
        [string]$env:CLARIX_SIGN_CERT_THUMBPRINT
    }
    $certPath = if (-not [string]::IsNullOrWhiteSpace($SignCertificatePath)) {
        $SignCertificatePath
    } else {
        [string]$env:CLARIX_SIGN_CERT_PATH
    }
    $certPassword = if (-not [string]::IsNullOrWhiteSpace($SignCertificatePassword)) {
        $SignCertificatePassword
    } else {
        [string]$env:CLARIX_SIGN_CERT_PASSWORD
    }
    $useMachineStore = $SignUseMachineStore.IsPresent -or (Get-BooleanValue -Value ([string]$env:CLARIX_SIGN_USE_MACHINE_STORE))

    if ([string]::IsNullOrWhiteSpace($thumbprint) -and [string]::IsNullOrWhiteSpace($certPath)) {
        throw 'Signing is enabled but no certificate was provided. Set thumbprint or PFX path.'
    }

    return [ordered]@{
        enabled         = $true
        signtool        = (Ensure-SignToolBinary -PreferredPath $(if (-not [string]::IsNullOrWhiteSpace($SignToolPath)) { $SignToolPath } else { [string]$env:CLARIX_SIGNTOOL_PATH }))
        timestamp_url   = $timestampUrl
        thumbprint      = $thumbprint
        cert_path       = $certPath
        cert_password   = $certPassword
        machine_store   = $useMachineStore
    }
}

function Invoke-CodeSign {
    param(
        [string]$FilePath,
        [hashtable]$SigningOptions
    )

    if (-not $SigningOptions.enabled) { return }
    if (-not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        throw "Cannot sign missing file: $FilePath"
    }

    $args = @('sign', '/fd', 'SHA256', '/td', 'SHA256', '/tr', [string]$SigningOptions.timestamp_url)
    if (-not [string]::IsNullOrWhiteSpace([string]$SigningOptions.cert_path)) {
        $args += @('/f', [string]$SigningOptions.cert_path)
        if (-not [string]::IsNullOrWhiteSpace([string]$SigningOptions.cert_password)) {
            $args += @('/p', [string]$SigningOptions.cert_password)
        }
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$SigningOptions.thumbprint)) {
        $args += @('/sha1', [string]$SigningOptions.thumbprint, '/s', 'My')
        if ([bool]$SigningOptions.machine_store) {
            $args += '/sm'
        }
    } else {
        $args += '/a'
    }
    $args += $FilePath

    & ([string]$SigningOptions.signtool) @args | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "signtool sign failed for $FilePath (exit $LASTEXITCODE)."
    }

    & ([string]$SigningOptions.signtool) verify /pa /v $FilePath | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "signtool verify failed for $FilePath (exit $LASTEXITCODE)."
    }
}

function New-IExpressPackage {
    param(
        [string]$IExpressPath,
        [string]$SourceDirectory,
        [string[]]$SourceFiles,
        [string]$AppLaunched,
        [string]$FriendlyName,
        [string]$TargetName
    )

    if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
        throw "IExpress source directory not found: $SourceDirectory"
    }
    if (-not $SourceFiles -or $SourceFiles.Count -eq 0) {
        throw 'IExpress package requires at least one source file.'
    }

    $sedPath = Join-Path $tempRoot ('clarix-iexpress-' + [guid]::NewGuid().ToString('N') + '.sed')
    $lines = New-Object System.Collections.Generic.List[string]
    [void]$lines.Add('[Version]')
    [void]$lines.Add('Class=IEXPRESS')
    [void]$lines.Add('SEDVersion=3')
    [void]$lines.Add('[Options]')
    [void]$lines.Add('PackagePurpose=InstallApp')
    [void]$lines.Add('ShowInstallProgramWindow=1')
    [void]$lines.Add('HideExtractAnimation=1')
    [void]$lines.Add('UseLongFileName=1')
    [void]$lines.Add('InsideCompressed=1')
    [void]$lines.Add('CAB_FixedSize=0')
    [void]$lines.Add('CAB_ResvCodeSigning=0')
    [void]$lines.Add('RebootMode=N')
    [void]$lines.Add('InstallPrompt=')
    [void]$lines.Add('DisplayLicense=')
    [void]$lines.Add('FinishMessage=')
    [void]$lines.Add(('TargetName={0}' -f $TargetName))
    [void]$lines.Add(('FriendlyName={0}' -f $FriendlyName))
    [void]$lines.Add(('AppLaunched={0}' -f $AppLaunched))
    [void]$lines.Add('PostInstallCmd=<None>')
    [void]$lines.Add(('AdminQuietInstCmd={0}' -f $AppLaunched))
    [void]$lines.Add(('UserQuietInstCmd={0}' -f $AppLaunched))
    [void]$lines.Add('SourceFiles=SourceFiles')
    [void]$lines.Add('[SourceFiles]')
    [void]$lines.Add(('SourceFiles0={0}' -f $SourceDirectory))
    [void]$lines.Add('[SourceFiles0]')

    for ($index = 0; $index -lt $SourceFiles.Count; $index++) {
        [void]$lines.Add(('%FILE{0}%=' -f $index))
    }

    [void]$lines.Add('[Strings]')
    for ($index = 0; $index -lt $SourceFiles.Count; $index++) {
        [void]$lines.Add(('FILE{0}="{1}"' -f $index, $SourceFiles[$index]))
    }

    [System.IO.File]::WriteAllLines($sedPath, $lines)
    & $IExpressPath /N /Q $sedPath | Out-Null
    if (-not (Test-Path -LiteralPath $TargetName -PathType Leaf)) {
        throw "Failed to generate IExpress package: $TargetName"
    }
}

function New-7ZipSfxPackage {
    param(
        [string]$SevenZipPath,
        [string]$SfxModulePath,
        [string]$SourceDirectory,
        [string]$AppLaunched,
        [string]$FriendlyName,
        [string]$TargetName
    )

    if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
        throw "7-Zip SFX source directory not found: $SourceDirectory"
    }

    $archivePath = Join-Path $tempRoot ('clarix-7zsfx-' + [guid]::NewGuid().ToString('N') + '.7z')
    $configPath = Join-Path $tempRoot ('clarix-7zsfx-' + [guid]::NewGuid().ToString('N') + '.txt')

    Push-Location $SourceDirectory
    try {
        & $SevenZipPath a -t7z -mx=9 -y $archivePath '.\*' | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "7-Zip archive build failed for $FriendlyName (exit $LASTEXITCODE)."
        }
    }
    finally {
        Pop-Location
    }

    $configText = @"
;!@Install@!UTF-8!
Title="$FriendlyName"
RunProgram="cmd.exe /c $AppLaunched"
GUIMode="2"
;!@InstallEnd@!
"@
    [System.IO.File]::WriteAllText(
        $configPath,
        $configText,
        (New-Object System.Text.UTF8Encoding($false))
    )

    $targetDirectory = Split-Path -Path $TargetName -Parent
    if (-not [string]::IsNullOrWhiteSpace($targetDirectory)) {
        Ensure-Directory -Path $targetDirectory
    }

    $outputStream = [System.IO.File]::Open($TargetName, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
    try {
        foreach ($partPath in @($SfxModulePath, $configPath, $archivePath)) {
            $bytes = [System.IO.File]::ReadAllBytes($partPath)
            $outputStream.Write($bytes, 0, $bytes.Length)
        }
    }
    finally {
        $outputStream.Dispose()
    }

    if (-not (Test-Path -LiteralPath $TargetName -PathType Leaf)) {
        throw "Failed to generate 7-Zip SFX package: $TargetName"
    }
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
        $nestedArchives = Get-ChildItem -Path $workDir -Recurse -File -Filter '*.zip'
        foreach ($archive in $nestedArchives) {
            $nestedTarget = Join-Path $workDir ("expanded-" + [System.IO.Path]::GetFileNameWithoutExtension($archive.Name))
            Expand-Zip -ZipPath $archive.FullName -Destination $nestedTarget
        }
        $nssm = Get-ChildItem -Path $workDir -Recurse -File -Filter 'nssm.exe' |
            Where-Object { $_.FullName -match 'win64' } |
            Select-Object -First 1
    }
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
    $ffmpegUrls = @(
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
        'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n8.0-latest-win64-gpl-8.0.zip',
        'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
    )
    $downloaded = $false
    foreach ($url in $ffmpegUrls) {
        try {
            Download-File -Uri $url -OutFile $zipPath
            $downloaded = $true
            break
        } catch {
            Write-Warning "FFmpeg download failed from $url ($($_.Exception.Message)); trying next source."
        }
    }
    if (-not $downloaded) {
        throw 'Failed to download FFmpeg archive from all known sources.'
    }
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
    @{ Source = (Join-Path $PSScriptRoot 'configure.bat'); Target = 'configure.bat' }
    @{ Source = (Join-Path $PSScriptRoot 'install.bat'); Target = 'install.bat' }
    @{ Source = (Join-Path $PSScriptRoot 'uninstall.bat'); Target = 'uninstall.bat' }
    @{ Source = (Join-Path $PSScriptRoot 'install-from-url.ps1'); Target = 'install-from-url.ps1' }
    @{ Source = (Join-Path $PSScriptRoot 'remove-pulse-agent.ps1'); Target = 'remove-pulse-agent.ps1' }
    @{ Source = (Join-Path $PSScriptRoot 'config.example.yaml'); Target = 'config.example.yaml' }
    @{ Source = (Join-Path $PSScriptRoot 'fingerprint_manifest.json'); Target = 'fingerprint_manifest.json' }
    @{ Source = (Join-Path $PSScriptRoot 'confidence_scorer.py'); Target = 'confidence_scorer.py' }
    @{ Source = (Join-Path $PSScriptRoot 'learning_store.py'); Target = 'learning_store.py' }
    @{ Source = (Join-Path $PSScriptRoot 'discover-node.ps1'); Target = 'discover-node.ps1' }
    @{ Source = (Join-Path $PSScriptRoot 'show-discovery-summary.ps1'); Target = 'show-discovery-summary.ps1' }
    @{ Source = (Join-Path $PSScriptRoot 'README.txt'); Target = 'README.txt' }
)

$vendorFiles = @(
    @{ Name = 'nssm.exe'; Required = $true }
    @{ Name = 'ffmpeg.exe'; Required = $false }
    @{ Name = 'ffprobe.exe'; Required = $false }
)

try {
    $signingOptions = Resolve-SigningOptions
    if (-not $signingOptions.enabled) {
        Write-Warning 'Building unsigned Clarix Pulse executables. Windows will show "Publisher: Unknown" and Microsoft Defender SmartScreen warnings until code signing is configured.'
    }
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

    Invoke-CodeSign -FilePath (Join-Path $bundleDir 'clarix-agent.exe') -SigningOptions $signingOptions

    $sevenZipPath = Ensure-7ZipBinary
    $sevenZipSfxModulePath = Get-7ZipSfxModulePath -SevenZipPath $sevenZipPath

    $setupSourceDir = Join-Path $tempRoot ('clarix-setup-src-' + [guid]::NewGuid().ToString('N'))
    Ensure-Directory -Path $setupSourceDir
    Get-ChildItem -Path $bundleDir -File | ForEach-Object {
        Copy-Item -Path $_.FullName -Destination (Join-Path $setupSourceDir $_.Name) -Force
    }

    $setupLauncherPath = Join-Path $setupSourceDir 'launcher-install.cmd'
@'
@echo off
setlocal EnableExtensions
set "ORIGIN_CWD=%CD%"
set "SRC_DIR=%~dp0"
pushd "%SRC_DIR%" >nul 2>nul
if errorlevel 1 (
    echo [%DATE% %TIME%] ClarixPulseSetup launcher started > "%TEMP%\clarixpulse-install-launcher.log"
    echo Source folder is not accessible: %SRC_DIR% >> "%TEMP%\clarixpulse-install-launcher.log"
    start "" "%ComSpec%" /K "echo Clarix Pulse install failed: source folder inaccessible. & echo Log: %TEMP%\clarixpulse-install-launcher.log & type ""%TEMP%\clarixpulse-install-launcher.log"""
    exit /b 1
)
set "SRC_DIR=%CD%"
popd >nul 2>nul
set "PRIMARY_TARGET=C:\ClarixPulse"
set "FALLBACK_TARGET=%LOCALAPPDATA%\ClarixPulse"
set "TARGET_DIR=%PRIMARY_TARGET%"
set "TEMP_LOG=%TEMP%\clarixpulse-install-launcher.log"
set "LOG_PATH=%TEMP_LOG%"

echo [%DATE% %TIME%] ClarixPulseSetup launcher started > "%TEMP_LOG%"
echo Source=%SRC_DIR% >> "%TEMP_LOG%"
echo OriginCwd=%ORIGIN_CWD% >> "%TEMP_LOG%"
echo PrimaryTarget=%PRIMARY_TARGET% >> "%TEMP_LOG%"
echo FallbackTarget=%FALLBACK_TARGET% >> "%TEMP_LOG%"

if not exist "%SRC_DIR%" (
    echo Source folder is missing: %SRC_DIR% >> "%TEMP_LOG%"
    start "" "%ComSpec%" /K "echo Clarix Pulse install failed: source folder missing. & echo Log: %TEMP_LOG% & type ""%TEMP_LOG%"""
    exit /b 1
)

if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%" >nul 2>nul
if not exist "%TARGET_DIR%" (
    set "TARGET_DIR=%FALLBACK_TARGET%"
    if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%" >nul 2>nul
)
if not exist "%TARGET_DIR%" (
    echo Could not create install folder with current permissions. >> "%TEMP_LOG%"
    start "" "%ComSpec%" /K "echo Clarix Pulse install failed: cannot create install folder. & echo Log: %TEMP_LOG% & type ""%TEMP_LOG%"""
    exit /b 1
)

set "LOG_PATH=%TARGET_DIR%\install-launcher.log"
copy /Y "%TEMP_LOG%" "%LOG_PATH%" >nul 2>nul
echo UsingTarget=%TARGET_DIR% >> "%LOG_PATH%"

robocopy "%SRC_DIR%" "%TARGET_DIR%" *.* /E /R:2 /W:1 /NFL /NDL /NJH /NJS /XF launcher-install.cmd >> "%LOG_PATH%" 2>&1
set "ROBO=%ERRORLEVEL%"
echo RobocopyExit=%ROBO% >> "%LOG_PATH%"
if not defined ROBO set "ROBO=999"
if %ROBO% GEQ 8 (
    echo Failed to copy Clarix Pulse files to %TARGET_DIR%. Robocopy exit %ROBO%. >> "%LOG_PATH%"
    start "" "%ComSpec%" /K "echo Clarix Pulse install failed: copy stage. & echo Log: %LOG_PATH% & type ""%LOG_PATH%"""
    exit /b 1
)

if exist "%ORIGIN_CWD%\README.txt" (
    copy /Y "%ORIGIN_CWD%\README.txt" "%TARGET_DIR%\README.txt" >nul 2>nul
    if not errorlevel 1 (
        echo CopiedReadme=%ORIGIN_CWD%\README.txt >> "%LOG_PATH%"
    )
)

if exist "%ORIGIN_CWD%\pulse-account.json" (
    copy /Y "%ORIGIN_CWD%\pulse-account.json" "%TARGET_DIR%\pulse-account.json" >nul 2>nul
    if not errorlevel 1 (
        echo CopiedPulseAccount=%ORIGIN_CWD%\pulse-account.json >> "%LOG_PATH%"
    )
)

if not exist "%TARGET_DIR%\setup.bat" (
    echo setup.bat was not copied to %TARGET_DIR%. >> "%LOG_PATH%"
    start "" "%ComSpec%" /K "echo Clarix Pulse install failed: setup.bat missing. & echo Log: %LOG_PATH% & type ""%LOG_PATH%"""
    exit /b 1
)

echo Launching setup.bat from %TARGET_DIR% >> "%LOG_PATH%"
start "" "%ComSpec%" /C "cd /d ""%TARGET_DIR%"" && call setup.bat"
exit /b 0
'@ | Set-Content -Path $setupLauncherPath -Encoding ASCII

    New-7ZipSfxPackage `
        -SevenZipPath $sevenZipPath `
        -SfxModulePath $sevenZipSfxModulePath `
        -SourceDirectory $setupSourceDir `
        -AppLaunched 'launcher-install.cmd' `
        -FriendlyName 'Clarix Pulse Setup' `
        -TargetName (Join-Path $bundleDir $setupExecutableName)
    Invoke-CodeSign -FilePath (Join-Path $bundleDir $setupExecutableName) -SigningOptions $signingOptions

    $uninstallSourceDir = Join-Path $tempRoot ('clarix-uninstall-src-' + [guid]::NewGuid().ToString('N'))
    Ensure-Directory -Path $uninstallSourceDir
    $uninstallLauncherPath = Join-Path $uninstallSourceDir 'launcher-uninstall.cmd'
@'
@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "LOG_PATH=%TEMP%\clarixpulse-uninstall-launcher.log"
set "PROGRAM_DATA_ROOT=%ProgramData%"
if not defined PROGRAM_DATA_ROOT set "PROGRAM_DATA_ROOT=C:\ProgramData"
set "TARGET_DIR="

for %%D in ("%PROGRAM_DATA_ROOT%\ClarixPulse\Agent" "C:\ClarixPulse" "%LOCALAPPDATA%\ClarixPulse" "%APPDATA%\ClarixPulse") do (
    if not defined TARGET_DIR if exist "%%~fD\clarix-agent.exe" set "TARGET_DIR=%%~fD"
)

if not defined TARGET_DIR (
    for %%D in ("%PROGRAM_DATA_ROOT%\ClarixPulse\Agent" "C:\ClarixPulse" "%LOCALAPPDATA%\ClarixPulse" "%APPDATA%\ClarixPulse") do (
        if not defined TARGET_DIR if exist "%%~fD\uninstall.bat" set "TARGET_DIR=%%~fD"
    )
)

if not defined TARGET_DIR call :ResolveFromService "ClarixPulseAgent"
if not defined TARGET_DIR call :ResolveFromService "clarix-pulse-agent"

if not defined TARGET_DIR (
    echo [%DATE% %TIME%] Uninstall launcher could not find an installed target > "%LOG_PATH%"
    start "" "%ComSpec%" /K "echo Clarix Pulse is not installed on this PC. & exit /b 0"
    exit /b 0
)

echo [%DATE% %TIME%] Uninstall launcher started > "%LOG_PATH%"
echo Target=%TARGET_DIR% >> "%LOG_PATH%"

set "UNINSTALL_EXIT=1"
if exist "%TARGET_DIR%\uninstall.bat" (
    pushd "%TARGET_DIR%" >nul 2>&1
    call uninstall.bat
    set "UNINSTALL_EXIT=!ERRORLEVEL!"
    popd >nul 2>&1
    if not defined UNINSTALL_EXIT set "UNINSTALL_EXIT=1"
    if "!UNINSTALL_EXIT!"=="0" exit /b 0
)

if exist "%TARGET_DIR%\clarix-agent.exe" (
    "%TARGET_DIR%\clarix-agent.exe" --uninstall-service >> "%LOG_PATH%" 2>&1
    set "UNINSTALL_EXIT=!ERRORLEVEL!"
    if "!UNINSTALL_EXIT!"=="0" exit /b 0
)

if exist "%TARGET_DIR%\uninstall.bat" (
    exit /b !UNINSTALL_EXIT!
)

if exist "%TARGET_DIR%\remove-pulse-agent.ps1" (
    set "TEMP_SCRIPT=%TEMP%\clarix-pulse-uninstall-%RANDOM%%RANDOM%.ps1"
    copy /Y "%TARGET_DIR%\remove-pulse-agent.ps1" "%TEMP_SCRIPT%" >> "%LOG_PATH%" 2>&1
    if errorlevel 1 (
        echo [%DATE% %TIME%] Failed to copy remove-pulse-agent.ps1 to temp. >> "%LOG_PATH%"
        set "UNINSTALL_EXIT=1"
        exit /b !UNINSTALL_EXIT!
    )
    set "CLARIX_INSTALL_ROOT=%TARGET_DIR%"
    powershell -ExecutionPolicy Bypass -NoProfile -File "%TEMP_SCRIPT%" -InstallRoot "%TARGET_DIR%" >> "%LOG_PATH%" 2>&1
    set "UNINSTALL_EXIT=!ERRORLEVEL!"
    del /f /q "%TEMP_SCRIPT%" >> "%LOG_PATH%" 2>&1
    set "CLARIX_INSTALL_ROOT="
)
if not defined UNINSTALL_EXIT set "UNINSTALL_EXIT=1"
exit /b !UNINSTALL_EXIT!

:ResolveFromService
set "SERVICE_NAME=%~1"
set "SERVICE_BINLINE="
set "SERVICE_BIN="
set "SERVICE_DIR="
for /f "tokens=3,*" %%A in ('sc.exe qc "%SERVICE_NAME%" 2^>nul ^| findstr /I "BINARY_PATH_NAME"') do (
    set "SERVICE_BINLINE=%%A %%B"
)
if not defined SERVICE_BINLINE goto :eof
set "SERVICE_BINLINE=!SERVICE_BINLINE:"=!"
for /f "tokens=1 delims= " %%P in ("!SERVICE_BINLINE!") do set "SERVICE_BIN=%%P"
if not defined SERVICE_BIN goto :eof
for %%F in ("!SERVICE_BIN!") do set "SERVICE_DIR=%%~dpF"
if not defined SERVICE_DIR goto :eof
if "!SERVICE_DIR:~-1!"=="\" set "SERVICE_DIR=!SERVICE_DIR:~0,-1!"
if exist "!SERVICE_DIR!\uninstall.bat" set "TARGET_DIR=!SERVICE_DIR!"
if not defined TARGET_DIR if exist "!SERVICE_DIR!\clarix-agent.exe" set "TARGET_DIR=!SERVICE_DIR!"
goto :eof
'@ | Set-Content -Path $uninstallLauncherPath -Encoding ASCII

    New-7ZipSfxPackage `
        -SevenZipPath $sevenZipPath `
        -SfxModulePath $sevenZipSfxModulePath `
        -SourceDirectory $uninstallSourceDir `
        -AppLaunched 'launcher-uninstall.cmd' `
        -FriendlyName 'Clarix Pulse Uninstall' `
        -TargetName (Join-Path $bundleDir $uninstallExecutableName)
    Invoke-CodeSign -FilePath (Join-Path $bundleDir $uninstallExecutableName) -SigningOptions $signingOptions

    if ($Zip) {
        $zipPath = Join-Path $OutputRoot ($effectiveBundleName + '.zip')
        if (Test-Path $zipPath) {
            Remove-Item -Path $zipPath -Force
        }

        if ($LegacyFlatZip) {
            Compress-Archive -Path (Join-Path $bundleDir '*') -DestinationPath $zipPath
        } else {
            $surfaceDir = Join-Path $tempRoot ('clarix-surface-' + [guid]::NewGuid().ToString('N'))
            Ensure-Directory -Path $surfaceDir
            foreach ($artifactPath in @(
                (Join-Path $bundleDir $setupExecutableName),
                (Join-Path $bundleDir 'README.txt'),
                (Join-Path $bundleDir $uninstallExecutableName)
            )) {
                if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
                    throw "Missing bundle artifact: $artifactPath"
                }
                Copy-Item -Path $artifactPath -Destination (Join-Path $surfaceDir (Split-Path -Path $artifactPath -Leaf)) -Force
            }
            Compress-Archive -Path (Join-Path $surfaceDir '*') -DestinationPath $zipPath
        }
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

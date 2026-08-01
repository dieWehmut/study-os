[CmdletBinding()]
param(
    [switch]$ImportOnly,
    [string]$ManifestLocation,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'StudyOS'),
    [string]$Architecture,
    [switch]$SkipShortcut,
    [switch]$DryRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-StudyOSArchitecture {
    [CmdletBinding()]
    param([string]$Architecture = $env:PROCESSOR_ARCHITECTURE)

    if ([string]::IsNullOrWhiteSpace($Architecture)) {
        $Architecture = if (-not [string]::IsNullOrWhiteSpace($env:PROCESSOR_ARCHITEW6432)) {
            $env:PROCESSOR_ARCHITEW6432
        } else {
            $env:PROCESSOR_ARCHITECTURE
        }
    }
    switch ($Architecture.ToUpperInvariant()) {
        'AMD64' { return 'x64' }
        'X64' { return 'x64' }
        'ARM64' { return 'arm64' }
        default { throw "Unsupported Study OS architecture '$Architecture'. Expected AMD64/x64 or ARM64." }
    }
}

function Assert-StudyOSChecksum {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expected
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Release archive does not exist: $Path"
    }
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $Expected.Trim().ToLowerInvariant()) {
        throw "SHA-256 mismatch for '$Path'. Expected $Expected, got $actual."
    }
    return $actual
}

function Get-StudyOSManifest {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Location)

    if ($Location -match '^http://') {
        throw 'Release manifests must use HTTPS.'
    }
    $json = if ($Location -match '^https://') {
        (Invoke-WebRequest -UseBasicParsing -Uri $Location).Content
    } else {
        if (-not (Test-Path -LiteralPath $Location -PathType Leaf)) {
            throw "Release manifest does not exist: $Location"
        }
        Get-Content -Raw -LiteralPath $Location
    }
    try {
        return ($json | ConvertFrom-Json)
    } catch {
        throw "Release manifest is not valid JSON: $Location. $($_.Exception.Message)"
    }
}

function Resolve-StudyOSAssetLocation {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ManifestLocation,
        [Parameter(Mandatory = $true)][string]$AssetLocation
    )

    if ($AssetLocation -match '^http://') {
        throw 'Release assets must use HTTPS.'
    }
    if ($ManifestLocation -match '^https://' -and ($AssetLocation -match '^file://' -or [IO.Path]::IsPathRooted($AssetLocation))) {
        throw 'Remote release manifests must use HTTPS asset URLs.'
    }
    if ($AssetLocation -match '^file://') {
        return $AssetLocation
    }
    if ($AssetLocation -match '^https://') {
        return $AssetLocation
    }
    if ([IO.Path]::IsPathRooted($AssetLocation)) {
        if ($ManifestLocation -match '^https://') {
            throw 'Remote release manifests must use HTTPS asset URLs.'
        }
        return $AssetLocation
    }
    if ($ManifestLocation -match '^http://') {
        throw 'Release manifests must use HTTPS.'
    }
    if ($ManifestLocation -match '^https://') {
        return ([Uri]::new([Uri]$ManifestLocation, $AssetLocation)).AbsoluteUri
    }
    $manifestPath = ConvertTo-StudyOSLocalPath $ManifestLocation
    return [IO.Path]::GetFullPath((Join-Path (Split-Path -Parent $manifestPath) $AssetLocation))
}

function Get-StudyOSAsset {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Manifest,
        [Parameter(Mandatory = $true)][string]$Architecture
    )

    $assets = @($Manifest.assets | Where-Object { $_.os -eq 'windows' -and $_.arch -eq $Architecture })
    if ($assets.Count -ne 1) {
        throw "Manifest must contain exactly one Windows/$Architecture asset; found $($assets.Count)."
    }
    foreach ($field in @('url', 'sha256', 'entrypoint')) {
        if ([string]::IsNullOrWhiteSpace([string]$assets[0].$field)) {
            throw "Manifest asset is missing '$field'."
        }
    }
    return $assets[0]
}

function ConvertTo-StudyOSLocalPath {
    param([Parameter(Mandatory = $true)][string]$Location)

    if ($Location -match '^file://') {
        return ([Uri]$Location).LocalPath
    }
    return $Location
}

function Save-StudyOSArchive {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Location,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    if ($Location -match '^https?://') {
        Invoke-WebRequest -UseBasicParsing -Uri $Location -OutFile $Destination
    } else {
        $source = ConvertTo-StudyOSLocalPath $Location
        if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
            throw "Release archive does not exist: $source"
        }
        Copy-Item -LiteralPath $source -Destination $Destination -Force
    }
}

function Assert-StudyOSSafeArchive {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ArchivePath)

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName -replace '\\', '/'
            if ([IO.Path]::IsPathRooted($name) -or $name -match '(^|/)\.\.(/|$)' -or $name -match '^[A-Za-z]:') {
                throw "Release archive contains an unsafe path: $($entry.FullName)"
            }
        }
    } finally {
        $archive.Dispose()
    }
}

function Expand-StudyOSArchiveSafe {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    Assert-StudyOSSafeArchive -ArchivePath $ArchivePath
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $Destination -Force
}

function Resolve-StudyOSArchiveEntryPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$EntryPoint
    )

    $normalized = $EntryPoint -replace '\\', '/'
    if ([string]::IsNullOrWhiteSpace($normalized) -or [IO.Path]::IsPathRooted($normalized) -or $normalized -match '^[A-Za-z]:') {
        throw "Release entrypoint is unsafe: $EntryPoint"
    }
    $segments = $normalized -split '/'
    if ($segments | Where-Object { $_ -eq '..' -or $_ -eq '' -or $_ -eq '.' }) {
        throw "Release entrypoint is unsafe: $EntryPoint"
    }
    $rootPath = [IO.Path]::GetFullPath($Root)
    $entryPath = [IO.Path]::GetFullPath((Join-Path $rootPath ($normalized -replace '/', [IO.Path]::DirectorySeparatorChar)))
    $rootPrefix = $rootPath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $entryPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Release entrypoint escapes staging directory: $EntryPoint"
    }
    return $entryPath
}

function Get-StudyOSCurrentFile {
    param([Parameter(Mandatory = $true)][string]$InstallRoot)
    return (Join-Path $InstallRoot 'current.json')
}

function Get-StudyOSCurrentVersion {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    $path = Get-StudyOSCurrentFile $InstallRoot
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return $null
    }
    try {
        $value = Get-Content -Raw -LiteralPath $path | ConvertFrom-Json
    } catch {
        throw "Study OS current pointer is invalid: $path"
    }
    if ([string]::IsNullOrWhiteSpace([string]$value.version) -or [string]::IsNullOrWhiteSpace([string]$value.path)) {
        throw "Study OS current pointer is incomplete: $path"
    }
    $root = [IO.Path]::GetFullPath($InstallRoot).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $versionPath = [IO.Path]::GetFullPath([string]$value.path)
    if (-not $versionPath.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Study OS current pointer escapes install root: $path"
    }
    if ([string]::IsNullOrWhiteSpace([string]$value.entrypoint)) {
        $value.entrypoint = 'StudyOS.exe'
    }
    $null = Resolve-StudyOSArchiveEntryPath -Root $versionPath -EntryPoint ([string]$value.entrypoint)
    return $value
}

function Set-StudyOSCurrentVersion {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$VersionPath,
        [Parameter(Mandatory = $true)][string]$Entrypoint
    )

    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    $pointer = [ordered]@{
        version = $Version
        path = [IO.Path]::GetFullPath($VersionPath)
        entrypoint = $Entrypoint
        updated_at = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json
    $target = Get-StudyOSCurrentFile $InstallRoot
    $temporary = "$target.$([Guid]::NewGuid().ToString('N')).tmp"
    Set-Content -LiteralPath $temporary -Value $pointer -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $target -Force
    return (Get-StudyOSCurrentVersion $InstallRoot)
}

function Get-StudyOSShortcutTarget {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$InstallRoot)
    return (Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'StudyOS.cmd')
}

function New-StudyOSLauncher {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    $root = [IO.Path]::GetFullPath($InstallRoot)
    $currentFile = (Get-StudyOSCurrentFile $root).Replace("'", "''")
    $rootLiteral = $root.Replace("'", "''")
    $launcher = Get-StudyOSShortcutTarget $root
    $scriptPath = Join-Path $root 'StudyOS.ps1'
    $scriptContent = @"
`$ErrorActionPreference = 'Stop'
`$pointer = Get-Content -Raw -LiteralPath '$currentFile' | ConvertFrom-Json
if ([string]::IsNullOrWhiteSpace([string]`$pointer.path)) { throw 'Study OS current pointer has no version path.' }
`$root = [IO.Path]::GetFullPath('$rootLiteral')
`$versionPath = [IO.Path]::GetFullPath([string]`$pointer.path)
`$rootPrefix = `$root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if (-not `$versionPath.StartsWith(`$rootPrefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Study OS current pointer escapes install root.' }
`$entrypoint = if ([string]::IsNullOrWhiteSpace([string]`$pointer.entrypoint)) { 'StudyOS.exe' } else { [string]`$pointer.entrypoint }
`$segments = (`$entrypoint -replace '\\', '/') -split '/'
if (`$segments | Where-Object { `$_ -eq '..' -or `$_ -eq '' -or `$_ -eq '.' }) { throw 'Study OS current pointer entrypoint is unsafe.' }
`$executable = Join-Path `$versionPath `$entrypoint
if (-not (Test-Path -LiteralPath `$executable -PathType Leaf)) { throw "Study OS executable is missing: `$executable" }
& `$executable @args
exit `$LASTEXITCODE
"@
    Set-Content -LiteralPath $scriptPath -Value $scriptContent -Encoding UTF8
    $content = "@echo off`r`npowershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$scriptPath`" %*`r`nexit /b %ERRORLEVEL%`r`n"
    Set-Content -LiteralPath $launcher -Value $content -Encoding ASCII
    return $launcher
}

function New-StudyOSDesktopShortcut {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    $target = Get-StudyOSShortcutTarget $InstallRoot
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop 'Study OS.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = [IO.Path]::GetFullPath($InstallRoot)
    $shortcut.Description = 'Study OS local learning workspace'
    $shortcut.Save()
    return $shortcutPath
}

function New-StudyOSPreUpdateBackup {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

    $dataPath = Join-Path $InstallRoot 'data'
    if (-not (Test-Path -LiteralPath $dataPath -PathType Container)) {
        return $null
    }
    $backupDir = Join-Path $InstallRoot 'backups\pre-update'
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $backupPath = Join-Path $backupDir "study-os-$stamp.zip"
    Compress-Archive -LiteralPath $dataPath -DestinationPath $backupPath -Force
    $checksum = (Get-FileHash -LiteralPath $backupPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$backupPath.sha256" -Value $checksum -Encoding ASCII
    $archives = @(Get-ChildItem -LiteralPath $backupDir -Filter '*.zip' -File | Sort-Object @{ Expression = 'LastWriteTime'; Descending = $true }, @{ Expression = 'Name'; Descending = $true })
    foreach ($expired in $archives | Select-Object -Skip 5) {
        Remove-Item -LiteralPath $expired.FullName -Force
        Remove-Item -LiteralPath "$($expired.FullName).sha256" -Force -ErrorAction SilentlyContinue
    }
    return $backupPath
}

function Test-StudyOSPreUpdateBackup {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ArchivePath)

    if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
        throw "Pre-update backup does not exist: $ArchivePath"
    }
    $checksumPath = "$ArchivePath.sha256"
    if (-not (Test-Path -LiteralPath $checksumPath -PathType Leaf)) {
        throw "Pre-update backup checksum is missing: $checksumPath"
    }
    $expected = (Get-Content -Raw -LiteralPath $checksumPath).Trim()
    if ($expected -notmatch '^[0-9a-fA-F]{64}$') {
        throw "Pre-update backup checksum is invalid: $checksumPath"
    }
    Assert-StudyOSChecksum -Path $ArchivePath -Expected $expected | Out-Null
    Assert-StudyOSSafeArchive -ArchivePath $ArchivePath
    return $true
}

function Restore-StudyOSPreUpdateBackup {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$InstallRoot
    )

    Test-StudyOSPreUpdateBackup -ArchivePath $ArchivePath | Out-Null
    $root = [IO.Path]::GetFullPath($InstallRoot)
    $parent = Split-Path -Parent $root
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    $staging = Join-Path $parent (".study-os-restore-$([Guid]::NewGuid().ToString('N'))")
    $oldData = Join-Path $parent (".study-os-data-old-$([Guid]::NewGuid().ToString('N'))")
    try {
        Expand-StudyOSArchiveSafe -ArchivePath $ArchivePath -Destination $staging
        $restoredData = Join-Path $staging 'data'
        if (-not (Test-Path -LiteralPath $restoredData -PathType Container)) {
            throw 'Pre-update backup does not contain a data directory.'
        }
        $currentData = Join-Path $root 'data'
        if (Test-Path -LiteralPath $currentData) {
            Move-Item -LiteralPath $currentData -Destination $oldData
        }
        try {
            New-Item -ItemType Directory -Path $root -Force | Out-Null
            Move-Item -LiteralPath $restoredData -Destination $currentData
        } catch {
            if (Test-Path -LiteralPath $currentData) { Remove-Item -LiteralPath $currentData -Recurse -Force }
            if (Test-Path -LiteralPath $oldData) { Move-Item -LiteralPath $oldData -Destination $currentData }
            throw
        }
        if (Test-Path -LiteralPath $oldData) {
            Remove-Item -LiteralPath $oldData -Recurse -Force
        }
        return $currentData
    } finally {
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $oldData) {
            Remove-Item -LiteralPath $oldData -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Set-StudyOSUpdateChannel {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$ManifestLocation,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][string]$Architecture
    )

    $channel = [ordered]@{
        manifest_url = $ManifestLocation
        version = $Version
        architecture = $Architecture
        updated_at = [DateTime]::UtcNow.ToString('o')
    } | ConvertTo-Json
    $path = Join-Path ([IO.Path]::GetFullPath($InstallRoot)) 'channel.json'
    $temporary = "$path.$([Guid]::NewGuid().ToString('N')).tmp"
    Set-Content -LiteralPath $temporary -Value $channel -Encoding UTF8
    Move-Item -LiteralPath $temporary -Destination $path -Force
    return $path
}

function Enter-StudyOSInstallLock {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$InstallRoot)

	$root = [IO.Path]::GetFullPath($InstallRoot)
	New-Item -ItemType Directory -Path $root -Force | Out-Null
	$lockPath = Join-Path $root '.install.lock'
	if (Test-Path -LiteralPath $lockPath -PathType Leaf) {
		$marker = $null
		try {
			$marker = Get-Content -Raw -LiteralPath $lockPath | ConvertFrom-Json
		} catch {
			throw "Study OS install lock marker is invalid: $lockPath"
		}
		$markerPid = 0
		[void][int]::TryParse([string]$marker.pid, [ref]$markerPid)
		$active = $false
		if ($markerPid -gt 0) {
			$active = $null -ne (Get-Process -Id $markerPid -ErrorAction SilentlyContinue)
		}
		if ($active) {
			throw "Another Study OS installation is already running for '$root'."
		}
		Remove-Item -LiteralPath $lockPath -Force
	}
	$bytes = [Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())
    $hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
    $suffix = ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    $mutexName = "Local\StudyOS.Install.$suffix"
    $created = $false
    $mutex = New-Object Threading.Mutex($false, $mutexName, [ref]$created)
    try {
        try {
            $acquired = $mutex.WaitOne(0)
        } catch [Threading.AbandonedMutexException] {
            $acquired = $true
        }
		if (-not $acquired) {
			throw "Another Study OS installation is already running for '$root'."
		}
		# The named mutex is authoritative; a marker can survive a crashed process.
		Set-Content -LiteralPath $lockPath -Value ([ordered]@{ pid = $PID; started_at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json) -Encoding UTF8
        return [pscustomobject]@{ Mutex = $mutex; Path = $lockPath }
    } catch {
        $mutex.Dispose()
        throw
    }
}

function Exit-StudyOSInstallLock {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]$Lock,
        [Parameter(Mandatory = $true)][string]$InstallRoot
    )

    if ($Lock.Path -and (Test-Path -LiteralPath $Lock.Path -PathType Leaf)) {
        Remove-Item -LiteralPath $Lock.Path -Force -ErrorAction SilentlyContinue
    }
    try { $Lock.Mutex.ReleaseMutex() } catch [Threading.AbandonedMutexException] { }
    $Lock.Mutex.Dispose()
}

function Install-StudyOSRelease {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$ManifestLocation,
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [string]$Architecture = $env:PROCESSOR_ARCHITECTURE,
        [switch]$SkipShortcut,
        [scriptblock]$HealthCheck = { $true },
        [switch]$DryRun
    )

    $resolvedArchitecture = Get-StudyOSArchitecture $Architecture
    $manifest = Get-StudyOSManifest $ManifestLocation
    $asset = Get-StudyOSAsset $manifest $resolvedArchitecture
    $version = [string]$manifest.version
    if ($version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
        throw "Manifest version is unsafe: $version"
    }
    $root = [IO.Path]::GetFullPath($InstallRoot)
    $versionPath = Join-Path $root "versions\$version"
    if ($DryRun) {
        return [pscustomobject]@{ Version = $version; Architecture = $resolvedArchitecture; VersionPath = $versionPath; DryRun = $true }
    }

    $installLock = Enter-StudyOSInstallLock -InstallRoot $root
    $staging = $null
    try {
    New-Item -ItemType Directory -Path (Join-Path $root 'downloads') -Force | Out-Null
    $assetLocation = Resolve-StudyOSAssetLocation -ManifestLocation $ManifestLocation -AssetLocation ([string]$asset.url)
    if ($assetLocation -match '^https?://') {
        $archiveName = [IO.Path]::GetFileName(([Uri]$assetLocation).AbsolutePath)
    } else {
        $archiveName = [IO.Path]::GetFileName((ConvertTo-StudyOSLocalPath $assetLocation))
    }
    if ([string]::IsNullOrWhiteSpace($archiveName)) {
        $archiveName = 'release.zip'
    }
    $archivePath = Join-Path (Join-Path $root 'downloads') $archiveName
    Save-StudyOSArchive -Location $assetLocation -Destination $archivePath
    Assert-StudyOSChecksum -Path $archivePath -Expected ([string]$asset.sha256) | Out-Null

    $staging = Join-Path $root (".staging\$version-$([Guid]::NewGuid().ToString('N'))")
    try {
        Expand-StudyOSArchiveSafe -ArchivePath $archivePath -Destination $staging
        $entrypointPath = Resolve-StudyOSArchiveEntryPath -Root $staging -EntryPoint ([string]$asset.entrypoint)
        if (-not (Test-Path -LiteralPath $entrypointPath -PathType Leaf)) {
            throw "Release entrypoint is missing from archive: $($asset.entrypoint)"
        }
        $previous = Get-StudyOSCurrentVersion $root
        $backupPath = New-StudyOSPreUpdateBackup $root
        New-Item -ItemType Directory -Path (Split-Path -Parent $versionPath) -Force | Out-Null
        $replacedVersionPath = $null
        if (Test-Path -LiteralPath $versionPath -PathType Container) {
            $replacedVersionPath = "$versionPath.rollback-$([Guid]::NewGuid().ToString('N'))"
            Move-Item -LiteralPath $versionPath -Destination $replacedVersionPath
        }
        Move-Item -LiteralPath $staging -Destination $versionPath
        try {
            $current = Set-StudyOSCurrentVersion -InstallRoot $root -Version $version -VersionPath $versionPath -Entrypoint ([string]$asset.entrypoint)
            $null = New-StudyOSLauncher -InstallRoot $root
            $channelPath = Set-StudyOSUpdateChannel -InstallRoot $root -ManifestLocation $ManifestLocation -Version $version -Architecture $resolvedArchitecture
            if (-not $SkipShortcut) {
                $shortcutPath = New-StudyOSDesktopShortcut -InstallRoot $root
            } else {
                $shortcutPath = $null
            }
            if (-not (& $HealthCheck)) {
                throw "Study OS health check failed for version $version."
            }
            if ($replacedVersionPath -and (Test-Path -LiteralPath $replacedVersionPath)) {
                Remove-Item -LiteralPath $replacedVersionPath -Recurse -Force
            }
        } catch {
            if (Test-Path -LiteralPath $versionPath) {
                Remove-Item -LiteralPath $versionPath -Recurse -Force -ErrorAction SilentlyContinue
            }
            if ($replacedVersionPath -and (Test-Path -LiteralPath $replacedVersionPath)) {
                Move-Item -LiteralPath $replacedVersionPath -Destination $versionPath -Force
            }
            if ($previous) {
                Set-StudyOSCurrentVersion -InstallRoot $root -Version $previous.version -VersionPath $previous.path -Entrypoint $previous.entrypoint | Out-Null
            } else {
                Remove-Item -LiteralPath (Get-StudyOSCurrentFile $root) -Force -ErrorAction SilentlyContinue
            }
            throw
        }
        return [pscustomobject]@{
            Version = $version
            Architecture = $resolvedArchitecture
            VersionPath = $versionPath
            ArchivePath = $archivePath
            BackupPath = $backupPath
            ChannelPath = $channelPath
            ShortcutPath = $shortcutPath
            Current = $current
        }
    } finally {
        if (Test-Path -LiteralPath $staging) {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
    } finally {
        Exit-StudyOSInstallLock -Lock $installLock -InstallRoot $root
    }
}

if (-not $ImportOnly) {
    if ([string]::IsNullOrWhiteSpace($ManifestLocation)) {
        throw 'ManifestLocation is required when running install.ps1. Use -ImportOnly when dot-sourcing helpers.'
    }
    Install-StudyOSRelease -ManifestLocation $ManifestLocation -InstallRoot $InstallRoot -Architecture $Architecture -SkipShortcut:$SkipShortcut -DryRun:$DryRun
}

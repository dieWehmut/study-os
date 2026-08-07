[CmdletBinding()]
param(
    [string]$Folder = (Join-Path $env:USERPROFILE 'Desktop\学习系统'),
    [string]$Repo = 'dieWehmut/study-os',
    [string]$Version = '',
    [string]$AssetUrl = '',
    [string]$ShaUrl = '',
    [switch]$SkipShortcut,
    [switch]$ImportOnly
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# Keep this file UTF-8 *without* a BOM. It is meant to be run as
# `irm <raw url> | iex`, and Invoke-RestMethod leaves the BOM in the returned
# string, so `iex` then chokes on U+FEFF glued to the first command. The Chinese
# text below still decodes correctly over HTTP because GitHub raw serves this
# file as text/plain; charset=utf-8.
#
# The helpers are duplicated from install.ps1 rather than dot-sourced, because
# the whole point of the one-liner is that nothing is on disk yet when it runs.
# `-ImportOnly` lets the Pester suite load them without installing anything,
# which is the same convention install.ps1 uses.

$archiveName = 'study-os-pwa-windows-x64.zip'
$serverName = 'study-os-server.exe'

function Enable-StudyOSPwaTls {
    # Windows PowerShell 5.1 still offers SSL3/TLS1.0 first on some machines and
    # GitHub refuses those, so the download dies with a bare "connection closed"
    # before the checksum can report anything useful.
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
}

function Assert-StudyOSPwaHttps {
    [CmdletBinding()]
    param(
        [AllowEmptyString()][string]$Url,
        [string]$What = '下载地址'
    )

    $uri = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$uri) -or $uri.Scheme -ne 'https') {
        throw "$What 必须是 https 地址：$Url"
    }
    return $uri.AbsoluteUri
}

function Get-StudyOSPwaRelease {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Repo)

    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ 'User-Agent' = 'study-os' } -TimeoutSec 20
    $asset = $release.assets | Where-Object { $_.name -eq $archiveName } | Select-Object -First 1
    if (-not $asset) {
        throw "最新发布（$($release.tag_name)）中没有找到 $archiveName"
    }
    return @{
        Version = $release.tag_name.TrimStart('v')
        Url = $asset.browser_download_url
    }
}

function Assert-StudyOSPwaChecksum {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Expected
    )

    $want = $Expected.Trim().Split(' ')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($want -ne $actual) {
        throw '安装包校验失败，已停止安装'
    }
}

function Assert-StudyOSPwaSafeArchive {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ArchivePath)

    # A release archive is signed by nothing but its sha256 sidecar, and that
    # sidecar lives next to the archive on the same host. If either is ever
    # replaced, `Expand-Archive` would happily write outside the install folder.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        foreach ($entry in $archive.Entries) {
            $name = $entry.FullName -replace '\\', '/'
            if ([IO.Path]::IsPathRooted($name) -or $name -match '(^|/)\.\.(/|$)' -or $name -match '^[A-Za-z]:') {
                throw "安装包含有越界路径，已停止安装：$($entry.FullName)"
            }
        }
    } finally {
        $archive.Dispose()
    }
}
function Backup-StudyOSPwaData {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Folder)

    # Reinstalling on top of an existing folder is the normal upgrade path for the
    # one-liner, so the learner's database has to survive it. Expand-Archive -Force
    # only overwrites colliding names, but a bad archive or a half-finished
    # download would still leave the folder unusable, so keep a copy aside.
    $data = Join-Path $Folder 'data'
    if (-not (Test-Path -LiteralPath $data -PathType Container)) {
        return ''
    }
    $backupRoot = Join-Path $Folder 'backups\pre-install'
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    # Millisecond UTC stamp, matching install.ps1: a second-resolution name
    # collides when an install is retried immediately and -Force would then
    # overwrite the backup taken moments earlier.
    $stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')
    $archive = Join-Path $backupRoot "study-os-$stamp.zip"
    Compress-Archive -LiteralPath $data -DestinationPath $archive -Force
    $checksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$archive.sha256" -Value $checksum -Encoding ASCII
    $archives = @(Get-ChildItem -LiteralPath $backupRoot -Filter '*.zip' -File |
        Sort-Object @{ Expression = 'LastWriteTime'; Descending = $true }, @{ Expression = 'Name'; Descending = $true })
    foreach ($expired in $archives | Select-Object -Skip 5) {
        Remove-Item -LiteralPath $expired.FullName -Force
        Remove-Item -LiteralPath "$($expired.FullName).sha256" -Force -ErrorAction SilentlyContinue
    }
    return $archive
}

function Stop-StudyOSPwaServer {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$Folder)

    # A running server holds study-os-server.exe open, and Expand-Archive would
    # fail halfway through with a partially replaced install. Only processes
    # started from this folder are touched; a developer's `go run` is left alone.
    $target = [IO.Path]::GetFullPath((Join-Path $Folder $serverName))
    $running = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($serverName)) -ErrorAction SilentlyContinue |
        Where-Object {
            try { $_.Path -and [IO.Path]::GetFullPath($_.Path) -eq $target } catch { $false }
        })
    foreach ($process in $running) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    if ($running.Count -gt 0) {
        Start-Sleep -Milliseconds 400
    }
    return $running.Count
}

function New-StudyOSPwaShortcut {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Folder,
        [Parameter(Mandatory = $true)][string]$StartVbs
    )

    # The shortcut targets start.vbs through wscript so the console window never
    # flashes, and start.vbs is what waits for the launcher to publish its bound
    # port before opening the browser. Pointing the shortcut straight at the exe
    # is what used to leave learners staring at 127.0.0.1:8080.
    $ws = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shortcutPath = Join-Path $desktop '学习系统.lnk'
    $shortcut = $ws.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
    $shortcut.Arguments = '"' + $StartVbs + '"'
    $shortcut.WorkingDirectory = $Folder
    $shortcut.IconLocation = "$(Join-Path $Folder $serverName),0"
    $shortcut.Description = '学习系统（本地 PWA）'
    $shortcut.Save()
    return $shortcutPath
}

function Install-StudyOSPwa {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)][string]$Folder,
        [string]$Repo = 'dieWehmut/study-os',
        [string]$Version = '',
        [string]$AssetUrl = '',
        [string]$ShaUrl = '',
        [switch]$SkipShortcut
    )

    Enable-StudyOSPwaTls
    if ([string]::IsNullOrWhiteSpace($AssetUrl)) {
        $latest = Get-StudyOSPwaRelease -Repo $Repo
        $Version = $latest.Version
        $AssetUrl = $latest.Url
    }
    # Derived here rather than in the param block: a caller that overrides
    # -AssetUrl but not -ShaUrl used to send an empty URL to Invoke-WebRequest.
    if ([string]::IsNullOrWhiteSpace($ShaUrl)) {
        $ShaUrl = "$AssetUrl.sha256"
    }
    $AssetUrl = Assert-StudyOSPwaHttps -Url $AssetUrl -What '安装包地址'
    $ShaUrl = Assert-StudyOSPwaHttps -Url $ShaUrl -What '校验文件地址'

    New-Item -ItemType Directory -Path $Folder -Force | Out-Null
    $backup = Backup-StudyOSPwaData -Folder $Folder
    $stopped = Stop-StudyOSPwaServer -Folder $Folder

    $temp = Join-Path $env:TEMP "study-os-install-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
    New-Item -ItemType Directory -Path $temp -Force | Out-Null
    try {
        $zipPath = Join-Path $temp $archiveName
        Invoke-WebRequest -UseBasicParsing -Uri $AssetUrl -OutFile $zipPath -TimeoutSec 120
        $expected = (Invoke-WebRequest -UseBasicParsing -Uri $ShaUrl -TimeoutSec 60).Content
        Assert-StudyOSPwaChecksum -Path $zipPath -Expected $expected
        Assert-StudyOSPwaSafeArchive -ArchivePath $zipPath
        Expand-Archive -LiteralPath $zipPath -DestinationPath $Folder -Force
    } finally {
        if (Test-Path -LiteralPath $temp) {
            Remove-Item -LiteralPath $temp -Recurse -Force
        }
    }

    $startVbs = Join-Path $Folder 'start.vbs'
    if (-not (Test-Path -LiteralPath $startVbs)) {
        throw '安装包缺少 start.vbs，请重新打包'
    }
    $shortcutPath = ''
    if (-not $SkipShortcut) {
        $shortcutPath = New-StudyOSPwaShortcut -Folder $Folder -StartVbs $startVbs
    }

    return @{
        Folder = $Folder
        Version = $Version
        Shortcut = $shortcutPath
        DataBackup = $backup
        StoppedProcesses = $stopped
    }
}

if (-not $ImportOnly) {
    $result = Install-StudyOSPwa -Folder $Folder -Repo $Repo -Version $Version -AssetUrl $AssetUrl -ShaUrl $ShaUrl -SkipShortcut:$SkipShortcut
    Write-Output "安装完成：$($result.Folder)"
    if ($result.Version) {
        Write-Output "版本：$($result.Version)"
    }
    if ($result.StoppedProcesses -gt 0) {
        Write-Output "已停止正在运行的旧版本（$($result.StoppedProcesses) 个进程）"
    }
    if ($result.DataBackup) {
        Write-Output "学习数据已备份：$($result.DataBackup)"
    }
    if ($result.Shortcut) {
        Write-Output "桌面快捷方式：$($result.Shortcut)"
    }
    Write-Output '双击「学习系统」即可启动后端并打开学习界面。'
}

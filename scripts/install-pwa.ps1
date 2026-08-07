[CmdletBinding()]
param(
    [string]$Folder = (Join-Path $env:USERPROFILE 'Desktop\学习系统'),
    [string]$Repo = 'dieWehmut/study-os',
    [string]$Version = '',
    [string]$AssetUrl = '',
    [string]$ShaUrl = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# Keep this file UTF-8 *without* a BOM. It is meant to be run as
# `irm <raw url> | iex`, and Invoke-RestMethod leaves the BOM in the returned
# string, so `iex` then chokes on U+FEFF glued to the first command. The Chinese
# text below still decodes correctly over HTTP because GitHub raw serves this
# file as text/plain; charset=utf-8.

$archiveName = 'study-os-pwa-windows-x64.zip'

function Get-LatestAssetUrl {
    $apiUrl = "https://api.github.com/repos/$Repo/releases/latest"
    $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ 'User-Agent' = 'study-os' } -TimeoutSec 20
    $asset = $release.assets | Where-Object { $_.name -eq $archiveName } | Select-Object -First 1
    if (-not $asset) {
        throw "最新发布（$($release.tag_name)）中没有找到 $archiveName"
    }
    return @{
        Version = $release.tag_name.TrimStart('v')
        Url      = $asset.browser_download_url
        Notes    = $release.body
    }
}

if ([string]::IsNullOrWhiteSpace($AssetUrl)) {
    $latest = Get-LatestAssetUrl
    $Version = $latest.Version
    $AssetUrl = $latest.Url
    if ([string]::IsNullOrWhiteSpace($ShaUrl)) {
        $ShaUrl = "$AssetUrl.sha256"
    }
}

New-Item -ItemType Directory -Path $Folder -Force | Out-Null
$temp = Join-Path $env:TEMP "study-os-install-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
New-Item -ItemType Directory -Path $temp -Force | Out-Null
try {
    $zipPath = Join-Path $temp $archiveName
    $shaPath = "$zipPath.sha256"
    Invoke-WebRequest -UseBasicParsing -Uri $AssetUrl -OutFile $zipPath -TimeoutSec 120
    Invoke-WebRequest -UseBasicParsing -Uri $ShaUrl -OutFile $shaPath -TimeoutSec 60

    $expected = (Get-Content -LiteralPath $shaPath -Raw).Trim().Split(' ')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
        throw '安装包校验失败，已停止安装'
    }

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

$ws = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '学习系统.lnk'
$shortcut = $ws.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + $startVbs + '"'
$shortcut.WorkingDirectory = $Folder
$shortcut.IconLocation = "$(Join-Path $Folder 'study-os-server.exe'),0"
$shortcut.Description = '学习系统（本地 PWA）'
$shortcut.Save()

Write-Output "安装完成：$Folder"
Write-Output "版本：$Version"
Write-Output "桌面快捷方式：$shortcutPath"
Write-Output "双击「学习系统」即可启动后端并打开学习界面。"

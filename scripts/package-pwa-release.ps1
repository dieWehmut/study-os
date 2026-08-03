[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Repo = 'dieWehmut/study-os',
    [string]$OutputRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release'),
    [string]$FrontendRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'frontend'),
    [string]$BackendRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$SkipBuild
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw "Version contains unsafe characters: $Version"
}

$stage = Join-Path (Split-Path -Parent $PSScriptRoot) 'build\pwa'
New-Item -ItemType Directory -Path (Join-Path $stage 'web') -Force | Out-Null

if (-not $SkipBuild) {
    Push-Location $FrontendRoot
    try {
        pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'frontend build failed' }
    } finally {
        Pop-Location
    }
    Push-Location $BackendRoot
    try {
        go build -ldflags "-X study-os/backend/version.Version=$Version" -o (Join-Path $stage 'study-os-server.exe') ./backend
        if ($LASTEXITCODE -ne 0) { throw 'backend build failed' }
    } finally {
        Pop-Location
    }
}

Copy-Item -Path (Join-Path $FrontendRoot 'dist\*') -Destination (Join-Path $stage 'web') -Recurse -Force

$startVbs = @'
Set fso = CreateObject("Scripting.FileSystemObject")
base = fso.GetParentFolderName(WScript.ScriptFullName)
Set shell = CreateObject("WScript.Shell")
shell.Environment("PROCESS")("STUDY_OS_LAUNCHER") = "1"
Set http = CreateObject("MSXML2.XMLHTTP")
running = False
On Error Resume Next
http.open "GET", "http://127.0.0.1:8080/api/health", False
http.setTimeouts 1500, 1500, 1500, 1500
http.send
If http.status = 200 Then running = True
On Error GoTo 0
If Not running Then
  shell.Run """" & base & "\study-os-server.exe""", 0, False
  For i = 1 To 40
    WScript.Sleep 500
    On Error Resume Next
    http.open "GET", "http://127.0.0.1:8080/api/health", False
    http.setTimeouts 1500, 1500, 1500, 1500
    http.send
    On Error GoTo 0
    If http.status = 200 Then Exit For
  Next
End If
shell.Run "http://127.0.0.1:8080", 1, False
'@
Set-Content -LiteralPath (Join-Path $stage 'start.vbs') -Value $startVbs -Encoding ASCII

$archiveName = "study-os-pwa-windows-x64.zip"
$archivePath = Join-Path $OutputRoot $archiveName
New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
}
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archivePath -CompressionLevel Optimal
$sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$archivePath.sha256" -Value "$sha256  $archiveName" -Encoding ASCII

Write-Output "PWA 安装包已生成：$archivePath"
Write-Output "SHA256：$sha256"
Write-Output "发布到 GitHub Releases 后，用户可运行 scripts\install-pwa.ps1 一键安装。"

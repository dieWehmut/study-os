[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Repo = 'dieWehmut/study-os',
    [string]$OutputRoot = '',
    [string]$FrontendRoot = '',
    [string]$BackendRoot = '',
    [switch]$SkipBuild
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# $PSScriptRoot is still empty while an advanced script's parameter defaults are
# evaluated in Windows PowerShell 5.1, and [CmdletBinding()] above makes this an
# advanced script. Deriving these paths in a default value therefore fails with
# "Cannot bind argument to parameter 'Path' because it is an empty string"
# before the first line of the body runs, so they are resolved here instead.
$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputRoot)) { $OutputRoot = Join-Path $repoRoot 'release' }
if ([string]::IsNullOrWhiteSpace($FrontendRoot)) { $FrontendRoot = Join-Path $repoRoot 'frontend' }
if ([string]::IsNullOrWhiteSpace($BackendRoot)) { $BackendRoot = $repoRoot }

if ($Version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw "Version contains unsafe characters: $Version"
}

$stage = Join-Path $repoRoot 'build\pwa'
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
addressFile = base & "\data\launcher-address"
defaultAddress = "127.0.0.1:8422"

' The launcher walks upward from the preferred port when it is busy, so the
' address it actually bound is read from the file it writes. Probing GET /
' rather than /api/health matters: every study-os backend answers /api/health,
' including a development server that serves no frontend.
Function ServesApp(address)
  ServesApp = False
  If address = "" Then Exit Function
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  On Error Resume Next
  http.open "GET", "http://" & address & "/", False
  http.setTimeouts 1500, 1500, 1500, 1500
  http.send
  If Err.Number = 0 Then
    If http.status = 200 Then ServesApp = True
  End If
  On Error GoTo 0
End Function

Function ReadAddress()
  ReadAddress = ""
  If Not fso.FileExists(addressFile) Then Exit Function
  On Error Resume Next
  Set stream = fso.OpenTextFile(addressFile, 1)
  If Err.Number = 0 Then
    If Not stream.AtEndOfStream Then ReadAddress = Trim(stream.ReadAll)
    stream.Close
  End If
  On Error GoTo 0
End Function

address = ReadAddress()
If Not ServesApp(address) Then
  shell.Environment("PROCESS")("STUDY_OS_LAUNCHER") = "1"
  shell.Environment("PROCESS")("STUDY_OS_LISTEN_ADDRESS") = defaultAddress
  shell.Run """" & base & "\study-os-server.exe""", 0, False
  address = ""
  For i = 1 To 40
    WScript.Sleep 500
    candidate = ReadAddress()
    If ServesApp(candidate) Then
      address = candidate
      Exit For
    End If
  Next
End If

If address = "" Then
  MsgBox "学习系统启动失败，请重新安装或查看 data 目录下的日志。", 16, "学习系统"
Else
  shell.Run "http://" & address, 1, False
End If
'@
# Windows Script Host parses .vbs as system ANSI unless a BOM says otherwise,
# so the non-ASCII strings in start.vbs require UTF-16LE with a BOM. UTF-8 is
# rejected outright with "invalid character" at line 1 whether or not it carries
# a BOM, so Unicode (UTF-16LE) is the only encoding that works here.
$startVbsPath = Join-Path $stage 'start.vbs'
Set-Content -LiteralPath $startVbsPath -Value $startVbs -Encoding Unicode

# This file must be saved as UTF-8 with a BOM. Windows PowerShell 5.1 decodes a
# BOM-less script using the system ANSI code page, which turns every Chinese
# literal above into mojibake before it is ever written, and the generated
# start.vbs then dies with "invalid character" — the desktop icon does nothing.
# The marker is built from code points so that it stays intact even when this
# script itself was misdecoded, which is what makes the check meaningful.
$expectedMarker = -join ([char]0x5B66, [char]0x4E60, [char]0x7CFB, [char]0x7EDF)
if ((Get-Content -Raw -LiteralPath $startVbsPath) -notmatch [regex]::Escape($expectedMarker)) {
    throw "start.vbs lost its Chinese text during generation. Save $PSCommandPath as UTF-8 with BOM and re-run."
}

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

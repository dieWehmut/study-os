[CmdletBinding()]
param(
    [string]$ManifestLocation,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'StudyOS'),
    [string]$Architecture,
    [switch]$SkipShortcut,
    [switch]$DryRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$installer = Join-Path (Split-Path -Parent $PSScriptRoot) 'install.ps1'
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw "Study OS installer helpers are missing: $installer"
}
. $installer -ImportOnly

if ([string]::IsNullOrWhiteSpace($ManifestLocation)) {
    $channelFile = Join-Path $InstallRoot 'channel.json'
    if (-not (Test-Path -LiteralPath $channelFile -PathType Leaf)) {
        throw 'ManifestLocation is required because no saved update channel exists.'
    }
    $channel = Get-Content -Raw -LiteralPath $channelFile | ConvertFrom-Json
    $ManifestLocation = [string]$channel.manifest_url
    if ([string]::IsNullOrWhiteSpace($ManifestLocation)) {
        throw "Saved update channel does not contain manifest_url: $channelFile"
    }
}

Install-StudyOSRelease -ManifestLocation $ManifestLocation -InstallRoot $InstallRoot -Architecture $Architecture -SkipShortcut:$SkipShortcut -DryRun:$DryRun

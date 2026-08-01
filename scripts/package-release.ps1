[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [ValidateSet('x64', 'arm64')][string[]]$Architectures = @('x64', 'arm64'),
    [string]$InputRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'build\bin'),
    [string]$OutputRoot = (Join-Path (Split-Path -Parent $PSScriptRoot) 'release'),
    [string]$BaseUrl = '',
    [switch]$DryRun
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]*$') {
    throw "Version contains unsafe characters: $Version"
}

$assets = @()
foreach ($architecture in $Architectures) {
    $inputDir = Join-Path $InputRoot "windows-$architecture"
    $archiveName = "study-os-$Version-windows-$architecture.zip"
    $archivePath = Join-Path $OutputRoot $archiveName
    if (-not $DryRun) {
        if (-not (Test-Path -LiteralPath (Join-Path $inputDir 'StudyOS.exe') -PathType Leaf)) {
            throw "Missing packaged desktop executable: $(Join-Path $inputDir 'StudyOS.exe')"
        }
        New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
        if (Test-Path -LiteralPath $archivePath) {
            Remove-Item -LiteralPath $archivePath -Force
        }
        Compress-Archive -Path (Join-Path $inputDir '*') -DestinationPath $archivePath -CompressionLevel Optimal
        $sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -LiteralPath "$archivePath.sha256" -Value "$sha256  $archiveName" -Encoding ASCII
    } else {
        $sha256 = ('0' * 64)
    }
    $url = if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
        $archiveName
    } else {
        "$($BaseUrl.TrimEnd('/'))/$archiveName"
    }
    $assets += [ordered]@{
        os = 'windows'
        arch = $architecture
        url = $url
        sha256 = $sha256
        size = if ($DryRun) { 0 } else { (Get-Item -LiteralPath $archivePath).Length }
        entrypoint = 'StudyOS.exe'
    }
}

$manifest = [ordered]@{
    schema_version = 1
    version = $Version
    published_at = [DateTime]::UtcNow.ToString('o')
    assets = $assets
}
$manifestJson = $manifest | ConvertTo-Json -Depth 8
if (-not $DryRun) {
    Set-Content -LiteralPath (Join-Path $OutputRoot 'manifest.json') -Value $manifestJson -Encoding UTF8
}
$manifestJson

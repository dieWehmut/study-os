$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $repoRoot 'install.ps1') -ImportOnly

function New-TestReleaseFixture {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [string]$Version = '0.1.0',
        [string]$Architecture = 'x64',
        [string]$PayloadContent = 'fixture executable'
    )

    $payload = Join-Path $Root 'payload'
    New-Item -ItemType Directory -Path $payload -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $payload 'StudyOS.exe') -Value $PayloadContent -Encoding ASCII
    Set-Content -LiteralPath (Join-Path $payload 'release.json') -Value '{"fixture":true}' -Encoding ASCII

    $archive = Join-Path $Root "study-os-$Version-windows-$Architecture.zip"
    Compress-Archive -Path (Join-Path $payload '*') -DestinationPath $archive -Force
    $sha = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifestPath = Join-Path $Root 'manifest.json'
    @{
        schema_version = 1
        version = $Version
        assets = @(
            @{
                os = 'windows'
                arch = $Architecture
                url = $archive
                sha256 = $sha
                entrypoint = 'StudyOS.exe'
            }
        )
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

    return @{
        Archive = $archive
        Manifest = $manifestPath
        Sha256 = $sha
    }
}

Describe 'Study OS release installer contracts' {
    It 'selects x64 and ARM64 assets from platform architecture names' {
        (Get-StudyOSArchitecture -Architecture 'AMD64') | Should Be 'x64'
        (Get-StudyOSArchitecture -Architecture 'x64') | Should Be 'x64'
        (Get-StudyOSArchitecture -Architecture 'ARM64') | Should Be 'arm64'
    }

    It 'uses the native process architecture when the explicit value is empty' {
        $oldArchitecture = $env:PROCESSOR_ARCHITECTURE
        $oldWowArchitecture = $env:PROCESSOR_ARCHITEW6432
        try {
            $env:PROCESSOR_ARCHITECTURE = 'AMD64'
            $env:PROCESSOR_ARCHITEW6432 = 'ARM64'
            (Get-StudyOSArchitecture -Architecture '') | Should Be 'arm64'
        } finally {
            $env:PROCESSOR_ARCHITECTURE = $oldArchitecture
            $env:PROCESSOR_ARCHITEW6432 = $oldWowArchitecture
        }
    }

    It 'rejects an archive whose SHA-256 does not match the manifest' {
        $fixtureRoot = Join-Path $TestDrive 'sha'
        New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
        $fixture = New-TestReleaseFixture -Root $fixtureRoot

        { Assert-StudyOSChecksum -Path $fixture.Archive -Expected ('0' * 64) } | Should Throw
    }

    It 'rejects non-HTTPS remote manifests and assets' {
        { Get-StudyOSManifest -Location 'http://example.invalid/manifest.json' } | Should Throw
        { Resolve-StudyOSAssetLocation -ManifestLocation 'https://example.invalid/manifest.json' -AssetLocation 'http://example.invalid/release.zip' } | Should Throw
    }

    It 'does not let a remote manifest select a local asset path' {
        { Resolve-StudyOSAssetLocation -ManifestLocation 'https://example.invalid/manifest.json' -AssetLocation 'file:///C:/secret.zip' } | Should Throw
        { Resolve-StudyOSAssetLocation -ManifestLocation 'https://example.invalid/manifest.json' -AssetLocation 'C:\secret.zip' } | Should Throw
    }

    It 'preserves a file URI selected by a local manifest' {
        $asset = 'file:///C:/fixtures/study-os.zip'
        (Resolve-StudyOSAssetLocation -ManifestLocation 'C:\fixtures\manifest.json' -AssetLocation $asset) | Should Be $asset
    }

    It 'serializes concurrent installs with an install lock' {
        $installRoot = Join-Path $TestDrive 'install-lock'
        $lock = Enter-StudyOSInstallLock -InstallRoot $installRoot
        try {
            { Enter-StudyOSInstallLock -InstallRoot $installRoot } | Should Throw
        } finally {
            Exit-StudyOSInstallLock -Lock $lock -InstallRoot $installRoot
        }
        (Test-Path -LiteralPath (Join-Path $installRoot '.install.lock')) | Should Be $false
    }

    It 'reclaims a stale lock marker after acquiring the named mutex' {
        $installRoot = Join-Path $TestDrive 'stale-install-lock'
        New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $installRoot '.install.lock') -Value '{"pid":999999,"started_at":"2020-01-01T00:00:00Z"}' -Encoding UTF8

        $lock = Enter-StudyOSInstallLock -InstallRoot $installRoot
        try {
            (Test-Path -LiteralPath (Join-Path $installRoot '.install.lock') -PathType Leaf) | Should Be $true
        } finally {
            Exit-StudyOSInstallLock -Lock $lock -InstallRoot $installRoot
        }
    }

    It 'rejects an entrypoint that escapes the staged version directory' {
        $fixtureRoot = Join-Path $TestDrive 'unsafe-entrypoint'
        New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
        $fixture = New-TestReleaseFixture -Root $fixtureRoot
        $manifest = Get-Content -Raw -LiteralPath $fixture.Manifest | ConvertFrom-Json
        $manifest.assets[0].entrypoint = '..\outside.exe'
        $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $fixture.Manifest -Encoding UTF8

        { Install-StudyOSRelease -ManifestLocation $fixture.Manifest -InstallRoot (Join-Path $fixtureRoot 'install') -Architecture x64 -SkipShortcut -HealthCheck { $true } } | Should Throw
    }

    It 'preserves the external data directory while installing a version' {
        $fixtureRoot = Join-Path $TestDrive 'preserve'
        $installRoot = Join-Path $fixtureRoot 'install'
        New-Item -ItemType Directory -Path (Join-Path $installRoot 'data') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $installRoot 'data\learner.txt') -Value 'keep me' -Encoding UTF8
        $fixture = New-TestReleaseFixture -Root (Join-Path $fixtureRoot 'release')

        $result = Install-StudyOSRelease -ManifestLocation $fixture.Manifest -InstallRoot $installRoot -Architecture x64 -SkipShortcut -HealthCheck { $true }

        (Get-Content -Raw -LiteralPath (Join-Path $installRoot 'data\learner.txt')).Trim() | Should Be 'keep me'
        $result.Version | Should Be '0.1.0'
        (Test-Path -LiteralPath (Join-Path $installRoot 'versions\0.1.0\StudyOS.exe')) | Should Be $true
        (Get-Content -Raw -LiteralPath (Join-Path $installRoot 'channel.json') | ConvertFrom-Json).manifest_url | Should Be $fixture.Manifest
    }

    It 'resolves a relative archive URL next to a local manifest' {
        $fixtureRoot = Join-Path $TestDrive 'relative-url'
        $installRoot = Join-Path $fixtureRoot 'install'
        $fixture = New-TestReleaseFixture -Root (Join-Path $fixtureRoot 'release')
        $manifest = Get-Content -Raw -LiteralPath $fixture.Manifest | ConvertFrom-Json
        $manifest.assets[0].url = [IO.Path]::GetFileName($fixture.Archive)
        $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $fixture.Manifest -Encoding UTF8

        $result = Install-StudyOSRelease -ManifestLocation $fixture.Manifest -InstallRoot $installRoot -Architecture x64 -SkipShortcut -HealthCheck { $true }

        $result.Version | Should Be '0.1.0'
        (Test-Path -LiteralPath (Join-Path $installRoot 'versions\0.1.0\StudyOS.exe')) | Should Be $true
    }

    It 'creates a pre-update backup before switching the current pointer' {
        $fixtureRoot = Join-Path $TestDrive 'backup'
        $installRoot = Join-Path $fixtureRoot 'install'
        New-Item -ItemType Directory -Path (Join-Path $installRoot 'data') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $installRoot 'data\study.db') -Value 'database fixture' -Encoding UTF8
        Set-StudyOSCurrentVersion -InstallRoot $installRoot -Version '0.0.9' -VersionPath (Join-Path $installRoot 'versions\0.0.9') -Entrypoint 'StudyOS.exe'
        $fixture = New-TestReleaseFixture -Root (Join-Path $fixtureRoot 'release')

        $result = Install-StudyOSRelease -ManifestLocation $fixture.Manifest -InstallRoot $installRoot -Architecture x64 -SkipShortcut -HealthCheck { $true }

        $result.BackupPath | Should Not BeNullOrEmpty
        (Test-Path -LiteralPath $result.BackupPath) | Should Be $true
        $backupEntries = @(Get-ChildItem -LiteralPath (Join-Path $installRoot 'backups\pre-update') -Filter '*.zip')
        $backupEntries.Count | Should Be 1
    }

    It 'uses the stable launcher as the desktop shortcut target' {
        $installRoot = Join-Path $TestDrive 'shortcut'
        (Get-StudyOSShortcutTarget -InstallRoot $installRoot) | Should Be (Join-Path $installRoot 'StudyOS.cmd')
    }

    It 'generates a launcher that reads the stable current pointer' {
        $installRoot = Join-Path $TestDrive 'launcher'
        New-Item -ItemType Directory -Path $installRoot -Force | Out-Null

        $launcher = New-StudyOSLauncher -InstallRoot $installRoot
        $cmdContent = Get-Content -Raw -LiteralPath $launcher
        $psLauncher = Join-Path $installRoot 'StudyOS.ps1'
        $psContent = Get-Content -Raw -LiteralPath $psLauncher

        $cmdContent | Should Match 'StudyOS\.ps1'
        $psContent | Should Match 'current\.json'
        $psContent | Should Match 'Join-Path'
        $psContent | Should Match '@args'
    }

    It 'launcher refuses a current pointer outside the install root' {
        $fixtureRoot = Join-Path $TestDrive 'unsafe-launcher-pointer'
        $installRoot = Join-Path $fixtureRoot 'install'
        $outsideRoot = Join-Path $fixtureRoot 'outside'
        New-Item -ItemType Directory -Path $outsideRoot -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $outsideRoot 'StudyOS.exe') -Value 'outside executable' -Encoding ASCII
        New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
        New-StudyOSLauncher -InstallRoot $installRoot | Out-Null
        Set-Content -LiteralPath (Join-Path $installRoot 'current.json') -Value (@{
            version = '0.1.0'
            path = $outsideRoot
            entrypoint = 'StudyOS.exe'
        } | ConvertTo-Json) -Encoding UTF8

        $run = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $installRoot 'StudyOS.ps1')) -Wait -PassThru -WindowStyle Hidden
        $run.ExitCode | Should Not Be 0
    }

    It 'launcher supports an install root containing an apostrophe' {
        $installRoot = Join-Path $TestDrive "learner's-study-os"
        $versionPath = Join-Path $installRoot 'versions\0.1.0'
        New-Item -ItemType Directory -Path $versionPath -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $versionPath 'fixture.ps1') -Value 'exit 0' -Encoding ASCII
        Set-StudyOSCurrentVersion -InstallRoot $installRoot -Version '0.1.0' -VersionPath $versionPath -Entrypoint 'fixture.ps1' | Out-Null
        New-StudyOSLauncher -InstallRoot $installRoot | Out-Null

        $run = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $installRoot 'StudyOS.ps1')) -Wait -PassThru -WindowStyle Hidden
        $run.ExitCode | Should Be 0
    }

    It 'rejects a current pointer whose version path escapes the install root' {
        $installRoot = Join-Path $TestDrive 'unsafe-pointer'
        New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $installRoot 'current.json') -Value (@{
            version = '0.1.0'
            path = (Join-Path $installRoot '..\outside')
            entrypoint = 'StudyOS.exe'
        } | ConvertTo-Json) -Encoding UTF8

        { Get-StudyOSCurrentVersion -InstallRoot $installRoot } | Should Throw
    }

    It 'rejects a current pointer with a traversal entrypoint' {
        $installRoot = Join-Path $TestDrive 'unsafe-entrypoint-pointer'
        $versionPath = Join-Path $installRoot 'versions\0.1.0'
        New-Item -ItemType Directory -Path $versionPath -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $installRoot 'current.json') -Value (@{
            version = '0.1.0'
            path = $versionPath
            entrypoint = '..\StudyOS.exe'
        } | ConvertTo-Json) -Encoding UTF8

        { Get-StudyOSCurrentVersion -InstallRoot $installRoot } | Should Throw
    }

    It 'selects the requested architecture during an installer dry run' {
        $fixtureRoot = Join-Path $TestDrive 'dry-run'
        New-Item -ItemType Directory -Path $fixtureRoot -Force | Out-Null
        $fixture = New-TestReleaseFixture -Root $fixtureRoot -Architecture arm64

        $result = Install-StudyOSRelease -ManifestLocation $fixture.Manifest -InstallRoot (Join-Path $fixtureRoot 'install') -Architecture ARM64 -SkipShortcut -DryRun

        $result.Architecture | Should Be 'arm64'
        (Test-Path -LiteralPath (Join-Path $fixtureRoot 'install')) | Should Be $false
    }

    It 'rolls the current pointer back when the new version fails its health check' {
        $fixtureRoot = Join-Path $TestDrive 'rollback'
        $installRoot = Join-Path $fixtureRoot 'install'
        $oldPath = Join-Path $installRoot 'versions\0.0.9'
        New-Item -ItemType Directory -Path $oldPath -Force | Out-Null
        Set-StudyOSCurrentVersion -InstallRoot $installRoot -Version '0.0.9' -VersionPath $oldPath -Entrypoint 'StudyOS.exe'
        $fixture = New-TestReleaseFixture -Root (Join-Path $fixtureRoot 'release')

        { Install-StudyOSRelease -ManifestLocation $fixture.Manifest -InstallRoot $installRoot -Architecture x64 -SkipShortcut -HealthCheck { $false } } | Should Throw

        $current = Get-StudyOSCurrentVersion -InstallRoot $installRoot
        $current.version | Should Be '0.0.9'
        $current.path | Should Be $oldPath
    }

    It 'restores the previous files when reinstalling the same version fails its health check' {
        $fixtureRoot = Join-Path $TestDrive 'same-version-rollback'
        $installRoot = Join-Path $fixtureRoot 'install'
        $oldPath = Join-Path $installRoot 'versions\0.1.0'
        New-Item -ItemType Directory -Path $oldPath -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $oldPath 'StudyOS.exe') -Value 'previous executable' -Encoding ASCII
        Set-StudyOSCurrentVersion -InstallRoot $installRoot -Version '0.1.0' -VersionPath $oldPath -Entrypoint 'StudyOS.exe'
        $fixture = New-TestReleaseFixture -Root (Join-Path $fixtureRoot 'release') -Version '0.1.0' -PayloadContent 'replacement executable'

        { Install-StudyOSRelease -ManifestLocation $fixture.Manifest -InstallRoot $installRoot -Architecture x64 -SkipShortcut -HealthCheck { $false } } | Should Throw

        (Get-Content -Raw -LiteralPath (Join-Path $oldPath 'StudyOS.exe')).Trim() | Should Be 'previous executable'
        (Get-StudyOSCurrentVersion -InstallRoot $installRoot).path | Should Be $oldPath
    }

    It 'restores and verifies a pre-update data archive' {
        $installRoot = Join-Path $TestDrive 'restore-backup'
        New-Item -ItemType Directory -Path (Join-Path $installRoot 'data\nested') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $installRoot 'data\study.db') -Value 'before update' -Encoding UTF8
        Set-Content -LiteralPath (Join-Path $installRoot 'data\nested\notes.txt') -Value 'keep this too' -Encoding UTF8
        $backup = New-StudyOSPreUpdateBackup -InstallRoot $installRoot

        Set-Content -LiteralPath (Join-Path $installRoot 'data\study.db') -Value 'changed' -Encoding UTF8
        Remove-Item -LiteralPath (Join-Path $installRoot 'data\nested\notes.txt') -Force
        Restore-StudyOSPreUpdateBackup -ArchivePath $backup -InstallRoot $installRoot

        (Get-Content -Raw -LiteralPath (Join-Path $installRoot 'data\study.db')).Trim() | Should Be 'before update'
        (Get-Content -Raw -LiteralPath (Join-Path $installRoot 'data\nested\notes.txt')).Trim() | Should Be 'keep this too'
    }

    It 'rejects a pre-update data archive after its contents are tampered with' {
        $installRoot = Join-Path $TestDrive 'corrupt-backup'
        New-Item -ItemType Directory -Path (Join-Path $installRoot 'data') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $installRoot 'data\study.db') -Value 'original' -Encoding UTF8
        $backup = New-StudyOSPreUpdateBackup -InstallRoot $installRoot
        Add-Content -LiteralPath $backup -Value 'tamper'

        { Test-StudyOSPreUpdateBackup -ArchivePath $backup } | Should Throw
    }

    It 'retains only five pre-update data archives' {
        $installRoot = Join-Path $TestDrive 'backup-retention'
        New-Item -ItemType Directory -Path (Join-Path $installRoot 'data') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $installRoot 'data\study.db') -Value 'fixture' -Encoding ASCII

        1..6 | ForEach-Object {
            New-StudyOSPreUpdateBackup -InstallRoot $installRoot | Out-Null
            Start-Sleep -Milliseconds 2
        }

        @(Get-ChildItem -LiteralPath (Join-Path $installRoot 'backups\pre-update') -Filter '*.zip').Count | Should Be 5
    }
}

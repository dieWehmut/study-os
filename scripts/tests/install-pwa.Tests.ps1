$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# install-pwa.ps1 must stay UTF-8 *without* a BOM so `irm <url> | iex` works, but
# that means Windows PowerShell 5.1 dot-sources it from disk as the local ANSI
# codepage: the Chinese output strings decode into mojibake that swallows a `$`
# and the file no longer parses. Read it as UTF-8 explicitly, which is what the
# HTTP path does via Content-Type, then dot-source the resulting scriptblock.
$source = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot 'scripts\install-pwa.ps1')
. ([ScriptBlock]::Create($source)) -ImportOnly

function New-TestZip {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][hashtable]$Entries
    )

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($Path, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($name in $Entries.Keys) {
            # CreateEntry takes the literal name, which is the only way to build
            # the traversal archives Expand-Archive would otherwise happily unpack.
            $entry = $archive.CreateEntry($name)
            $stream = $entry.Open()
            try {
                $bytes = [Text.Encoding]::ASCII.GetBytes([string]$Entries[$name])
                $stream.Write($bytes, 0, $bytes.Length)
            } finally {
                $stream.Dispose()
            }
        }
    } finally {
        $archive.Dispose()
    }
}

Describe 'Study OS one-liner PWA installer contracts' {
    It 'rejects non-HTTPS download locations' {
        { Assert-StudyOSPwaHttps -Url 'http://example.invalid/study-os.zip' } | Should Throw
        { Assert-StudyOSPwaHttps -Url 'file:///C:/secret.zip' } | Should Throw
        { Assert-StudyOSPwaHttps -Url 'C:\secret.zip' } | Should Throw
    }

    It 'rejects an empty download location instead of requesting it' {
        # Overriding -AssetUrl without -ShaUrl used to leave the checksum URL
        # empty, and Invoke-WebRequest reported a parameter error rather than
        # the fact that nothing was going to be verified.
        { Assert-StudyOSPwaHttps -Url '' } | Should Throw
    }

    It 'normalises an accepted HTTPS location' {
        (Assert-StudyOSPwaHttps -Url 'https://example.invalid/a.zip') | Should Be 'https://example.invalid/a.zip'
    }

    It 'rejects an archive whose SHA-256 does not match the sidecar' {
        $path = Join-Path $TestDrive 'mismatch.zip'
        New-TestZip -Path $path -Entries @{ 'start.vbs' = 'fixture' }

        { Assert-StudyOSPwaChecksum -Path $path -Expected ('0' * 64) } | Should Throw
    }

    It 'accepts a sidecar written in sha256sum two-column form' {
        $path = Join-Path $TestDrive 'match.zip'
        New-TestZip -Path $path -Entries @{ 'start.vbs' = 'fixture' }
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()

        { Assert-StudyOSPwaChecksum -Path $path -Expected "$hash  study-os-pwa-windows-x64.zip`n" } | Should Not Throw
    }

    It 'accepts a sidecar delivered as bytes, the way GitHub actually serves it' {
        # GitHub sends release assets as application/octet-stream, and Windows
        # PowerShell 5.1 -- which is what `irm ... | iex` runs on a stock Windows
        # box -- hands back .Content as Byte[] for that content type, not String.
        # Every test here had fed a [string], so the one published install
        # command failed on the checksum step and no test could see it.
        $path = Join-Path $TestDrive 'bytes.zip'
        New-TestZip -Path $path -Entries @{ 'start.vbs' = 'fixture' }
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        $bytes = [Text.Encoding]::ASCII.GetBytes("$hash  study-os-pwa-windows-x64.zip`n")

        { Assert-StudyOSPwaChecksum -Path $path -Expected $bytes } | Should Not Throw
    }

    It 'refuses an archive that would write outside the install folder' {
        $traversal = Join-Path $TestDrive 'traversal.zip'
        New-TestZip -Path $traversal -Entries @{ '../evil.vbs' = 'escape' }
        $rooted = Join-Path $TestDrive 'rooted.zip'
        New-TestZip -Path $rooted -Entries @{ 'C:/Windows/evil.vbs' = 'escape' }

        { Assert-StudyOSPwaSafeArchive -ArchivePath $traversal } | Should Throw
        { Assert-StudyOSPwaSafeArchive -ArchivePath $rooted } | Should Throw
    }

    It 'accepts an archive whose entries all stay inside the install folder' {
        $path = Join-Path $TestDrive 'safe.zip'
        New-TestZip -Path $path -Entries @{ 'start.vbs' = 'ok'; 'web/index.html' = 'ok' }

        { Assert-StudyOSPwaSafeArchive -ArchivePath $path } | Should Not Throw
    }

    It 'reports no backup when there is nothing installed yet' {
        $folder = Join-Path $TestDrive 'fresh'
        New-Item -ItemType Directory -Path $folder -Force | Out-Null

        (Backup-StudyOSPwaData -Folder $folder) | Should BeNullOrEmpty
    }

    It 'backs up the learner database before reinstalling over it' {
        $folder = Join-Path $TestDrive 'upgrade'
        New-Item -ItemType Directory -Path (Join-Path $folder 'data') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $folder 'data\study.db') -Value 'learner progress' -Encoding UTF8

        $backup = Backup-StudyOSPwaData -Folder $folder

        $backup | Should Not BeNullOrEmpty
        (Test-Path -LiteralPath $backup) | Should Be $true
        (Test-Path -LiteralPath "$backup.sha256") | Should Be $true
        $extracted = Join-Path $TestDrive 'upgrade-extract'
        Expand-Archive -LiteralPath $backup -DestinationPath $extracted -Force
        (Get-Content -Raw -LiteralPath (Join-Path $extracted 'data\study.db')).Trim() | Should Be 'learner progress'
    }

    It 'keeps every backup taken during a burst of retried installs' {
        # A second-resolution name would let a retried install overwrite the
        # backup taken moments earlier, which is the one the learner needs.
        $folder = Join-Path $TestDrive 'burst'
        New-Item -ItemType Directory -Path (Join-Path $folder 'data') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $folder 'data\study.db') -Value 'fixture' -Encoding ASCII

        $first = Backup-StudyOSPwaData -Folder $folder
        $second = Backup-StudyOSPwaData -Folder $folder

        $first | Should Not Be $second
        (Test-Path -LiteralPath $first) | Should Be $true
        (Test-Path -LiteralPath $second) | Should Be $true
    }

    It 'retains only five pre-install data archives' {
        $folder = Join-Path $TestDrive 'retention'
        New-Item -ItemType Directory -Path (Join-Path $folder 'data') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $folder 'data\study.db') -Value 'fixture' -Encoding ASCII

        1..7 | ForEach-Object {
            Backup-StudyOSPwaData -Folder $folder | Out-Null
            Start-Sleep -Milliseconds 2
        }

        @(Get-ChildItem -LiteralPath (Join-Path $folder 'backups\pre-install') -Filter '*.zip').Count | Should Be 5
    }

    It 'leaves a server running from a different folder alone' {
        # Only the copy inside the install folder is holding the file that is
        # about to be replaced; a developer build must survive an install.
        $folder = Join-Path $TestDrive 'no-server'
        New-Item -ItemType Directory -Path $folder -Force | Out-Null

        (Stop-StudyOSPwaServer -Folder $folder) | Should Be 0
    }
}

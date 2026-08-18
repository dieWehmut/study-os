# PWA Launcher Startup Fix Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make the Windows PWA launcher accept a healthy backend instead of showing a startup-failed dialog, and repair the already-installed launcher without touching learner data.

**Architecture:** Keep the existing VBScript lifecycle and address-file protocol. Change only the generated launcher's HTTP COM client from MSXML2.XMLHTTP to MSXML2.ServerXMLHTTP.6.0, which supports the existing bounded setTimeouts call. A Pester test exercises the same open, setTimeouts, send, and status sequence against an isolated loopback server before the source change; the fixed generated script is then packaged and copied to the exact start.vbs referenced by the desktop shortcut.

**Tech Stack:** Windows PowerShell 5.1, Pester 3.4, VBScript/Windows Script Host, MSXML 6 ServerXMLHTTP, PowerShell TcpListener test fixture, Compress-Archive and Expand-Archive.

---

## File map and change boundaries

- Create: scripts/tests/package-pwa-release.Tests.ps1 — one regression test for the generated VBScript HTTP client. The file stays ASCII so it does not introduce a new encoding contract.
- Modify: scripts/package-pwa-release.ps1 line 64 — change the single COM ProgID inside the start.vbs template; preserve the file's existing UTF-8 BOM.
- Do not commit: generated build/pwa/start.vbs, temporary release archives, or anything under C:\Users\30119\Desktop\学习系统.
- Preserve: the existing untracked k.json; do not stage or edit it.

## Task 1: Add and commit the red regression test

Files:

- Create: scripts/tests/package-pwa-release.Tests.ps1

- [ ] Step 1: Add the complete failing test

Create the file with this exact content. The temporary TcpListener job writes one HTTP 200 response and never opens a browser; the test extracts the COM ProgID from the production template, so the current MSXML2.XMLHTTP implementation fails at the real unsupported setTimeouts call.

~~~powershell
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$packagePath = Join-Path $repoRoot 'scripts\package-pwa-release.ps1'
$packageSource = Get-Content -Raw -Encoding UTF8 -LiteralPath $packagePath

function Start-TestHttpServer {
    [CmdletBinding()]
    param([Parameter(Mandatory = $true)][string]$ReadyPath)

    $job = Start-Job -ArgumentList $ReadyPath -ScriptBlock {
        param([string]$ReadyFile)

        $listener = [System.Net.Sockets.TcpListener]::new(
            [System.Net.IPAddress]::Loopback,
            0
        )
        $listener.Start()
        $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
        [IO.File]::WriteAllText($ReadyFile, [string]$port)

        try {
            $client = $listener.AcceptTcpClient()
            $stream = $client.GetStream()
            try {
                $buffer = New-Object byte[] 4096
                $null = $stream.Read($buffer, 0, $buffer.Length)
                $body = [Text.Encoding]::UTF8.GetBytes('ok')
                $crlf = ([char]13).ToString() + ([char]10).ToString()
                $headerText = 'HTTP/1.1 200 OK' +
                    $crlf +
                    ('Content-Length: {0}' -f $body.Length) +
                    $crlf +
                    'Connection: close' +
                    $crlf +
                    $crlf
                $header = [Text.Encoding]::ASCII.GetBytes($headerText)
                $stream.Write($header, 0, $header.Length)
                $stream.Write($body, 0, $body.Length)
                $stream.Flush()
            } finally {
                $stream.Dispose()
                $client.Close()
            }
        } finally {
            $listener.Stop()
        }
    }

    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if (Test-Path -LiteralPath $ReadyPath) {
            break
        }
        Start-Sleep -Milliseconds 100
    }
    if (-not (Test-Path -LiteralPath $ReadyPath)) {
        Stop-Job -Job $job -ErrorAction SilentlyContinue
        Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
        throw 'loopback test server did not publish a port'
    }

    return [pscustomobject]@{
        Job  = $job
        Port = [int](Get-Content -Raw -LiteralPath $ReadyPath)
    }
}

function Stop-TestHttpServer {
    param([AllowNull()][object]$Server)

    if ($null -eq $Server) {
        return
    }
    Stop-Job -Job $Server.Job -ErrorAction SilentlyContinue
    Remove-Job -Job $Server.Job -Force -ErrorAction SilentlyContinue
}

Describe 'PWA launcher HTTP probe contract' {
    It 'uses a timeout-capable client for the generated homepage probe' {
        $match = [regex]::Match(
            $packageSource,
            'CreateObject\("(?<progId>MSXML2\.[^"]+)"\)'
        )
        $match.Success | Should Be $true

        $readyPath = Join-Path $TestDrive 'launcher-probe.port'
        $server = $null
        $http = $null
        try {
            $server = Start-TestHttpServer -ReadyPath $readyPath
            $progId = $match.Groups['progId'].Value
            $http = New-Object -ComObject $progId
            $http.open('GET', "http://127.0.0.1:$($server.Port)/", $false)

            { $http.setTimeouts(1500, 1500, 1500, 1500) } |
                Should Not Throw

            $http.send()
            $http.status | Should Be 200
        } finally {
            if ($null -ne $http) {
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($http)
            }
            Stop-TestHttpServer -Server $server
            Remove-Item -LiteralPath $readyPath -Force -ErrorAction SilentlyContinue
        }
    }
}
~~~

- [ ] Step 2: Run the new test and verify the expected red failure

Run from D:\project\study-os:

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Pester -Script 'scripts/tests/package-pwa-release.Tests.ps1' -EnableExit"
~~~

Expected result on the unmodified source: one failed test at setTimeouts, with an exception containing Could not find member from MSXML2.XMLHTTP. If the test errors before that assertion, fix the test fixture before proceeding; do not change production code.

- [ ] Step 3: Commit only the red test

~~~powershell
git add -- scripts/tests/package-pwa-release.Tests.ps1
git diff --cached --check
git commit -m "test: reproduce PWA launcher timeout client failure"
~~~

Expected result: a commit containing only scripts/tests/package-pwa-release.Tests.ps1; k.json remains unstaged and untracked.

## Task 2: Apply the minimal source fix and commit the green implementation

Files:

- Modify: scripts/package-pwa-release.ps1 line 64
- Test: scripts/tests/package-pwa-release.Tests.ps1

- [ ] Step 1: Replace the unsupported COM ProgID

Change exactly this line inside the $startVbs here-string:

~~~diff
-  Set http = CreateObject("MSXML2.XMLHTTP")
+  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
~~~

Do not alter the surrounding polling, address-file, timeout values, Chinese message, or Set-Content -Encoding Unicode. Preserve the source file's UTF-8 BOM; verify its first three bytes remain 239,187,191.

~~~powershell
$sourceBytes = [IO.File]::ReadAllBytes('scripts\package-pwa-release.ps1')
if (($sourceBytes[0..2] -join ',') -ne '239,187,191') {
    throw 'package-pwa-release.ps1 lost its UTF-8 BOM'
}
~~~

- [ ] Step 2: Run the focused test and confirm green

~~~powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Pester -Script 'scripts/tests/package-pwa-release.Tests.ps1' -EnableExit"
~~~

Expected result: one passing test; the COM call completes, the fixture receives the request, and http.status is 200.

- [ ] Step 3: Run all script tests before committing

~~~powershell
$testFiles = @(
    'scripts/tests/package-pwa-release.Tests.ps1',
    'scripts/tests/install-pwa.Tests.ps1',
    'scripts/tests/install.Tests.ps1',
    'scripts/tests/encoding.Tests.ps1'
)
foreach ($testFile in $testFiles) {
    $result = Invoke-Pester -Script $testFile -PassThru
    if ($result.FailedCount -ne 0) {
        throw "$testFile failed with $($result.FailedCount) failing test(s)"
    }
}
~~~

Expected result: every listed Pester file exits successfully. The encoding suite must still accept the BOM on package-pwa-release.ps1; if it fails, restore the BOM before committing.

- [ ] Step 4: Commit only the source fix

~~~powershell
git add -- scripts/package-pwa-release.ps1
git diff --cached --check
git commit -m "fix: use timeout-capable HTTP client in PWA launcher"
~~~

Expected result: the commit contains only the production script. The preceding test commit remains separate in history.

## Task 3: Generate and inspect a repaired PWA artifact

Files:

- Generate outside the repository: a temporary release directory and extracted archive.
- Read: build/pwa/start.vbs and the archive's start.vbs.

- [ ] Step 1: Create a private repair workspace and generate the package

~~~powershell
$repairRoot = Join-Path $env:TEMP ('study-os-pwa-repair-' + [guid]::NewGuid().ToString('N'))
$outputRoot = Join-Path $repairRoot 'release'
$extractRoot = Join-Path $repairRoot 'extracted'
New-Item -ItemType Directory -Path $outputRoot,$extractRoot -Force | Out-Null

$requiredInputs = @(
    'frontend\dist',
    'build\pwa\study-os-server.exe'
)
foreach ($requiredInput in $requiredInputs) {
    if (-not (Test-Path -LiteralPath $requiredInput)) {
        throw "SkipBuild input is missing: $requiredInput"
    }
}

$packageArgs = @(
    '-Version', 'local-repair-20260818',
    '-SkipBuild',
    '-OutputRoot', $outputRoot
)
& (Join-Path (Get-Location) 'scripts\package-pwa-release.ps1') @packageArgs
if (-not $?) {
    throw 'PWA package generation failed'
}

$archivePath = Join-Path $outputRoot 'study-os-pwa-windows-x64.zip'
Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force
$generatedStart = Join-Path $extractRoot 'start.vbs'
$requiredEntries = @(
    $generatedStart,
    (Join-Path $extractRoot 'study-os-server.exe'),
    (Join-Path $extractRoot 'web\index.html')
)
foreach ($requiredEntry in $requiredEntries) {
    if (-not (Test-Path -LiteralPath $requiredEntry -PathType Leaf)) {
        throw "generated archive entry is missing: $requiredEntry"
    }
}
~~~

Expected result: the script reports a PWA archive and SHA-256; extraction contains start.vbs, study-os-server.exe, and web.

- [ ] Step 2: Verify archive integrity, encoding, and client type

~~~powershell
$archiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
$sidecarHash = (Get-Content -Raw -LiteralPath "$archivePath.sha256").Trim().Split(' ')[0].ToLowerInvariant()
if ($archiveHash -ne $sidecarHash) {
    throw "archive checksum mismatch: $archiveHash vs $sidecarHash"
}

$startBytes = [IO.File]::ReadAllBytes($generatedStart)
if ($startBytes.Length -lt 2 -or $startBytes[0] -ne 0xFF -or $startBytes[1] -ne 0xFE) {
    throw 'generated start.vbs is not UTF-16LE with a BOM'
}
$startText = [Text.Encoding]::Unicode.GetString($startBytes, 2, $startBytes.Length - 2)
if ($startText -notmatch 'MSXML2\.ServerXMLHTTP\.6\.0') {
    throw 'generated start.vbs does not contain the timeout-capable HTTP client'
}
~~~

Expected result: checksum matches, the first bytes are FF FE, and the decoded script contains MSXML2.ServerXMLHTTP.6.0.

- [ ] Step 3: Keep generated output out of the repository

~~~powershell
git status --short
~~~

Expected result: no generated release archive is listed. build/ is ignored; repairRoot is under TEMP. Do not use git add -A.

## Task 4: Replace only the current installation's launcher

Files:

- Replace only: the start.vbs path read from the existing desktop shortcut (currently C:\Users\30119\Desktop\学习系统\start.vbs).
- Create outside the repository: repairRoot\start.vbs.before as a rollback copy.
- Do not touch: data, backups, web, study-os-server.exe, or the .lnk file.

- [ ] Step 1: Resolve and validate the exact shortcut target

~~~powershell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop '学习系统.lnk'
if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
    throw "desktop shortcut not found: $shortcutPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$installRoot = [IO.Path]::GetFullPath($shortcut.WorkingDirectory)
$targetStart = [IO.Path]::GetFullPath($shortcut.Arguments.Trim('"'))
$expectedStart = [IO.Path]::GetFullPath((Join-Path $installRoot 'start.vbs'))

if ($targetStart -ne $expectedStart) {
    throw "refusing to replace unexpected target: $targetStart"
}
if (-not (Test-Path -LiteralPath $targetStart -PathType Leaf)) {
    throw "shortcut target does not exist: $targetStart"
}
~~~

Expected result: targetStart is the start.vbs used by the current shortcut; no other path is accepted.

- [ ] Step 2: Snapshot protected data and back up the old launcher

~~~powershell
$protectedBefore = @(
    Get-ChildItem -LiteralPath (Join-Path $installRoot 'data') -Recurse -File |
        Where-Object { $_.Name -notmatch '^(launcher-address|study\.db-(wal|shm))$' } |
        ForEach-Object {
            [pscustomobject]@{
                Path = $_.FullName
                Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            }
        }
)
$oldStartBackup = Join-Path $repairRoot 'start.vbs.before'
Copy-Item -LiteralPath $targetStart -Destination $oldStartBackup
~~~

Expected result: the rollback copy exists in repairRoot; the snapshot records learner files while excluding only launcher/runtime files that can legitimately change during startup.

- [ ] Step 3: Copy the validated archive launcher with rollback

~~~powershell
try {
    Copy-Item -LiteralPath $generatedStart -Destination $targetStart -Force
} catch {
    Copy-Item -LiteralPath $oldStartBackup -Destination $targetStart -Force
    throw
}

$installedBytes = [IO.File]::ReadAllBytes($targetStart)
if ($installedBytes.Length -lt 2 -or $installedBytes[0] -ne 0xFF -or $installedBytes[1] -ne 0xFE) {
    throw 'installed start.vbs lost its UTF-16LE BOM'
}
$installedText = [Text.Encoding]::Unicode.GetString($installedBytes, 2, $installedBytes.Length - 2)
if ($installedText -notmatch 'MSXML2\.ServerXMLHTTP\.6\.0') {
    throw 'installed start.vbs still uses the broken HTTP client'
}
~~~

Expected result: only the validated launcher file changes; the old file remains recoverable at oldStartBackup.

- [ ] Step 4: Confirm protected data did not change during the file replacement

~~~powershell
$protectedAfter = @(
    Get-ChildItem -LiteralPath (Join-Path $installRoot 'data') -Recurse -File |
        Where-Object { $_.Name -notmatch '^(launcher-address|study\.db-(wal|shm))$' } |
        ForEach-Object {
            [pscustomobject]@{
                Path = $_.FullName
                Hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
            }
        }
)
$beforeLines = @($protectedBefore | ForEach-Object { "$($_.Path)|$($_.Hash)" })
$afterLines = @($protectedAfter | ForEach-Object { "$($_.Path)|$($_.Hash)" })
$differences = Compare-Object $beforeLines $afterLines
if ($differences) {
    Copy-Item -LiteralPath $oldStartBackup -Destination $targetStart -Force
    throw 'protected data changed; restored the previous start.vbs'
}
~~~

Expected result: no differences are reported and the database/data files remain intact.

## Task 5: Exercise the repaired desktop launcher and run the final suite

Files: none; verification only.

- [ ] Step 1: Run the actual repaired start.vbs through Windows Script Host

~~~powershell
$runnerOptions = @{
    FilePath = (Join-Path $env:WINDIR 'System32\cscript.exe')
    ArgumentList = @('//NoLogo', ('"{0}"' -f $targetStart))
    WorkingDirectory = $installRoot
    WindowStyle = 'Hidden'
    PassThru = $true
}
$runner = Start-Process @runnerOptions
if (-not $runner.WaitForExit(30000)) {
    Stop-Process -Id $runner.Id -Force
    throw 'start.vbs did not finish its probe within 30 seconds; inspect for a modal failure dialog'
}
if ($runner.ExitCode -ne 0) {
    throw "start.vbs exited with code $($runner.ExitCode)"
}
~~~

Expected result: the script exits promptly and does not enter the failure-dialog path. It may open the local PWA browser tab as designed.

- [ ] Step 2: Verify the address published by the backend

~~~powershell
$address = (Get-Content -Raw -LiteralPath (Join-Path $installRoot 'data\launcher-address')).Trim()
if ($address -notmatch '^[^:]+:[0-9]+$') {
    throw "invalid launcher address: $address"
}
$response = Invoke-WebRequest -UseBasicParsing -Uri "http://$address/" -TimeoutSec 5
if ($response.StatusCode -ne 200) {
    throw "launcher homepage returned HTTP $($response.StatusCode)"
}
~~~

Expected result: the live address returns HTTP 200, matching the probe that the VBScript accepts.

- [ ] Step 3: Run all relevant automated tests one last time

~~~powershell
$testFiles = @(
    'scripts/tests/package-pwa-release.Tests.ps1',
    'scripts/tests/install-pwa.Tests.ps1',
    'scripts/tests/install.Tests.ps1',
    'scripts/tests/encoding.Tests.ps1'
)
foreach ($testFile in $testFiles) {
    $result = Invoke-Pester -Script $testFile -PassThru
    if ($result.FailedCount -ne 0) {
        throw "$testFile failed with $($result.FailedCount) failing test(s)"
    }
}
git diff --check
git status --short
~~~

Expected result: all four Pester invocations pass, git diff --check is clean, and the only pre-existing worktree entry is the untracked k.json. No generated artifact or installation file is staged.

- [ ] Step 4: Keep the rollback copy until the user confirms the repaired shortcut

The backup is repairRoot\start.vbs.before. If the user reports a regression before confirmation, restore it with:

~~~powershell
Copy-Item -LiteralPath $oldStartBackup -Destination $targetStart -Force
~~~

Do not delete the backup or the temporary repair directory until the repaired shortcut has been accepted.

## Commit sequence

1. a300cd9 docs: design PWA launcher startup fix (already present).
2. test: reproduce PWA launcher timeout client failure — Task 1 test only; intentionally red before the fix.
3. fix: use timeout-capable HTTP client in PWA launcher — Task 2 source line only; all script tests green.
4. Tasks 3–5 are artifact, deployment, and verification operations and create no repository commit. Generated files and the current user's installation remain outside version control.

## Self-review against the design

- Root cause and selected ServerXMLHTTP.6.0 approach are covered by Tasks 1–2.
- UTF-16LE output, checksum, and source BOM checks are covered by Tasks 2–3.
- Exact address-file flow and HTTP 200 behavior are covered by Tasks 1 and 5.
- Data preservation and rollback are covered by Task 4.
- No Go/backend, port, browser, or unrelated desktop-installer behavior is changed.
- The plan contains no unresolved placeholders; every code-changing step names a file, command, expected result, and commit boundary.

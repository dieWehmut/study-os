$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# Windows PowerShell 5.1 decides how to decode a script from its byte order
# mark: with one it reads UTF-8, without one it falls back to the machine's ANSI
# code page. On a Chinese Windows that is GBK, and a UTF-8 full-width colon
# (EF BC 9A) decoded as GBK swallows the byte after it -- which is how a stray
# '$' goes missing and the whole file stops parsing.
#
# So every script carrying non-ASCII text needs a BOM, with exactly one
# exception: install-pwa.ps1 is fetched over HTTP and piped into `iex`, where
# Invoke-RestMethod hands the BOM through as a literal U+FEFF glued to the first
# command. Its encoding is therefore load-bearing in the opposite direction, and
# neither constraint is visible in a diff.
#
# This file deliberately stays pure ASCII so it needs no BOM of its own.

function Get-ScriptBytes {
    param([Parameter(Mandatory = $true)][string]$RelativePath)
    return [IO.File]::ReadAllBytes((Join-Path $repoRoot $RelativePath))
}

function Test-HasUtf8Bom {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    return ($Bytes.Length -ge 3 -and $Bytes[0] -eq 0xEF -and $Bytes[1] -eq 0xBB -and $Bytes[2] -eq 0xBF)
}

function Test-HasNonAscii {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)
    $start = 0
    if (Test-HasUtf8Bom -Bytes $Bytes) {
        # The BOM's own bytes are >0x7F, so skip them or every BOM'd file looks
        # like it contains non-ASCII text.
        $start = 3
    }
    for ($i = $start; $i -lt $Bytes.Length; $i++) {
        if ($Bytes[$i] -gt 0x7F) {
            return $true
        }
    }
    return $false
}

Describe 'PowerShell script encoding contracts' {
    It 'keeps install-pwa.ps1 free of a BOM so the one-liner survives iex' {
        # `irm <raw url> | iex` is the documented install path in README.md.
        $bytes = Get-ScriptBytes -RelativePath 'scripts\install-pwa.ps1'

        (Test-HasUtf8Bom -Bytes $bytes) | Should Be $false
    }

    It 'keeps install-pwa.ps1 parseable once decoded as UTF-8' {
        # Being BOM-less only works because GitHub raw serves the file as
        # text/plain; charset=utf-8. Confirm the bytes really are UTF-8 and that
        # the result still parses, which is what `iex` will do with them.
        $bytes = Get-ScriptBytes -RelativePath 'scripts\install-pwa.ps1'
        $strict = New-Object Text.UTF8Encoding($false, $true)
        $source = $null
        { $source = $strict.GetString($bytes) } | Should Not Throw

        $errors = $null
        [Management.Automation.Language.Parser]::ParseInput($source, [ref]$null, [ref]$errors) | Out-Null
        @($errors).Count | Should Be 0
    }

    It 'keeps a BOM on package-pwa-release.ps1 so its Chinese text survives' {
        # This one is only ever run from disk, and it writes Chinese strings into
        # the generated start.vbs. Without a BOM they are mojibake before they
        # are ever written.
        $bytes = Get-ScriptBytes -RelativePath 'scripts\package-pwa-release.ps1'

        (Test-HasUtf8Bom -Bytes $bytes) | Should Be $true
    }

    It 'requires a BOM on every other script that carries non-ASCII text' {
        # install.ps1 is pure ASCII today, which is the only reason its own test
        # suite can dot-source it from disk. Adding one Chinese message would
        # break that silently, so catch it here rather than on a user's machine.
        $offenders = @()
        $scripts = @(Get-ChildItem -LiteralPath $repoRoot -Filter '*.ps1' -Recurse -File |
            Where-Object { $_.FullName -notmatch '\\node_modules\\' })
        foreach ($script in $scripts) {
            $relative = $script.FullName.Substring($repoRoot.Length + 1)
            if ($relative -eq 'scripts\install-pwa.ps1') {
                continue
            }
            $bytes = [IO.File]::ReadAllBytes($script.FullName)
            if ((Test-HasNonAscii -Bytes $bytes) -and -not (Test-HasUtf8Bom -Bytes $bytes)) {
                $offenders += $relative
            }
        }

        ($offenders -join ', ') | Should Be ''
    }
}

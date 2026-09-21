$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

# Windows PowerShell 5.1 decides how to decode a script from its byte order
# mark: with one it reads UTF-8, without one it falls back to the machine's ANSI
# code page. On a Chinese Windows that is GBK, and a UTF-8 full-width colon
# (EF BC 9A) decoded as GBK swallows the byte after it -- which is how a stray
# '$' goes missing and the whole file stops parsing.
#
# So every script carrying non-ASCII text needs a BOM; without one the text is
# mojibake before it is ever written, and the constraint is invisible in a diff.
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
    It 'requires a BOM on every script that carries non-ASCII text' {
        # install.ps1 is pure ASCII today, which is the only reason its own test
        # suite can dot-source it from disk. Adding one Chinese message would
        # break that silently, so catch it here rather than on a user's machine.
        $offenders = @()
        $scripts = @(Get-ChildItem -LiteralPath $repoRoot -Filter '*.ps1' -Recurse -File |
            Where-Object { $_.FullName -notmatch '\\node_modules\\' })
        foreach ($script in $scripts) {
            $relative = $script.FullName.Substring($repoRoot.Length + 1)
            $bytes = [IO.File]::ReadAllBytes($script.FullName)
            if ((Test-HasNonAscii -Bytes $bytes) -and -not (Test-HasUtf8Bom -Bytes $bytes)) {
                $offenders += $relative
            }
        }

        ($offenders -join ', ') | Should Be ''
    }
}

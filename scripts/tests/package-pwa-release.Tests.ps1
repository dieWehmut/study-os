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
    if ($Server.Job.State -eq 'Running') {
        $cleanupClient = [System.Net.Sockets.TcpClient]::new()
        try {
            $cleanupClient.Connect([System.Net.IPAddress]::Loopback, $Server.Port)
            $cleanupStream = $cleanupClient.GetStream()
            $crlf = ([char]13).ToString() + ([char]10).ToString()
            $request = [Text.Encoding]::ASCII.GetBytes(
                'GET / HTTP/1.1' + $crlf + 'Host: localhost' + $crlf + $crlf
            )
            $cleanupStream.Write($request, 0, $request.Length)
            $cleanupStream.Flush()
        } catch {
        } finally {
            $cleanupClient.Close()
        }
        Wait-Job -Job $Server.Job -Timeout 5 | Out-Null
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

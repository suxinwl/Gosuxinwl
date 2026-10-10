$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Split-Path -Parent $PSScriptRoot)).Path
$binaryPath = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'bin\gosuxin.exe')).Path
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'manifest\config\config.yaml'))) {
    throw 'Initialize and configure manifest/config/config.yaml first.'
}
New-Item -ItemType Directory -Path (Join-Path $projectRoot 'runtime') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $projectRoot 'resource\uploads') -Force | Out-Null
$listeners = @(Get-NetTCPConnection -LocalPort 8603 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    $processId = [int]$listeners[0].OwningProcess
    $runningProcess = Get-Process -Id $processId -ErrorAction Stop
    if ($runningProcess.Path -ne $binaryPath) { throw 'Port 8603 belongs to a different application.' }
    Write-Output "GoSuxinV1.0 is running: http://127.0.0.1:8603/suxinweb/ (PID $processId)"
    exit 0
}
$coreProcess = Start-Process -FilePath $binaryPath -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'runtime\core-running-stdout.log') -RedirectStandardError (Join-Path $projectRoot 'runtime\core-running-stderr.log') -PassThru
$coreProcess.Id | Set-Content -LiteralPath (Join-Path $projectRoot 'runtime\core-host.pid') -Encoding ASCII
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $listener = Get-NetTCPConnection -LocalPort 8603 -State Listen -ErrorAction SilentlyContinue
    if ($listener -and $listener.OwningProcess -eq $coreProcess.Id) {
        Write-Output "GoSuxinV1.0 started: http://127.0.0.1:8603/suxinweb/ (PID $($coreProcess.Id))"
        exit 0
    }
    if ($coreProcess.HasExited) { break }
    Start-Sleep -Milliseconds 250
}
throw 'Startup did not complete; inspect runtime/core-running-stdout.log and stderr.log.'

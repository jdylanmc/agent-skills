param(
    [Parameter(Mandatory = $true)][ValidateSet('run', 'probe')][string]$Operation,
    [Parameter(Mandatory = $true)][string]$Spec
)
$ErrorActionPreference = 'Stop'
try {
    $data = Get-Content -LiteralPath $Spec -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($data.job -notmatch '^Local\\Bench-[0-9a-f-]{36}$') { throw 'Invalid owned job identity' }
    Add-Type -Path (Join-Path $PSScriptRoot 'fleet-state.windows.cs')
    if ($Operation -eq 'run') {
        $code = [BenchWindowsJob]::Run($data.job, $data.executable, [string[]]$data.arguments,
            $data.cwd, $data.deadlineMs, $data.parentPid, $data.receipt, $data.cancelled)
        exit $code
    }
    $active = [BenchWindowsJob]::Inspect($data.job)
    @{ active = $active } | ConvertTo-Json -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 125
}

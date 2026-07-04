<#
Pinnacle POS Print Agent - Local Smoke Test

Run this on the same machine as the running agent (after installing the
Windows service, or during `npm run dev`). PowerShell built-ins only - no
Node.js, no external modules, safe to run on a bare POS counter that only
has this release folder on it.

Usage:
    powershell -ExecutionPolicy Bypass -File smoke-test-local.ps1
#>

$BaseUrl = "http://127.0.0.1:17777"
$script:HardFailures = 0

function Write-Pass([string]$Message) {
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Write-Fail([string]$Message) {
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    $script:HardFailures++
}

function Write-WarnLine([string]$Message) {
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Pinnacle POS Print Agent - Local Smoke Test" -ForegroundColor Cyan
Write-Host "Target: $BaseUrl"
Write-Host ""

# 1. GET /health - if this fails, nothing else can work, so treat it as an
# immediate abort rather than continuing to spam failures for every
# subsequent check.
$health = $null
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/health" -Method Get -TimeoutSec 5
    if ($health.status -eq "ok") {
        Write-Pass "GET /health -> status=ok ($($health.agentName) v$($health.version) on $($health.machineName))"
    } else {
        Write-Fail "GET /health responded but status was '$($health.status)', expected 'ok'"
    }
} catch {
    Write-Fail "GET /health did not respond: $($_.Exception.Message)"
    Write-Host ""
    Write-Host "The agent does not appear to be running on port 17777 on this machine." -ForegroundColor Red
    Write-Host "Check the Windows service (services.msc -> Pinnacle POS Print Agent), or" -ForegroundColor Red
    Write-Host "run install-service.bat / start-service.bat as Administrator." -ForegroundColor Red
    Write-Host ""
    Write-Host "Smoke test aborted: $($script:HardFailures) hard failure(s)." -ForegroundColor Red
    exit 1
}

if ($health.printerMappings) {
    foreach ($role in $health.printerMappings.PSObject.Properties.Name) {
        $mapping = $health.printerMappings.$role
        if ($mapping.configured -and ($mapping.printerInstalled -eq $false)) {
            Write-WarnLine "Role '$role' is mapped to '$($mapping.printerName)' but that printer is not currently installed on this machine."
        }
    }
}

# 2. GET /version
try {
    $version = Invoke-RestMethod -Uri "$BaseUrl/version" -Method Get -TimeoutSec 5
    Write-Pass "GET /version -> $($version.version) (built $($version.buildTime))"
} catch {
    Write-Fail "GET /version did not respond: $($_.Exception.Message)"
}

# 3. GET /printers
try {
    $printers = Invoke-RestMethod -Uri "$BaseUrl/printers" -Method Get -TimeoutSec 10
    $printerCount = @($printers.printers).Count
    if ($printerCount -gt 0) {
        Write-Pass "GET /printers -> $printerCount printer(s) installed on this machine"
    } else {
        Write-WarnLine "GET /printers -> 0 printers found on this machine (is any printer installed in Windows?)"
    }
} catch {
    Write-Fail "GET /printers did not respond: $($_.Exception.Message)"
}

# 4. GET /config
$config = $null
try {
    $config = Invoke-RestMethod -Uri "$BaseUrl/config" -Method Get -TimeoutSec 5
    Write-Pass "GET /config -> reachable"
} catch {
    Write-Fail "GET /config did not respond: $($_.Exception.Message)"
}

if (-not $health.configured) {
    Write-WarnLine "Agent is not fully configured yet (no machine code and/or no printer mappings saved)."
    Write-Host "  Open the setup page to configure this counter: $BaseUrl/setup" -ForegroundColor Yellow
}

# 5. POST /test-print (receipt only) - skipped entirely if no receipt
# printer is mapped yet, since there is nothing to test against.
$receiptMapping = $null
if ($config -and $config.printerMappings -and $config.printerMappings.receipt) {
    $receiptMapping = $config.printerMappings.receipt
}

if (-not $receiptMapping) {
    Write-WarnLine "POST /test-print skipped - no receipt printer configured yet. Configure one at $BaseUrl/setup first."
} else {
    try {
        $body = @{ role = "receipt" } | ConvertTo-Json
        $testPrint = Invoke-RestMethod -Uri "$BaseUrl/test-print" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 15
        Write-Pass "POST /test-print (receipt) -> sent to '$($testPrint.printerName)'"
    } catch {
        Write-Fail "POST /test-print (receipt) failed: $($_.Exception.Message)"
    }
}

Write-Host ""
if ($script:HardFailures -gt 0) {
    Write-Host "Smoke test finished with $($script:HardFailures) hard failure(s)." -ForegroundColor Red
    exit 1
} else {
    Write-Host "Smoke test finished - no hard failures." -ForegroundColor Green
    exit 0
}

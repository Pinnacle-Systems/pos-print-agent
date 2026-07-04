<#
Pinnacle POS Print Agent - Config Backup

Copies the current config.json (printer mappings, machine code) to a
timestamped file under a backups/ subfolder. Safe to run at any time,
including while the service is running - it only reads config.json and
writes a copy elsewhere, it never modifies the original.

Recommended before upgrading the agent or making printer-mapping changes
you might want to undo. See the root/release README "Upgrading the agent"
section.

Usage:
    powershell -ExecutionPolicy Bypass -File backup-config.ps1
#>

$ConfigPath = "C:\ProgramData\Pinnacle\PosPrintAgent\config.json"
$BackupDir = "C:\ProgramData\Pinnacle\PosPrintAgent\backups"

if (-not (Test-Path -LiteralPath $ConfigPath)) {
    Write-Host "No config.json found at $ConfigPath - nothing to back up." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path -LiteralPath $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $BackupDir "config-$timestamp.json"

Copy-Item -LiteralPath $ConfigPath -Destination $backupPath -Force

Write-Host "Backed up config.json to:" -ForegroundColor Green
Write-Host "  $backupPath"

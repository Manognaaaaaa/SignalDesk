# Runs `npm run ingest` from the repo root and appends the output to logs/ingest-local.log.
# Used by the Windows scheduled task "SignalDesk local ingest" (see README, "Collecting data locally").
# Local runs reach FXStreet, which blocks Vercel's datacenter IPs.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $repo
New-Item -ItemType Directory -Force (Join-Path $repo "logs") | Out-Null
$log = Join-Path $repo "logs\ingest-local.log"
"=== $(Get-Date -Format o) ===" | Out-File -Append -Encoding utf8 $log
npm run ingest *>> $log
"exit $LASTEXITCODE" | Out-File -Append -Encoding utf8 $log

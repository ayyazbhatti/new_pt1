# Start all services once (Windows / PowerShell).
#
# Use case:
# - Run this instead of `bash scripts/start-all.sh` on Windows so you avoid `/bin/bash` / PATH issues.
# - It starts infra + applies migrations + launches backend services + frontend.

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$infraCompose = Join-Path $repoRoot "infra/docker-compose.yml"
$logDir = Join-Path $repoRoot "deploy/logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

#
# Resolve executables to absolute paths (avoids PowerShell picking a wrong shim/script).
#
$cargoExe = (Get-Command cargo -ErrorAction Stop).Source
$npmCmd = (Get-Command npm.cmd -ErrorAction Stop).Source

function Start-Service {
    param(
        [Parameter(Mandatory=$true)][string]$Name,
        [Parameter(Mandatory=$true)][string]$WorkingDirectory,
        [Parameter(Mandatory=$true)][string]$FilePath,
        [Parameter(Mandatory=$true)][string[]]$Arguments
    )

    $outFile = Join-Path $logDir ("{0}.out.log" -f $Name)
    $errFile = Join-Path $logDir ("{0}.err.log" -f $Name)

    Write-Host ("Starting {0} ..." -f $Name)
    Start-Process `
        -FilePath $FilePath `
        -ArgumentList $Arguments `
        -WorkingDirectory $WorkingDirectory `
        -NoNewWindow `
        -RedirectStandardOutput $outFile `
        -RedirectStandardError $errFile | Out-Null
}

Write-Host "==> Starting infra (Postgres, Redis, NATS)..."
& docker compose -f $infraCompose up -d | Out-Null

# Defaults (matches service code expectations / existing start-all.sh)
$env:REDIS_URL = "redis://127.0.0.1:6379"
$env:NATS_URL = "nats://localhost:4222"
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/newpt"
$env:JWT_SECRET = "dev-jwt-secret-key-change-in-production-minimum-32-characters-long"
$env:JWT_ISSUER = "newpt"

Write-Host "==> Waiting for Postgres..."
for ($i = 0; $i -lt 30; $i++) {
    $ok = $true
    try {
        & docker exec trading-postgres pg_isready -U postgres -d newpt | Out-Null
    } catch {
        $ok = $false
    }
    if ($ok) { break }
    Start-Sleep -Seconds 1
    if ($i -eq 29) { throw "Postgres did not become ready." }
}

Write-Host "==> Applying migrations..."
$migDir = Join-Path $repoRoot "infra/migrations"
if (Test-Path $migDir) {
    $files = Get-ChildItem -Path $migDir -Filter "*.sql" | Sort-Object Name
    foreach ($f in $files) {
        Write-Host ("  Applying {0} ..." -f $f.Name)
        # Feed file into container psql (no host psql dependency).
        # PowerShell doesn't reliably support bash-style `< file.sql` redirection here,
        # so we pipe the SQL content into docker exec stdin instead.
        $sql = Get-Content -Raw -Path $f.FullName
        $null = $sql | & docker exec -i trading-postgres psql -U postgres -d newpt
        if ($LASTEXITCODE -ne 0) {
            Write-Warning ("  Migration failed (continuing): {0} (exit {1})" -f $f.Name, $LASTEXITCODE)
        }
    }
} else {
    Write-Host "  (no infra/migrations directory, skipping)"
}

Write-Host "==> Starting auth-service (port 3000)..."
Start-Service -Name "auth-service" `
    -WorkingDirectory (Join-Path $repoRoot "backend/auth-service") `
    -FilePath $cargoExe `
    -Arguments @("run", "--bin", "auth-service")

Write-Host "==> Starting ws-gateway (WS 3003, health 9002)..."
$env:WS_PORT = "3003"
$env:HTTP_PORT = "9002"
Start-Service -Name "ws-gateway" `
    -WorkingDirectory (Join-Path $repoRoot "backend/ws-gateway") `
    -FilePath $cargoExe `
    -Arguments @("run")

Write-Host "==> Starting data-provider (WS 9003, health 9004)..."
$env:WS_PORT = "9003"
$env:HTTP_PORT = "9004"
Start-Service -Name "data-provider" `
    -WorkingDirectory (Join-Path $repoRoot "backend/data-provider") `
    -FilePath $cargoExe `
    -Arguments @("run")

Write-Host "==> Starting order-engine (port 3002)..."
$env:PORT = "3002"
Start-Service -Name "order-engine" `
    -WorkingDirectory $repoRoot `
    -FilePath $cargoExe `
    -Arguments @("run", "-p", "order-engine")

Write-Host "==> Starting core-api (port 3004)..."
$env:PORT = "3004"
Start-Service -Name "core-api" `
    -WorkingDirectory $repoRoot `
    -FilePath $cargoExe `
    -Arguments @("run", "-p", "core-api")

Write-Host "==> Starting frontend (Vite, port 5173)..."
Start-Service -Name "frontend" `
    -WorkingDirectory $repoRoot `
    -FilePath "cmd.exe" `
    # Quote npm.cmd path because it contains spaces ("Program Files").
    -Arguments @("/c", "`"$npmCmd`"", "run", "dev")

Write-Host ""
Write-Host "Started. Logs:"
Write-Host ("  {0}" -f $logDir)
Write-Host ""
Write-Host "Quick checks:"
Write-Host "  curl http://localhost:3000/health"
Write-Host "  curl http://localhost:9002/health"
Write-Host "  curl http://localhost:9004/health"
Write-Host "  curl http://localhost:3002/health"
Write-Host "  Open: http://localhost:5173/login"


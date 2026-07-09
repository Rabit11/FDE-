param(
    [string]$TargetHost = "10.90.111.114",
    [string]$TargetUser = "root",
    [string]$RemoteDir = "/opt/keyan-platform"
)

$ErrorActionPreference = "Stop"
$PlatformDir = Split-Path -Parent $PSScriptRoot

Write-Host "==> 打包平台代码..." -ForegroundColor Cyan
$tarPath = Join-Path $env:TEMP "keyan-platform.tar.gz"
if (Test-Path $tarPath) { Remove-Item $tarPath }

# 使用 tar（Windows 10+ 自带）
Push-Location $PlatformDir
tar czf $tarPath --exclude=node_modules --exclude=dist --exclude=.git docker-compose.yml .env.example nginx backend frontend
Pop-Location

Write-Host "==> 上传到 ${TargetUser}@${TargetHost}..." -ForegroundColor Cyan
ssh "${TargetUser}@${TargetHost}" "mkdir -p ${RemoteDir}"
scp $tarPath "${TargetUser}@${TargetHost}:/tmp/keyan-platform.tar.gz"

Write-Host "==> 远程构建并启动..." -ForegroundColor Cyan
$remoteScript = @"
set -e
cd ${RemoteDir}
tar xzf /tmp/keyan-platform.tar.gz
if [ ! -f .env ]; then cp .env.example .env; fi
docker compose down 2>/dev/null || true
docker compose build
docker compose up -d
docker compose ps
echo ''
echo '部署完成: http://${TargetHost}:8084'
"@
ssh "${TargetUser}@${TargetHost}" $remoteScript

Write-Host "==> 完成! 访问 http://${TargetHost}:8084" -ForegroundColor Green

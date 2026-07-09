param(
    [string]$TargetHost = "10.90.111.114",
    [string]$TargetUser = "yanghuiran",
    # 114 上 docker compose 实际运行目录
    [string]$RemoteDir = "/data_SSD_21T/users/yanghuiran/yanghuiran/FDE-platform",
    [int]$Port = 8085,
    [switch]$NoCache
)

$ErrorActionPreference = "Stop"
$PlatformDir = Split-Path -Parent $PSScriptRoot

Write-Host "==> 打包 platform 代码..." -ForegroundColor Cyan
$tarPath = Join-Path $env:TEMP "keyan-platform.tar.gz"
if (Test-Path $tarPath) { Remove-Item $tarPath }

Push-Location $PlatformDir
tar czf $tarPath --exclude=node_modules --exclude=dist --exclude=.git docker-compose.yml .env.example nginx backend frontend deploy
Pop-Location

Write-Host "==> 上传到 ${TargetUser}@${TargetHost}:${RemoteDir} ..." -ForegroundColor Cyan
ssh -p 22 "${TargetUser}@${TargetHost}" "mkdir -p ${RemoteDir}"
scp -P 22 $tarPath "${TargetUser}@${TargetHost}:/tmp/keyan-platform.tar.gz"

$buildFlag = if ($NoCache) { "docker compose build --no-cache backend frontend" } else { "docker compose build backend frontend" }

$remoteScript = @"
set -e
mkdir -p ${RemoteDir}
cd ${RemoteDir}
tar xzf /tmp/keyan-platform.tar.gz
if [ ! -f .env ]; then cp .env.example .env; fi
grep -q '^APP_PORT=' .env && sed -i 's/^APP_PORT=.*/APP_PORT=${Port}/' .env || echo 'APP_PORT=${Port}' >> .env
${buildFlag}
docker compose up -d
docker compose ps
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  if curl -fsS http://127.0.0.1:${Port}/api/health; then
    break
  fi
  if [ "`$i" = "30" ]; then
    echo '健康检查失败，输出 backend 日志：'
    docker compose logs --tail=120 backend
    exit 1
  fi
  sleep 2
done
echo ''
echo '部署完成: http://${TargetHost}:${Port}'
"@

$remoteScriptPath = Join-Path $env:TEMP "keyan-platform-remote-deploy.sh"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($remoteScriptPath, ($remoteScript -replace "`r`n", "`n"), $utf8NoBom)
scp -P 22 $remoteScriptPath "${TargetUser}@${TargetHost}:/tmp/keyan-platform-remote-deploy.sh"

Write-Host "==> 远程构建并启动..." -ForegroundColor Cyan
ssh -p 22 "${TargetUser}@${TargetHost}" "bash /tmp/keyan-platform-remote-deploy.sh"

Write-Host "==> 完成! 访问 http://${TargetHost}:${Port}" -ForegroundColor Green

# Docker deploy to 10.90.111.114:8084 - stop old process first, do not push GitHub
$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Key = "$env:USERPROFILE\.ssh\id_keyan114"
$RemoteHost = "yanghuiran@10.90.111.114"
$RemoteBase = "/data_SSD_21T/users/yanghuiran/yanghuiran"
$Tarball = "$env:TEMP\fde-deploy.tgz"

Set-Location $Root
Write-Host "[1/4] Packaging app with Dockerfile..."
tar -czf $Tarball `
  --exclude=node_modules --exclude=.git `
  --exclude=deploy/local/.env --exclude="*.m4a" --exclude="*.mp3" `
  server public scripts package.json package-lock.json .env.example README.md `
  Dockerfile docker-compose.yml .dockerignore deploy

Write-Host "[2/4] Uploading to server..."
scp -i $Key -P 22 $Tarball "${RemoteHost}:${RemoteBase}/fde-deploy.tgz"
scp -i $Key -P 22 "$PSScriptRoot\deploy-docker-8084.sh" "${RemoteHost}:${RemoteBase}/deploy-docker-8084.sh"
if (Test-Path ".env") {
  scp -i $Key -P 22 ".env" "${RemoteHost}:${RemoteBase}/fde-platform.env.upload"
}

Write-Host "[3/4] Remote Docker deploy - stop old process first..."
$remoteCmd = "chmod +x $RemoteBase/deploy-docker-8084.sh && mkdir -p $RemoteBase/fde-platform && if [ -f $RemoteBase/fde-platform.env.upload ]; then mv -f $RemoteBase/fde-platform.env.upload $RemoteBase/fde-platform/.env; fi && bash $RemoteBase/deploy-docker-8084.sh"
ssh -i $Key -p 22 $RemoteHost $remoteCmd

Write-Host "[4/4] Done http://10.90.111.114:8084"

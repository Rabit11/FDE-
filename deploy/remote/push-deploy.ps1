# 打包并推送到远程服务器 10.90.111.114:8084（systemd 后台常驻）
$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Key = "$env:USERPROFILE\.ssh\id_keyan114"
$RemoteHost = "yanghuiran@10.90.111.114"
$RemoteBase = "/data_SSD_21T/users/yanghuiran/yanghuiran"
$Tarball = "$env:TEMP\fde-deploy.tgz"

Set-Location $Root
Write-Host "[1/4] 打包应用代码..."
tar -czf $Tarball `
  --exclude=node_modules --exclude=.git --exclude=data `
  --exclude=deploy/local/.env --exclude="*.m4a" --exclude="*.mp3" `
  server public scripts package.json package-lock.json .env.example README.md deploy

Write-Host "[2/4] 上传到服务器..."
scp -i $Key -P 22 $Tarball "${RemoteHost}:${RemoteBase}/fde-deploy.tgz"
scp -i $Key -P 22 "$PSScriptRoot\deploy-8084.sh" "${RemoteHost}:${RemoteBase}/deploy-8084.sh"
scp -i $Key -P 22 "$PSScriptRoot\start.sh" "${RemoteHost}:${RemoteBase}/deploy-remote-start.sh"
scp -i $Key -P 22 "$PSScriptRoot\fde-platform.service" "${RemoteHost}:${RemoteBase}/fde-platform.service"

Write-Host "[3/4] 远程部署（systemd 守护启动）..."
ssh -i $Key -p 22 $RemoteHost "chmod +x ${RemoteBase}/deploy-8084.sh && bash ${RemoteBase}/deploy-8084.sh"

Write-Host "[4/4] Done: http://10.90.111.114:8084 (keeps running after SSH logout / local PC off)"

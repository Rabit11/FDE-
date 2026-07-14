# 本地启动 FDE 管理平台
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

if (-not (Test-Path ".env")) {
  Copy-Item "deploy\local\env.example" ".env"
  Write-Host "已创建 .env（PORT=3456）"
}

$env:PORT = "3456"
Write-Host "启动本地服务: http://localhost:3456"
npm start

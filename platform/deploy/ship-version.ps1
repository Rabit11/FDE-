<#
.SYNOPSIS
  版本发布：Git 提交 + 打标签 + 推送 GitHub + 部署 114（不覆盖历史，每次为新版本）

.EXAMPLE
  cd "d:\BeiyanCenter\预研项目管理平台"
  .\platform\deploy\ship-version.ps1 -Message "看板钢蓝主题改版"

.EXAMPLE
  .\platform\deploy\ship-version.ps1 -Message "修复登录" -SkipDeploy
#>
param(
    [Parameter(Mandatory = $true)]
    [string]$Message,

    [string]$Branch = "master",
    [string]$RepoUrl = "https://github.com/Rabit11/paltform.git",
    [string]$TargetHost = "10.90.111.114",
    [string]$TargetUser = "yanghuiran",
    [string]$RemoteDir = "/data_SSD_21T/users/yanghuiran/yanghuiran/yuyanplatform/platform",
    [ValidateSet('patch', 'minor', 'major')]
    [string]$Bump = 'patch',
    [switch]$NoCache,
    [switch]$SkipPush,
    [switch]$SkipDeploy,
    [switch]$SkipTag
)

$ErrorActionPreference = "Stop"
$RootDir = Resolve-Path (Join-Path $PSScriptRoot "../..")
$VersionFile = Join-Path $RootDir "VERSION"
$ChangelogFile = Join-Path $RootDir "CHANGELOG.md"

function Bump-Version([string]$current, [string]$level) {
    $parts = $current.Trim() -split '\.'
    if ($parts.Count -lt 3) { $parts = @('0', '1', '0') }
    $major = [int]$parts[0]
    $minor = [int]$parts[1]
    $patch = [int]$parts[2]
    switch ($level) {
        'major' { $major++; $minor = 0; $patch = 0 }
        'minor' { $minor++; $patch = 0 }
        default { $patch++ }
    }
    return "$major.$minor.$patch"
}

Set-Location $RootDir

if (-not (Test-Path $VersionFile)) {
    Set-Content -Path $VersionFile -Value "0.1.0" -Encoding UTF8
}

$oldVersion = (Get-Content $VersionFile -Raw).Trim()
$newVersion = Bump-Version $oldVersion $Bump
$tag = "v$newVersion"
$date = Get-Date -Format "yyyy-MM-dd"

Write-Host "==> 版本: $oldVersion -> $newVersion ($tag)" -ForegroundColor Cyan

Set-Content -Path $VersionFile -Value "$newVersion`n" -Encoding UTF8

$changelogEntry = @"

## [$newVersion] - $date

- $Message

"@
if (Test-Path $ChangelogFile) {
    $body = Get-Content $ChangelogFile -Raw -Encoding UTF8
    if ($body -match '(?m)^## \[') {
        $body = $body -replace '(?m)^(## \[)', "$changelogEntry`$1"
    } else {
        $body = $body.TrimEnd() + "`n" + $changelogEntry
    }
    Set-Content -Path $ChangelogFile -Value $body -Encoding UTF8
} else {
    Set-Content -Path $ChangelogFile -Value "# 变更日志`n$changelogEntry" -Encoding UTF8
}

# 仅提交项目相关路径（不含 third-party、.env 等）
$paths = @(
    'platform',
    'docs',
    'VERSION',
    'CHANGELOG.md',
    '.cursor/skills',
    '.gitignore'
)
foreach ($p in $paths) {
    $full = Join-Path $RootDir $p
    if (Test-Path $full) { git add -- $p }
}

$status = git status --porcelain
if (-not $status) {
    Write-Host "==> No staged changes (VERSION/CHANGELOG updated)" -ForegroundColor Yellow
} else {
    git commit -m "$Message" -m "Release: $tag"
    Write-Host "==> Committed: $tag" -ForegroundColor Green
}

if (-not $SkipTag) {
    $prevErr = $ErrorActionPreference
    $ErrorActionPreference = 'SilentlyContinue'
    git rev-parse --verify "refs/tags/$tag" 2>$null | Out-Null
    $tagExists = ($LASTEXITCODE -eq 0)
    $ErrorActionPreference = $prevErr
    if ($tagExists) {
        Write-Host "==> Tag $tag exists, skip" -ForegroundColor Yellow
    } else {
        git tag -a $tag -m "$Message ($date)"
    }
}

if (-not $SkipPush) {
    $remote = git remote get-url origin 2>$null
    if ($LASTEXITCODE -ne 0) {
        git remote add origin $RepoUrl
    }
    Write-Host "==> Push to GitHub ($Branch) tag $tag ..." -ForegroundColor Cyan
    # git 常把进度写到 stderr；在 Stop 模式下会误触发 RemoteException
    $prevErr = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    git pull --rebase origin $Branch 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "    (rebase pull skipped or failed, continuing with push)" -ForegroundColor Yellow
    }
    git push -u origin $Branch 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        $ErrorActionPreference = $prevErr
        throw "git push origin $Branch failed (exit $LASTEXITCODE)"
    }
    git push origin $tag 2>&1 | ForEach-Object { Write-Host "    $_" }
    if ($LASTEXITCODE -ne 0) {
        $ErrorActionPreference = $prevErr
        throw "git push origin $tag failed (exit $LASTEXITCODE)"
    }
    $ErrorActionPreference = $prevErr
}

if (-not $SkipDeploy) {
    $deployArgs = @{
        TargetHost = $TargetHost
        TargetUser = $TargetUser
        RemoteDir  = $RemoteDir
    }
    if ($NoCache) { $deployArgs.NoCache = $true }
    & (Join-Path $PSScriptRoot "deploy-114.ps1") @deployArgs
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Done: $tag" -ForegroundColor Green
Write-Host " GitHub: $RepoUrl" -ForegroundColor Green
Write-Host " 114: http://${TargetHost}:8084" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green

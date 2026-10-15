<#
  AIRI 网页版 —— 本地 / 局域网启动脚本

  用之前要先构建过一次：
    cd C:\qwen-api\Vtuber\airi
    pnpm -F @proj-airi/stage-web run build

  然后：
    .\start-airi-web.ps1                 # http://localhost:5173
    .\start-airi-web.ps1 -Port 8080      # 换端口
#>
param(
  [string]$BindAddress = '0.0.0.0',
  [int]$Port = 5173
)

$ErrorActionPreference = 'Stop'

$airiRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\airi')).Path
$entry = Join-Path $airiRoot 'apps\stage-web\dist\index.html'

if (-not (Test-Path -LiteralPath $entry)) {
  Write-Host "还没构建过 stage-web。先在 $airiRoot 里执行：" -ForegroundColor Yellow
  Write-Host "  pnpm -F @proj-airi/stage-web run build" -ForegroundColor Yellow
  exit 1
}

Set-Location -LiteralPath $airiRoot
Write-Host "AIRI 网页版 -> http://localhost:$Port/  (局域网: http://本机IP:$Port/)" -ForegroundColor Cyan
pnpm -F @proj-airi/stage-web exec vite preview --host $BindAddress --port $Port

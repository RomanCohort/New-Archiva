<#
  character-chat（凌暮雪的大脑）—— 本机启动脚本

  起来之后：http://127.0.0.1:8000
    GET  /v1/models            探活
    POST /v1/chat/completions  AIRI 走这个（OpenAI 协议，支持流式）
    POST /chat                 微信那条路，照旧

  上游模型是本机 llama-server 网关（127.0.0.1:8001）。
#>
param(
  [int]$Port = 8000,
  [string]$BindAddress = '127.0.0.1',
  # AIRI 的舞台是浏览器页面，跨域来打 /v1/chat/completions —— 必须在白名单里，
  # 否则 preflight 直接 400 Disallowed CORS origin，浏览器只报 "Failed to fetch"。
  # server.py 为了堵住「任意网页都能拿 /chat 执行命令」故意默认一个都不放（见
  # server.py L52-64），所以这里按部署的 origin 显式加。改端口记得同步改。
  [string]$CorsOrigins = 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080'
)

$ErrorActionPreference = 'Stop'

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\character-chat')).Path
$venvPython = Join-Path $repo '.venv\Scripts\python.exe'
$keyFile = Join-Path $PSScriptRoot '..\.airi-vtuber.key'

if (-not (Test-Path -LiteralPath $venvPython)) {
  Write-Host "没找到虚拟环境：$venvPython" -ForegroundColor Yellow
  Write-Host "先在 $repo 里建：python -m venv .venv 然后 pip install fastapi uvicorn websockets pydantic openai ruamel.yaml loguru numpy scikit-learn typeguard PyYAML lunardate zstandard" -ForegroundColor Yellow
  Write-Host "（websockets 别漏：只装裸 uvicorn 的话 /ws/live2d 握手起不来，表情联动会静默失灵）" -ForegroundColor Yellow
  exit 1
}

if (Test-Path -LiteralPath $keyFile) {
  $env:CHARACTER_CHAT_LLM_API_KEY = (Get-Content -LiteralPath $keyFile -Raw).Trim()
}
else {
  Write-Host "⚠ 没找到 $keyFile —— 网关会回 401。用 gateway 的 /admin/keys 建一把。" -ForegroundColor Yellow
}

# torus.py 里有个裸 import torus_schema，所以模块自己那层目录也得在 path 上
$env:PYTHONPATH = (Join-Path $repo 'src') + ';' + (Join-Path $repo 'src\character_chat')

# 浏览器直连的白名单（见 server.py 的 _CORS_ORIGINS / DSH_CORS_ORIGINS）
$env:DSH_CORS_ORIGINS = $CorsOrigins

Set-Location -LiteralPath $repo
Write-Host "凌暮雪的大脑 -> http://$BindAddress`:$Port  (上游 127.0.0.1:8001)" -ForegroundColor Cyan
Write-Host "浏览器跨域白名单: $CorsOrigins" -ForegroundColor DarkGray
& $venvPython -m uvicorn character_chat.server:app --host $BindAddress --port $Port

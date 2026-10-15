<#
  把 C:\qwen-api\Vtuber 这套部署定期归档到 github.com/RomanCohort/New-Archiva。

  有意只挑最小可还原集合：
    deploy/   启动脚本、compose、nginx 配置、以及这个同步脚本本身
    tools/    三个自检探针
    docs/     AIRI_BRAIN.md
    config/   character-chat 的 config.yaml（api_key 是空的）
    patches/  两个仓库相对各自 upstream 的改动补丁
    shots/    少量截图

  **不放**：airi / character-chat 的整个 checkout（第三方 + 几个 GB）、任何密钥。
  提交前有一道密钥闸门，扫到 `sk-...` 之类就直接拒绝提交。

  用法：
    .\sync-to-new-archiva.ps1                    # 生成补丁 → 同步 → 提交 → 推送
    .\sync-to-new-archiva.ps1 -NoPush            # 只到提交为止
    .\sync-to-new-archiva.ps1 -Message "自定义"  # 自定义提交信息
#>
param(
  # 源工作区。脚本自己住在归档仓库里，所以源目录只能显式写（换机器就传参覆盖）
  [string]$SourceRoot = 'C:\qwen-api\Vtuber',
  # 归档仓库，默认就是本脚本所在仓库的根（脚本在 <repo>\deploy\ 下）
  [string]$ArchiveDir = '',
  [string]$Message = '',
  [switch]$NoPush
)

$ErrorActionPreference = 'Stop'

if (-not $ArchiveDir) { $ArchiveDir = Join-Path $PSScriptRoot '..' }
if (-not (Test-Path -LiteralPath (Join-Path $ArchiveDir '.git'))) {
  throw "归档目录不是 git 仓库：$ArchiveDir"
}
if (-not (Test-Path -LiteralPath $SourceRoot)) {
  throw "源工作区不存在：$SourceRoot（用 -SourceRoot 指定）"
}
$root = (Resolve-Path -LiteralPath $SourceRoot).Path
$archive = (Resolve-Path -LiteralPath $ArchiveDir).Path

Write-Host "源   : $root" -ForegroundColor Cyan
Write-Host "归档 : $archive" -ForegroundColor Cyan

function Copy-Into {
  param([string]$From, [string]$To)
  if (-not (Test-Path -LiteralPath $From)) {
    Write-Host "  跳过（不存在）: $From" -ForegroundColor DarkYellow
    return
  }
  New-Item -ItemType Directory -Force -Path $To | Out-Null
  if (Test-Path -LiteralPath $From -PathType Container) {
    # 目录要拷**内容**。直接 Copy-Item -LiteralPath <dir> -Destination <已存在的dir>
    # 会在目标里再造一层同名目录，变成 deploy/deploy/... —— 第一次跑就踩了。
    Copy-Item -Path (Join-Path $From '*') -Destination $To -Recurse -Force
  }
  else {
    Copy-Item -LiteralPath $From -Destination $To -Force
  }
}

# ---- 1. 重新生成补丁 ----
function Write-Patch {
  param([string]$RepoPath, [string]$OutFile, [string[]]$Paths)
  if (-not (Test-Path -LiteralPath (Join-Path $RepoPath '.git'))) {
    Write-Host "  跳过补丁（没有 .git）: $RepoPath" -ForegroundColor DarkYellow
    return
  }
  # add -N 让「新增文件」也出现在 diff 里，否则新写的模块整个漏掉
  & git -C $RepoPath add -N -- @Paths | Out-Null
  $diff = & git -C $RepoPath diff HEAD -- @Paths | Out-String
  $diff | Out-File -LiteralPath $OutFile -Encoding utf8
  Write-Host ("  补丁 {0}  ({1} 字符)" -f (Split-Path $OutFile -Leaf), $diff.Length) -ForegroundColor DarkGray
}

New-Item -ItemType Directory -Force -Path (Join-Path $archive 'patches') | Out-Null
Write-Patch `
  -RepoPath (Join-Path $root 'character-chat') `
  -OutFile (Join-Path $archive 'patches\character-chat-airi-brain.patch') `
  -Paths @(
    'src/character_chat/config.py',
    'src/character_chat/server.py',
    'src/character_chat/openai_compat.py',
    'src/character_chat/live2d/bridge.py',
    'docs/AIRI_BRAIN.md'
  )
Write-Patch `
  -RepoPath (Join-Path $root 'airi') `
  -OutFile (Join-Path $archive 'patches\airi-emotion-bridge.patch') `
  -Paths @(
    'packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue',
    'packages/stage-ui-live2d/src/composables/live2d/index.ts',
    'packages/stage-ui-live2d/src/composables/live2d/emotion-bridge.ts'
  )

# ---- 2. 同步文件 ----
Copy-Into (Join-Path $root 'deploy') (Join-Path $archive 'deploy')
Copy-Into (Join-Path $root 'tools') (Join-Path $archive 'tools')

# 注意：Copy-Into 的第二个参数是「目录」，单个文件也交给 Copy-Item 自己取名，
# 否则 New-Item -ItemType Directory 会照文件名造出一个同名的**目录**来。
Copy-Into (Join-Path $root 'character-chat\docs\AIRI_BRAIN.md') (Join-Path $archive 'docs')
Copy-Into (Join-Path $root 'character-chat\config\config.yaml') (Join-Path $archive 'config')
foreach ($shot in 'airi-06-reply.png', 'airi-09-kokoro-page.png', 'airi-16-emotion-live.png') {
  Copy-Into (Join-Path $root "shots\$shot") (Join-Path $archive 'shots')
}

# ---- 3. 密钥闸门（真推上去就晚了）----
Write-Host "查密钥…" -ForegroundColor DarkGray
$suspicious = Get-ChildItem -LiteralPath $archive -Recurse -File -Force |
  Where-Object { $_.FullName -notmatch '\\\.git\\' } |
  Select-String -Pattern 'sk-[A-Za-z0-9_\-]{20,}' -List -ErrorAction SilentlyContinue
if ($suspicious) {
  Write-Host "发现疑似密钥，拒绝提交：" -ForegroundColor Red
  $suspicious | ForEach-Object { Write-Host ("  " + $_.Path) -ForegroundColor Red }
  exit 1
}

# ---- 4. 提交 + 推送 ----
& git -C $archive add -A
$status = & git -C $archive status --porcelain
if (-not $status) {
  Write-Host "没有变化，什么都不用做。" -ForegroundColor Green
  exit 0
}

if (-not $Message) { $Message = "archive: 快照 $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }

# 身份用 -c 传，不改仓库/全局配置；邮箱是 GitHub 的 noreply 形式
& git -C $archive `
  -c user.name=RomanCohort `
  -c user.email=232059557+RomanCohort@users.noreply.github.com `
  commit -m $Message | Out-String | Write-Host

if ($NoPush) {
  Write-Host "已提交（-NoPush，没推）。" -ForegroundColor Yellow
  exit 0
}

# 没有终端就报错，别在这儿挂住等输入密码
$env:GIT_TERMINAL_PROMPT = '0'
& git -C $archive push origin HEAD:main 2>&1 | Select-Object -Last 6 | Write-Host
Write-Host "推送完成。" -ForegroundColor Green

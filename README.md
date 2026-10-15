# New-Archiva

`C:\qwen-api\Vtuber` 这套"凌暮雪 = character-chat 当脑 + AIRI 当皮"部署的**定期快照**。

由 `deploy/sync-to-new-archiva.ps1` 生成，内容每次整体覆盖，所以这里的文件永远是
源目录那一刻的样子；要改就改源目录，然后跑那个脚本。

## 里面有什么

```
deploy/   启动脚本（起皮 / 起脑）、docker-compose、nginx.conf、本同步脚本
tools/    三个自检探针
            airi-probe.mjs      Playwright 探针：真开页面、打字、点发送、抓控制台、截图
            ws_emotion_probe.py 连 /ws/live2d，打一发 /chat，把收到的 WS 消息原样打印
            emotion_probe.py    单独跑情绪管线，看判定出的 label / intensity
docs/     AIRI_BRAIN.md —— 接线图 + 踩过的坑（含那两个 bridge bug 的成因）
config/   character-chat 的 config.yaml（api_key 留空，读环境变量，无密钥）
patches/  两个仓库相对各自 upstream 的改动补丁
shots/    少量截图
```

**不含**：`airi` / `character-chat` 的完整 checkout（第三方 + 好几个 GB），以及任何密钥。
要还原改动就用 `patches/`。

## 这套东西在做什么

```
浏览器里的 AIRI 舞台 (localhost:5173)
  ├─ 聊天 provider: openai-compatible → http://127.0.0.1:8000/v1
  │     （AIRI 以为在跟一个 OpenAI 模型说话，对面其实是整条凌暮雪管线：
  │       人设 / 记忆 / 心境 / 时间场景 都在 character-chat 那边）
  └─ WebSocket: ws://127.0.0.1:8000/ws/live2d
        （脑算出来的情绪 label + intensity → Live2D 表情参数，
          写在 final 阶段的 motion 插件里，叠在动作/眨眼/口型之上）

character_chat (127.0.0.1:8000, FastAPI)
  └─ 上游模型 = 本机 llama-server 网关 http://127.0.0.1:8001/v1
```

## 怎么恢复

```powershell
# 1. 两个仓库各自 clone 到 C:\qwen-api\Vtuber\ 下
git clone https://github.com/moeru-ai/airi.git
git clone https://github.com/RomanCohort/character-chat.git

# 2. 打补丁
git -C airi apply ..\New-Archiva\patches\airi-emotion-bridge.patch
git -C character-chat apply ..\New-Archiva\patches\character-chat-airi-brain.patch

# 3. 按 docs/AIRI_BRAIN.md 装依赖、配 CORS、起服务
```

## 注意

- 浏览器侧要配的东西（provider / 语音 / 听觉）在 `docs/AIRI_BRAIN.md` 里，
  有可直接粘的片段。AIRI 是 PWA，**改完记得清一次站点数据**，否则旧 Service
  Worker 会用 precache 里的旧页面顶住。
- 这里只放"能还原出这套部署"的最小集合，不放模型权重和密钥。

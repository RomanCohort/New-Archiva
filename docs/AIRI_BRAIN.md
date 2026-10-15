# 把 AIRI 当皮、character-chat 当脑

> 2026-10-15 本机部署。AIRI 在 `C:\qwen-api\Vtuber\airi`，本仓库在
> `C:\qwen-api\Vtuber\character-chat`。

## 分工

```
AIRI 浏览器舞台 (stage-web, localhost:5173)
  └─ 聊天 provider: openai-compatible
       Base URL = http://127.0.0.1:8000/v1
       API Key  = 随便填（本机 loopback）
       Model    = ling-muxue
            ↓ POST /v1/chat/completions   (OpenAI 协议，支持流式 SSE)
character_chat (FastAPI, 127.0.0.1:8000)
  └─ openai_compat.py → 只取最后一条 user 文本 → cli.send()
       人设 / 记忆 / 心境 / 时间场景 全在这里
       ↓ 与微信那条路共用 session_id="default" 的同一个 Cli 实例
  └─ LLMClient
       base_url = http://127.0.0.1:8001/v1   (本机 llama-server 网关)
       model    = qwen3.6-35b-a3b-base
```

## 为什么是这么接的

AIRI 的 OpenAI 兼容 provider 只认 `/v1/chat/completions`，所以**不需要改
AIRI 一行代码** —— 它以为自己在跟一个模型说话，其实对面是整条凌暮雪管线。
反过来，AIRI 传来的 system prompt 和历史被有意丢掉：脑只在这一侧，
两边各存一份记忆迟早会对不上。

## 跑起来

### 浏览器侧要配什么（2026-10-15 实测）

这段是拿 Playwright 真开页面、真点发送验过的。整段粘进 DevTools 控制台再刷新即可：

```js
localStorage.setItem('onboarding/completed', 'true') // 跳过首启引导
localStorage.setItem('settings/providers/configured', JSON.stringify({
  'openai-compatible': {
    id: 'openai-compatible', definitionId: 'openai-compatible',
    config: { apiKey: 'local', baseUrl: 'http://127.0.0.1:8000/v1' },
    status: 'configured', configuredBy: 'user',
  },
  'kokoro-local': {
    id: 'kokoro-local', definitionId: 'kokoro-local',
    config: { model: 'q4f16', voiceId: '' }, // 有 WebGPU 就换 fp16-webgpu
    status: 'configured', configuredBy: 'user',
  },
  'browser-web-speech-api': {
    id: 'browser-web-speech-api', definitionId: 'browser-web-speech-api',
    config: { language: 'zh-CN' },
    status: 'configured', configuredBy: 'user',
  },
}))
localStorage.setItem('settings/providers/added', JSON.stringify({
  'openai-compatible': true, 'kokoro-local': true, 'browser-web-speech-api': true,
}))
localStorage.setItem('settings/speech/active-provider', 'kokoro-local')
localStorage.setItem('settings/speech/active-model', 'q4f16')
localStorage.setItem('settings/hearing/active-provider', 'browser-web-speech-api')
localStorage.setItem('airi-card-module-defaults', JSON.stringify({
  consciousness: { provider: 'openai-compatible', model: 'ling-muxue' },
  vision: { provider: '', model: '' },
  speech: { provider: 'kokoro-local', model: 'q4f16', voice_id: '' },
  displayModelId: 'preset-live2d-1',
}))
location.reload()
```

踩过的三个点：

- `settings/providers/configured` 的形状是 `{id, definitionId, config, status, configuredBy}`。
  **`status` 不能省**：聊天照样能用（`chatReady` 只看 provider+model），但首启引导不认它，
  那个 `z-9999` 的全屏遮罩会一直盖着，把聊天框的 `pointer-events` 压成 `none` —— 表现就是
  「点不动发送键、填进去的字被清空」。
- Kokoro 的合法模型 id 只有 7 个（`workers/kokoro/constants.ts` 的 `KOKORO_MODELS`）：
  `fp16-webgpu` / `fp32-webgpu` / `fp32` / `fp16` / `q8` / `q4f16`。
  有 WebGPU 选 `fp16-webgpu`，否则 `q4f16`（这是 `getDefaultKokoroModel` 的规则）。
  **填 `kokoro-82m` 会直接 `Invalid model`** —— 设置页里那个 `defaultModel = 'kokoro-82m'`
  是个变量名，不是合法 id，别抄它。`listVoices` 读的就是
  `getProviderConfig('kokoro-local').config.model`，路径没错的话它自然通。
- 音色（`voiceId`）得在设置页「声线 → 选择首选语音」里点一次：kokoro-js 的音色表是
  运行时从模型包里取的，没法离线写死一个可信值。

另外记一笔：`browser-web-speech-api` 在 Chrome 下是**走 Google 云**的，不是本地识别；
想要离线识别得走 sherpaw（wasm 资产已经在 dist 里），但 `browser-local-audio-transcription`
的设置页是 `<WIP />` 空壳，UI 上配不了，得动代码。

```powershell
# 起脑（脚本里会设好 PYTHONPATH 和 API key，不用手敲密钥）
C:\qwen-api\Vtuber\deploy\start-character-chat.ps1

# 皮已经构建过了，起静态站
C:\qwen-api\Vtuber\deploy\start-airi-web.ps1
```

自检：

```powershell
curl.exe http://127.0.0.1:8000/v1/models
curl.exe -X POST http://127.0.0.1:8000/v1/chat/completions `
  -H "Content-Type: application/json" `
  -d "{\"model\":\"ling-muxue\",\"messages\":[{\"role\":\"user\",\"content\":\"在吗\"}]}"
```

依赖装在 `character-chat\.venv`（Python 3.14）。装的是最小集：
fastapi / uvicorn / pydantic / openai / ruamel.yaml / loguru / numpy /
scikit-learn / typeguard。**没装 torch / sentence-transformers**，
所以神经情感分类器（`--neural`）用不了，规则情感照常。

## 已知的坑

### 表情联动（2026-10-15 打通）

脑算出来的情绪现在会落到脸上：`/ws/live2d` → AIRI 侧的
`packages/stage-ui-live2d/src/composables/live2d/emotion-bridge.ts`
（作为 `final` 阶段的 motion 插件注册，在动作/表情/眨眼/口型之后叠加）。

实测链路（happy @0.55，输入「我好喜欢你」）：

```
/live2d/status        last_params_keys = [ParamMouthForm, ParamEyeSmile, ParamCheek, ParamBrowLY, ParamBrowRY]
浏览器 bridge.status  lastLabel = happy, lastIntensity = 0.55
浏览器 targets        ParamCheek 0.22 / ParamEyeLSmile 0.33 / ParamEyeRSmile 0.33
                      ParamMouthForm 0.44 / ParamBrowLY.RY 0.055
```

三个必须记住的点：

1. **`intensity < 0.2` 就什么都不推。** `emotion_params.get_live2d_params()`
   里那条 `LOW_INTENSITY_THRESHOLD`：情绪认出来了、强度不够，连广播都省。
   而且**本机没装 torch，走的是规则+标签那条降级路**——「我刚才一直在偷偷看你」
   「你今天好温柔啊」这类含蓄的句子规则判不出来，直接 neutral / 0.0。
   想验证联动别用含蓄话，用带明显情绪词的（「我好喜欢你」→ happy 0.55）。
   要测判得准不准，单独跑：`.venv\Scripts\python.exe ..\tools\emotion_probe.py`
2. **hiyori 没有 `ParamEyeSmile`。** 它的笑眼是 `ParamEyeLSmile` / `ParamEyeRSmile`
   （从模型包的 `.cdi3.json` 里读出来的），而 `Model.vue` 那行
   `setParameterValueById('ParamEyeSmile', ...)` 在 hiyori 上是个空操作。
   联动层直接写模型真有的 id，没走那条路。
3. **`ParamMouthOpenY` 有意丢掉。** 嘴归 AIRI 自己的 lip sync 管，
   情绪再去抢就会和音频包络打架。

顺便记：AIRI 是 PWA，**重新构建之后旧 Service Worker 会用 precache 里的旧
index.html 回导航请求**，页面会一直跑旧 bundle（表现就是"代码明明改了却没生效"）。
清一次站点数据，或者在半自动探针里加 `--clear-sw`。

### 眼睛睁不开的坑（bridge.py 原本的两个 bug）

这两个都是**本机实测撞出来的**，不修的话前端一条事件都收不到：

1. `pusher()` 里 `if client.ws.client_state.value != "CONNECTED": break` ——
   `starlette 1.x` 的 `WebSocketState.CONNECTED.value` 是**整数 1**，
   老版本是 `"connected"`（小写），两种都不等于 `"CONNECTED"`，
   结果是**拿到第一条 payload 就 break，还什么都没发**。
   已改成"直接 send，断了靠异常退出"。
2. `EMOTION_UPDATED` 是在**线程池线程**里被 publish 的（server.py 用
   `run_in_executor`），那时 `asyncio.get_event_loop()` 会抛 RuntimeError，
   退化成跨线程 `queue.put_nowait()` —— 它不会唤醒跑在别的线程上的 loop，
   pusher 永远等在那儿。已改成 `loop.call_soon_threadsafe(_enqueue, ...)`。

自检：`.venv\Scripts\python.exe ..\tools\ws_emotion_probe.py "我好喜欢你"`
（它连上 WS、打一发 /chat、把收到的每条消息原样打印。）

**另外 `websockets` 必须装** —— 只装裸 `uvicorn` 的话 WebSocket 升级根本起不来
（`/ws/live2d` 握手失败，前端一片安静），而且不会报错给你看。

- **CORS 是必须显式开的。** AIRI 是浏览器页面，打 `127.0.0.1:8000` 属于跨域；
  `server.py` 默认一个 origin 都不放（有意为之：任何网页都能 POST `/chat` 执行命令
  这事儿太危险）。所以启动脚本里设了 `DSH_CORS_ORIGINS`，把舞台的 origin 列进去。
  现象对不上就先看这个 —— 浏览器只会给一句「Failed to fetch」，看不出是 CORS：

  ```powershell
  curl.exe -i -X OPTIONS http://127.0.0.1:8000/v1/chat/completions `
    -H "Origin: http://localhost:5173" `
    -H "Access-Control-Request-Method: POST" `
    -H "Access-Control-Request-Headers: content-type"
  # 期望 200 + access-control-allow-origin: http://localhost:5173
  # 现在若是 400 Disallowed CORS origin，就是白名单没带上
  ```

  ⚠️ 顺带提醒：白名单等于「这个 origin 的页面能碰到一个有 shell 工具的大脑」。
  别图省事写成 `*`。

  另外 `allow_headers` 里必须有 `Authorization`：AIRI 的 OpenAI 客户端固定带
  `Authorization: Bearer <key>`，这是「非简单请求头」，不放行的话 preflight
  照样 400 —— 症状和上面一模一样。复验：

  ```powershell
  curl.exe -o NUL -w "%{http_code}`n" -X OPTIONS http://127.0.0.1:8000/v1/chat/completions `
    -H "Origin: http://localhost:5173" -H "Access-Control-Request-Method: POST" `
    -H "Access-Control-Request-Headers: authorization,content-type"
  # 期望 200（而不是 400 Disallowed CORS headers）
  ```

- **表情暂时不会动。** AIRI 的表情/动作是靠它自己那套 function calling
  工具驱动的（`stage-ui-live2d/src/tools/expression-tools.ts`），而这层
  兼容壳不接 tool_calls。现在只有 AIRI 自带的眨眼、待机动作。
  真要联动，走 character-chat 现成的 `WS /ws/live2d`（推
  `emotion_updated`，参数是 Cubism 标准 ParamId），在 AIRI 侧加个小 mod 消费。
- **AIRI 的角色卡不生效。** 人设以本仓库的 `config/characters/ling_muxue.yaml`
  为准，AIRI 里那张卡只是摆设。
- **记忆是共享的。** 从 AIRI 说的话和从微信说的话进同一个会话，
  这是有意的；要拆开就把 `openai_compat.py` 里的 `_get_cli("default")`
  换成别的 session_id。

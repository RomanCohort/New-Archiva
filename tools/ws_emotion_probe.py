"""听一次 character-chat 的 /ws/live2d，看它到底推了什么情绪事件。

用法（在 character-chat 的 venv 里跑，需要 websockets + requests）：
    .venv\\Scripts\\python.exe ..\\tools\\ws_emotion_probe.py "我刚才一直在偷偷看你"

它做三件事：
  1. 连上 /ws/live2d，发 hello，把 ready 打出来
  2. 并发地打一发 /v1/chat/completions（走的就是 AIRI 那条路）
  3. 60 秒内把收到的每条 WS 消息原样打印

如果什么都不推，多半是 `get_live2d_params` 那句
`if intensity < LOW_INTENSITY_THRESHOLD (0.2): return {}` —— 情绪识别出来了，
但强度不够，于是连广播都省了。
"""
import asyncio
import json
import sys

import requests
import websockets

WS_URL = "ws://127.0.0.1:8000/ws/live2d"
CHAT_URL = "http://127.0.0.1:8000/v1/chat/completions"


async def main() -> None:
    text = sys.argv[1] if len(sys.argv) > 1 else "我刚才一直在偷偷看你"
    loop = asyncio.get_event_loop()

    async with websockets.connect(WS_URL, open_timeout=10) as ws:
        await ws.send(json.dumps({"type": "hello"}))
        print("hello ->", await ws.recv())

        async def fire() -> None:
            await asyncio.sleep(0.5)
            print(f"发消息: {text!r}（本地模型要算一会儿）")
            response = await loop.run_in_executor(
                None,
                lambda: requests.post(
                    CHAT_URL,
                    json={
                        "model": "ling-muxue",
                        "messages": [{"role": "user", "content": text}],
                    },
                    timeout=300,
                ),
            )
            payload = response.json()
            reply = payload.get("choices", [{}])[0].get("message", {}).get("content")
            print("她的回复:", reply)

        task = asyncio.create_task(fire())
        try:
            while True:
                message = await asyncio.wait_for(ws.recv(), timeout=60)
                print("WS <-", message)
        except asyncio.TimeoutError:
            print("60 秒内没有再收到任何 WS 消息")
        await task


if __name__ == "__main__":
    asyncio.run(main())

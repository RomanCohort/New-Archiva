"""不碰 Cli、不碰记忆，单独跑一遍情绪管线，看它到底判出什么 intensity。

为什么要这个：/ws/live2d 上推不推 emotion_updated，取决于
`emotion_params.get_live2d_params()` 里那句
`if intensity < LOW_INTENSITY_THRESHOLD: return {}` —— 也就是 0.2 这条线。
情绪认出来了但强度不够，广播就被省掉了，前端看起来像「联动没做」。

用法（character-chat 的 venv）：
    $env:PYTHONUTF8=1
    .venv\\Scripts\\python.exe ..\\tools\\emotion_probe.py
"""
import sys

sys.path.insert(0, "src")

from character_chat.emotion.pipeline import EmotionPipeline  # noqa: E402
from character_chat.live2d.emotion_params import LOW_INTENSITY_THRESHOLD, get_live2d_params  # noqa: E402

SAMPLES = [
    "我刚才一直在偷偷看你",
    "你今天好温柔啊",
    "学长你好烦啊，别理我",
    "我好喜欢你",
    "哈哈哈哈这也太好笑了",
]


def main() -> None:
    # 神经分类器要 torch，本机没装 —— 走规则 + 标签那条路，和线上部署的降级路径一致
    pipeline = EmotionPipeline(neural_enabled=False)
    print(f"LOW_INTENSITY_THRESHOLD = {LOW_INTENSITY_THRESHOLD}\n")
    for text in SAMPLES:
        result = pipeline.process(text, context=[])
        label = result.reconciled_label.value
        intensity = float(result.reconciled_intensity or 0.0)
        params = get_live2d_params(label, intensity)
        flag = "会推" if params else "不推（强度不够）"
        print(f"{text} -> label={label} intensity={intensity:.3f} conf={float(result.confidence or 0):.3f} [{flag}]")
        if params:
            print(f"    params={params}")


if __name__ == "__main__":
    main()

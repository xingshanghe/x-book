from __future__ import annotations

import io
import wave


def inspect_wav(data: bytes, transcript: str) -> tuple[bytes, str, float] | str:
    """返回 (wav, 对齐文本, 质量) 或一句失败原因。失败时调用方不得扣次数。"""
    if not data.startswith(b"RIFF"):
        return "请上传 wav"
    text = transcript.strip()
    if not text:
        return "暂不能为这段音频生成对齐文本"
    try:
        with wave.open(io.BytesIO(data), "rb") as src:
            channels = src.getnchannels()
            width = src.getsampwidth()
            rate = src.getframerate()
            frames = src.readframes(src.getnframes())
    except wave.Error:
        return "请上传 wav"
    if width != 2 or channels not in (1, 2) or rate <= 0:
        return "请上传 16-bit wav"
    samples = _mono_samples(frames, channels, width)
    duration = len(samples) / rate
    if duration < 5:
        return "太短"
    if duration > 15:
        return "录音需要落在 5 到 15 秒，才好和文本对齐"
    if _clipped(samples):
        return "太吵"
    if _sounds_like_two_speakers(samples, rate):
        return "像多人"
    rms = _rms(samples)
    if rms < 200:
        return "太短"
    quality = min(1.0, rms / 4000)
    return data, text, round(quality, 3)


def _mono_samples(frames: bytes, channels: int, width: int) -> list[int]:
    step = width * channels
    out: list[int] = []
    for index in range(0, len(frames) - step + 1, step):
        total = 0
        for channel in range(channels):
            start = index + channel * width
            total += int.from_bytes(frames[start : start + width], "little", signed=True)
        out.append(total // channels)
    return out


def _rms(samples: list[int]) -> float:
    if not samples:
        return 0
    return (sum(sample * sample for sample in samples) / len(samples)) ** 0.5


def _clipped(samples: list[int]) -> bool:
    if not samples:
        return False
    hot = sum(1 for sample in samples if abs(sample) >= 32_000)
    return hot / len(samples) > 0.01


def _sounds_like_two_speakers(samples: list[int], rate: int) -> bool:
    frame = max(1, rate // 5)
    loud = [_rms(samples[index : index + frame]) > 800 for index in range(0, len(samples), frame)]
    islands = 0
    gap = 0
    in_loud = False
    for flag in loud:
        if flag:
            if not in_loud and gap >= 4:
                islands += 1
            elif not in_loud and islands == 0:
                islands = 1
            in_loud = True
            gap = 0
        else:
            in_loud = False
            gap += 1
    return islands >= 2

import { describe, expect, it } from 'vitest';
import { readVoicePack, type VoicePackSource } from '@/tts/voicePack';

describe('音色包文件夹', () => {
  it('用文件夹名和 txt 组成音色，不要求手填', async () => {
    const pack = await readVoicePack([
      source('妈妈/voice.wav', wav(8)),
      source('妈妈/voice.txt', '今晚的风从江面过来。'),
      source('妈妈/.DS_Store', 'junk'),
    ]);
    expect(pack.name).toBe('妈妈');
    expect(pack.refText).toBe('今晚的风从江面过来。');
    expect(pack.lang).toBe('zh');
    expect(pack.wav.type).toBe('audio/wav');
    expect(pack.wav.size).toBeGreaterThan(44);
  });

  it('voice.json 里的名称和对齐文本优先于文件夹', async () => {
    const pack = await readVoicePack([
      source('下载/voice.wav', wav(6)),
      source(
        '下载/voice.json',
        JSON.stringify({ name: '雷军', refText: '我考上了武汉大学。', lang: 'zh' }),
      ),
      source('下载/readme.txt', '这份说明不要当成对齐文本'),
    ]);
    expect(pack.name).toBe('雷军');
    expect(pack.refText).toBe('我考上了武汉大学。');
  });

  it('没有文件夹时用 wav 文件名', async () => {
    const pack = await readVoicePack([source('阿姨.wav', wav(5, 2)), source('阿姨.txt', '你好。')]);
    expect(pack.name).toBe('阿姨');
  });

  it('缺文件或格式不对时说明原因', async () => {
    await expect(readVoicePack([source('妈妈/voice.txt', '只有字')])).rejects.toThrow(
      '需要一份 wav',
    );
    await expect(
      readVoicePack([source('妈妈/a.wav', wav(8)), source('妈妈/b.wav', wav(8))]),
    ).rejects.toThrow('只能有一份 wav');
    await expect(readVoicePack([source('妈妈/voice.wav', wav(8))])).rejects.toThrow('对齐文本');
    await expect(
      readVoicePack([
        source('妈妈/voice.wav', wav(8)),
        source('妈妈/a.txt', '甲'),
        source('妈妈/b.txt', '乙'),
      ]),
    ).rejects.toThrow('只能有一份');
    await expect(
      readVoicePack([source('妈妈/voice.wav', wav(8)), source('妈妈/voice.txt', '  ')]),
    ).rejects.toThrow('不能为空');
    await expect(
      readVoicePack([source('妈妈/voice.wav', wav(1)), source('妈妈/voice.txt', '太短')]),
    ).rejects.toThrow('5 到 15 秒');
    await expect(
      readVoicePack([
        source('妈妈/voice.wav', new Uint8Array([1, 2, 3])),
        source('妈妈/voice.txt', '不是 wav'),
      ]),
    ).rejects.toThrow('请选择 wav');
    await expect(
      readVoicePack([
        source('妈妈/voice.wav', wav(8), 4 * 1024 * 1024),
        source('妈妈/voice.txt', '太大'),
      ]),
    ).rejects.toThrow('3 MB');
  });
});

function source(path: string, body: Uint8Array | string, size = -1): VoicePackSource {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const name = path.split('/').pop() ?? path;
  return {
    name,
    path,
    size: size >= 0 ? size : bytes.byteLength,
    readText: async () => new TextDecoder().decode(bytes),
    readBytes: async () => bytes,
  };
}

function wav(seconds: number, channels = 1): Uint8Array {
  const rate = 16_000;
  const dataSize = Math.round(seconds * rate) * channels * 2;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  write(bytes, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  write(bytes, 8, 'WAVE');
  write(bytes, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(bytes, 36, 'data');
  view.setUint32(40, dataSize, true);
  return bytes;
}

function write(bytes: Uint8Array, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1)
    bytes[offset + index] = text.charCodeAt(index);
}

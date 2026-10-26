import { describe, expect, it } from 'vitest';
import { micErrorMessage, packFromMic, RECORD_SCRIPT } from '@/tts/micCapture';

describe('麦克风录成 16-bit', () => {
  it('按读的那段话生成单声道 16-bit wav', async () => {
    const pack = packFromMic({
      name: ' 我的声音 ',
      samples: new Float32Array(8 * 16_000),
      sampleRate: 16_000,
    });
    expect(pack.name).toBe('我的声音');
    expect(pack.refText).toBe(RECORD_SCRIPT);
    expect(pack.lang).toBe('zh');
    const bytes = new Uint8Array(await pack.wav.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint16(34, true)).toBe(16);
    expect(bytes.length).toBe(44 + 8 * 16_000 * 2);
  });

  it('不够 5 秒不能保存，超过 15 秒只留前面一段', () => {
    expect(() =>
      packFromMic({ name: '短', samples: new Float32Array(4 * 8_000), sampleRate: 8_000 }),
    ).toThrow('5 到 15 秒');
    const pack = packFromMic({
      name: '长',
      samples: new Float32Array(20 * 8_000),
      sampleRate: 8_000,
    });
    expect(pack.wav.size).toBe(44 + 15 * 8_000 * 2);
  });

  it('没有名称或没有声音时说明原因', () => {
    expect(() =>
      packFromMic({ name: '  ', samples: new Float32Array(8 * 8_000), sampleRate: 8_000 }),
    ).toThrow('请填写音色名称');
    expect(() =>
      packFromMic({ name: '空', samples: new Float32Array(0), sampleRate: 8_000 }),
    ).toThrow('没有录到声音');
  });

  it('权限被拒绝时告诉用户去系统设置打开', () => {
    expect(
      micErrorMessage(Object.assign(new Error('denied'), { name: 'NotAllowedError' })),
    ).toContain('系统设置');
    expect(micErrorMessage(Object.assign(new Error('missing'), { name: 'NotFoundError' }))).toBe(
      '没有找到麦克风',
    );
  });
});

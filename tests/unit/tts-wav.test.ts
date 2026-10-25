import { describe, expect, it } from 'vitest';
import { encodeWavPcm16, mixToMono, wavBlobFromBase64 } from '@/tts/wav';

describe('试读转 wav', () => {
  it('写出 RIFF 头和 16-bit 单声道', async () => {
    const samples = new Float32Array([0, 0.5, -0.5]);
    const blob = encodeWavPcm16(samples, 16_000);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('WAVE');
    expect(bytes.length).toBe(44 + samples.length * 2);
  });

  it('能从服务端的 base64 还原 wav', async () => {
    const blob = wavBlobFromBase64(btoa('RIFF'));
    const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()));
    expect(text).toBe('RIFF');
  });

  it('多声道合成单声道', () => {
    const mixed = mixToMono([new Float32Array([0.2, 0.4]), new Float32Array([0.4, 0.8])]);
    expect(mixed[0]).toBeCloseTo(0.3);
    expect(mixed[1]).toBeCloseTo(0.6);
  });
});

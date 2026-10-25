/** 把单声道采样写成 16-bit PCM wav。试读在浏览器里先录到内存，再转成服务端能校验的 wav。 */

export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const data = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(data);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return new Blob([data], { type: 'audio/wav' });
}

export function mixToMono(channels: Float32Array[]): Float32Array {
  const length = channels[0]?.length ?? 0;
  const mixed = new Float32Array(length);
  if (channels.length === 0 || length === 0) return mixed;
  for (let index = 0; index < length; index += 1) {
    let total = 0;
    for (const channel of channels) total += channel[index] ?? 0;
    mixed[index] = total / channels.length;
  }
  return mixed;
}

export function wavBlobFromBase64(value: string): Blob {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

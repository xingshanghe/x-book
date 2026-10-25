/** 把 wav 字节交给 Web Audio。没有扬声器时由调用方注入别的 play。 */

let shared: AudioContext | null = null;

function audioContext(): AudioContext {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('当前环境不能播放音频');
  if (!shared || shared.state === 'closed') shared = new Ctx();
  return shared;
}

/** 在点击回调里同步调用，避免等合成结束之后浏览器把音频挂起。 */
export function primePlayback(): void {
  try {
    const ctx = audioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* 真正播放时再报错 */
  }
}

export async function playWavBytes(bytes: Uint8Array, signal?: AbortSignal): Promise<number> {
  const ctx = audioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  if (ctx.state === 'suspended') throw new Error('系统没有允许播放');
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const audio = await ctx.decodeAudioData(copy);
  if (signal?.aborted) return 0;
  const source = ctx.createBufferSource();
  source.buffer = audio;
  source.connect(ctx.destination);
  const durationMs = Math.round(audio.duration * 1000);
  await new Promise<void>((resolve) => {
    const finish = () => resolve();
    source.onended = finish;
    signal?.addEventListener('abort', () => {
      try {
        source.stop();
      } catch {
        /* 已经停了 */
      }
      finish();
    });
    source.start();
  });
  return durationMs;
}

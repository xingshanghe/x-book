/** 把 wav 字节交给 Web Audio。没有扬声器时由调用方注入别的 play。 */

export async function playWavBytes(bytes: Uint8Array, signal?: AbortSignal): Promise<number> {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) throw new Error('当前环境不能播放音频');
  const ctx = new Ctx();
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const audio = await ctx.decodeAudioData(copy);
  if (signal?.aborted) {
    await ctx.close();
    return 0;
  }
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
  await ctx.close();
  return durationMs;
}

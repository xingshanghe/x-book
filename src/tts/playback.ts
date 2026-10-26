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

/** 录音和朗读共用这一份。调用方不要 close：关掉之后，这一页后面的朗读会没有声音。 */
export function sharedAudioContext(): AudioContext {
  return audioContext();
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

export interface PlaybackLive {
  onProgress?: (ratio: number) => void;
  isPaused?: () => boolean;
}

export async function playWavBytes(
  bytes: Uint8Array,
  signal?: AbortSignal,
  speed = 1,
  live?: PlaybackLive,
): Promise<number> {
  const ctx = audioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  if (ctx.state === 'suspended') throw new Error('系统没有允许播放');
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const audio = await ctx.decodeAudioData(copy);
  if (signal?.aborted) return 0;
  const rate = Math.min(1.15, Math.max(0.85, speed));
  if (live?.onProgress || live?.isPaused) return playAcross(ctx, audio, rate, signal, live);
  const source = ctx.createBufferSource();
  source.buffer = audio;
  source.playbackRate.value = rate;
  source.connect(ctx.destination);
  const durationMs = Math.round((audio.duration * 1000) / rate);
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

/** 一段里有多句时，暂停要停住声音，并按进度把高亮移到对应的一句。单句仍走原来的播放。 */
async function playAcross(
  ctx: AudioContext,
  audio: AudioBuffer,
  rate: number,
  signal: AbortSignal | undefined,
  live: PlaybackLive,
): Promise<number> {
  const total = audio.duration;
  if (total <= 0) return 0;
  let offset = 0;
  while (offset < total && (offset === 0 || total - offset >= 0.03)) {
    if (signal?.aborted) break;
    while (live.isPaused?.()) {
      if (signal?.aborted) return durationOf(total, rate);
      await wait(30);
    }
    if (signal?.aborted) break;
    const next = await playSlice(ctx, audio, rate, offset, total, signal, live);
    if (signal?.aborted) break;
    if (live.isPaused?.()) {
      offset = next;
      continue;
    }
    break;
  }
  return durationOf(total, rate);
}

function playSlice(
  ctx: AudioContext,
  audio: AudioBuffer,
  rate: number,
  offset: number,
  total: number,
  signal: AbortSignal | undefined,
  live: PlaybackLive,
): Promise<number> {
  const source = ctx.createBufferSource();
  source.buffer = audio;
  source.playbackRate.value = rate;
  source.connect(ctx.destination);
  const startAt = ctx.currentTime;
  let pausedCut = false;
  live.onProgress?.(offset / total);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (next: number) => {
      if (settled) return;
      settled = true;
      window.clearInterval(timer);
      resolve(Math.min(total, Math.max(offset, next)));
    };
    const timer = window.setInterval(() => {
      const pos = position(startAt, ctx, rate, offset, total);
      live.onProgress?.(pos / total);
      if (signal?.aborted) {
        stopSource(source);
        finish(pos);
        return;
      }
      if (live.isPaused?.()) {
        pausedCut = true;
        stopSource(source);
        finish(pos);
      }
    }, 80);
    source.onended = () => {
      const pos = position(startAt, ctx, rate, offset, total);
      finish(pausedCut || live.isPaused?.() ? pos : total);
    };
    signal?.addEventListener(
      'abort',
      () => {
        stopSource(source);
        finish(position(startAt, ctx, rate, offset, total));
      },
      { once: true },
    );
    try {
      source.start(0, Math.min(offset, Math.max(0, total - 0.01)));
    } catch {
      finish(offset);
    }
  });
}

function position(
  startAt: number,
  ctx: AudioContext,
  rate: number,
  offset: number,
  total: number,
): number {
  const elapsed = Math.max(0, (ctx.currentTime - startAt) * rate);
  return Math.min(total, offset + elapsed);
}

function durationOf(total: number, rate: number): number {
  return Math.round((total * 1000) / rate);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stopSource(source: AudioBufferSourceNode): void {
  try {
    source.stop();
  } catch {
    /* 已经停了 */
  }
}

import { joinUtterance, partIndexAtRatio } from './spoken';
import { IDLE_PLAYER, type PlayerSnapshot } from './types';

const SLOW_RATIO = 1.3;
/** 还剩这么多句时就去取后面的正文，避免读到段末才发现没有下文。 */
const PULL_AHEAD = 6;
/** 当前句加上后面这么多句一起排队合成。本机同时只跑两路，第三句排上就接着做。 */
const PREFETCH_AHEAD = 2;

export interface SentencePlayer {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  readonly state: PlayerSnapshot;
}

export interface SpeechLive {
  /** 0 到 1，整段音频里的位置。一段里有多句时用来移动高亮。 */
  onProgress?: (ratio: number) => void;
  /** 为真时停住当前这段声音，变假后再从原处接着播。只有一段里含着多句才传。 */
  isPaused?: () => boolean;
}

/**
 * 逐句播放。开始读某一句时，把后面两句也排进合成。
 * 传入 groupAt 时，第一声之后可以把同一段里的短句合成一次；没传时仍是一句一次。
 * 临近末尾时补进后续句子，所以一段读完会继续往下，直到调用方不再提供，或用户停止。
 * 合成已经赶在播放前面时，句后留一点停顿；赶不上时不再加停顿。
 * 合成耗时明显长于音频时长时，记下句间停顿说明，不改走网络。
 */
export function createSentencePlayer(opts: {
  sentences: readonly string[];
  synth: (sentence: string) => Promise<Uint8Array>;
  play: (audio: Uint8Array, signal?: AbortSignal, live?: SpeechLive) => Promise<number>;
  onChange?: (state: PlayerSnapshot) => void;
  /** 这一句播完后希望留出的毫秒。合成等待已经够长时会自动缩短。 */
  pauseAfter?: (index: number, sentence: string) => number;
  /** 返回空数组表示后面没有了。 */
  pull?: () => Promise<readonly string[]>;
  /**
   * 从 at 起这一次合成几句。firstSound 为真时应当返回 1，按下后不用多等。
   * 不传时每句单独合成。
   */
  groupAt?: (at: number, sentences: readonly string[], firstSound: boolean) => number;
}): SentencePlayer {
  let snapshot: PlayerSnapshot = IDLE_PLAYER;
  let paused = false;
  let stopped = false;
  let active = false;
  let playback = new AbortController();
  const cache = new Map<number, SynthJob>();

  const emit = (next: PlayerSnapshot) => {
    snapshot = next;
    opts.onChange?.(next);
  };

  return {
    get state() {
      return snapshot;
    },
    pause() {
      if (!active && snapshot.status !== 'playing') return;
      paused = true;
      if (snapshot.status === 'playing') {
        emit({ ...snapshot, status: 'paused' });
        return;
      }
      if (snapshot.status === 'idle') {
        emit({ status: 'paused', index: -1, sentence: '', gapNote: null });
      }
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (snapshot.status === 'paused') emit({ ...snapshot, status: 'playing' });
    },
    stop() {
      stopped = true;
      paused = false;
      active = false;
      playback.abort();
      emit(IDLE_PLAYER);
    },
    async start() {
      stopped = false;
      paused = false;
      active = true;
      playback = new AbortController();
      cache.clear();
      const signal = playback.signal;
      let list = [...opts.sentences];
      let exhausted = opts.pull == null;
      let pulling: Promise<void> | null = null;

      const takeCount = (at: number, firstSound: boolean): number => {
        const raw = opts.groupAt?.(at, list, firstSound) ?? 1;
        const room = list.length - at;
        if (!Number.isFinite(raw) || room <= 0) return 1;
        return Math.max(1, Math.min(room, Math.floor(raw)));
      };

      const prefetchFrom = (at: number, firstSound: boolean) => {
        let cursor = at;
        let first = firstSound;
        for (let step = 0; step <= PREFETCH_AHEAD && cursor < list.length; step += 1) {
          const cached = cache.get(cursor);
          const count = cached?.count ?? takeCount(cursor, first);
          if (!cached) {
            const text = joinUtterance(list.slice(cursor, cursor + count));
            cache.set(cursor, { count, audio: opts.synth(text) });
          }
          first = false;
          cursor += count;
        }
      };

      const ensure = (at: number) => {
        if (exhausted || pulling || stopped || !opts.pull) return;
        if (list.length - at > PULL_AHEAD) return;
        const job = opts
          .pull()
          .then((more) => {
            if (stopped) return;
            if (more.length === 0) exhausted = true;
            else list = [...list, ...more];
          })
          .finally(() => {
            if (pulling === job) pulling = null;
          });
        pulling = job;
      };

      try {
        let index = 0;
        let heard = false;
        while (index < list.length || pulling != null) {
          if (stopped) return;
          ensure(index);
          if (index >= list.length) {
            if (pulling == null) break;
            await pulling;
            if (stopped) return;
            if (index >= list.length) break;
          }
          if (list[index] == null) break;
          const done = await speakOne({
            index,
            firstSound: !heard,
            signal,
            list,
            prefetchFrom,
            getJob: () => cache.get(index),
            getGapNote: () => snapshot.gapNote,
            pauseAfter: opts.pauseAfter ?? (() => 0),
            play: opts.play,
            emit,
            isPaused: () => paused,
            isStopped: () => stopped,
          });
          if (done === 'stop') return;
          if (done === 'missing') break;
          heard = true;
          index += done;
        }
        if (!stopped) emit(IDLE_PLAYER);
      } finally {
        active = false;
      }
    },
  };
}

interface SynthJob {
  count: number;
  audio: Promise<Uint8Array>;
}

async function speakOne(args: {
  index: number;
  firstSound: boolean;
  signal: AbortSignal;
  list: readonly string[];
  prefetchFrom: (at: number, firstSound: boolean) => void;
  getJob: () => SynthJob | undefined;
  getGapNote: () => string | null;
  pauseAfter: (index: number, sentence: string) => number;
  play: (audio: Uint8Array, signal?: AbortSignal, live?: SpeechLive) => Promise<number>;
  emit: (next: PlayerSnapshot) => void;
  isPaused: () => boolean;
  isStopped: () => boolean;
}): Promise<number | 'stop' | 'missing'> {
  if (await hold(args.isPaused, args.isStopped)) return 'stop';
  args.prefetchFrom(args.index, args.firstSound);
  const started = nowMs();
  const job = args.getJob();
  if (!job) return 'missing';
  const audio = await job.audio;
  const synthMs = nowMs() - started;
  if (args.isStopped()) return 'stop';
  if (await hold(args.isPaused, args.isStopped)) return 'stop';
  const parts = args.list.slice(args.index, args.index + job.count);
  const sentence = parts[0];
  if (!sentence) return 'missing';
  let shown = args.index;
  const emitAt = (part: number, status: PlayerSnapshot['status'], gapNote: string | null) => {
    shown = args.index + part;
    args.emit({
      status,
      index: shown,
      sentence: parts[part] ?? sentence,
      gapNote,
    });
  };
  // 等这一句的声音要响了再报出去，高亮才跟得上耳朵听到的那句。
  emitAt(0, 'playing', args.getGapNote());
  const lengths = parts.map((part) => Array.from(part).length);
  const durationMs = await args.play(
    audio,
    args.signal,
    parts.length > 1
      ? {
          isPaused: args.isPaused,
          onProgress: (ratio) => {
            const part = partIndexAtRatio(lengths, ratio);
            if (args.index + part === shown) return;
            emitAt(part, args.isPaused() ? 'paused' : 'playing', args.getGapNote());
          },
        }
      : undefined,
  );
  if (args.isStopped()) return 'stop';
  const gapNote =
    synthMs > durationMs * SLOW_RATIO ? '这台设备合成偏慢，句与句之间会稍作停顿。' : null;
  const current = parts[shown - args.index] ?? sentence;
  if (args.isPaused()) {
    emitAt(shown - args.index, 'paused', gapNote);
    if (await hold(args.isPaused, args.isStopped)) return 'stop';
  } else if (gapNote !== args.getGapNote()) {
    emitAt(shown - args.index, 'playing', gapNote);
  }
  const last = args.index + parts.length - 1;
  const want = args.pauseAfter(last, parts[parts.length - 1] ?? current);
  const slack = Math.max(0, want - synthMs);
  if (slack > 0 && (await pauseFor(slack, args.isStopped))) return 'stop';
  return parts.length;
}

async function pauseFor(ms: number, isStopped: () => boolean): Promise<boolean> {
  const end = nowMs() + ms;
  while (nowMs() < end) {
    if (isStopped()) return true;
    await delay(Math.min(20, end - nowMs()));
  }
  return isStopped();
}

async function hold(isPaused: () => boolean, isStopped: () => boolean): Promise<boolean> {
  while (isPaused() && !isStopped()) await delay(20);
  return isStopped();
}

function nowMs(): number {
  return Date.now();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

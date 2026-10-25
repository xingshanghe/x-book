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

/**
 * 逐句播放。开始读某一句时，把后面两句也排进合成。
 * 临近末尾时补进后续句子，所以一段读完会继续往下，直到调用方不再提供，或用户停止。
 * 合成已经赶在播放前面时，句后留一点停顿；赶不上时不再加停顿。
 * 合成耗时明显长于音频时长时，记下句间停顿说明，不改走网络。
 */
export function createSentencePlayer(opts: {
  sentences: readonly string[];
  synth: (sentence: string) => Promise<Uint8Array>;
  play: (audio: Uint8Array, signal?: AbortSignal) => Promise<number>;
  onChange?: (state: PlayerSnapshot) => void;
  /** 这一句播完后希望留出的毫秒。合成等待已经够长时会自动缩短。 */
  pauseAfter?: (index: number, sentence: string) => number;
  /** 返回空数组表示后面没有了。 */
  pull?: () => Promise<readonly string[]>;
}): SentencePlayer {
  let snapshot: PlayerSnapshot = IDLE_PLAYER;
  let paused = false;
  let stopped = false;
  let playback = new AbortController();
  const cache = new Map<number, Promise<Uint8Array>>();

  const emit = (next: PlayerSnapshot) => {
    snapshot = next;
    opts.onChange?.(next);
  };

  return {
    get state() {
      return snapshot;
    },
    pause() {
      if (snapshot.status !== 'playing') return;
      paused = true;
      emit({ ...snapshot, status: 'paused' });
    },
    resume() {
      if (!paused) return;
      paused = false;
      if (snapshot.status === 'paused') emit({ ...snapshot, status: 'playing' });
    },
    stop() {
      stopped = true;
      paused = false;
      playback.abort();
      emit(IDLE_PLAYER);
    },
    async start() {
      stopped = false;
      paused = false;
      playback = new AbortController();
      cache.clear();
      const signal = playback.signal;
      let list = [...opts.sentences];
      let exhausted = opts.pull == null;
      let pulling: Promise<void> | null = null;

      const prefetch = (at: number) => {
        if (at < 0 || at >= list.length || cache.has(at)) return;
        cache.set(at, opts.synth(list[at]));
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

      for (let index = 0; index < list.length || pulling != null; index++) {
        if (stopped) return;
        ensure(index);
        if (index >= list.length) {
          if (pulling == null) break;
          await pulling;
          if (stopped) return;
          if (index >= list.length) break;
        }
        const sentence = list[index];
        if (sentence == null) break;
        const done = await speakOne({
          index,
          sentence,
          signal,
          prefetch,
          getPending: () => cache.get(index),
          getGapNote: () => snapshot.gapNote,
          pauseAfter: opts.pauseAfter ?? (() => 0),
          play: opts.play,
          emit,
          isPaused: () => paused,
          isStopped: () => stopped,
        });
        if (done === 'stop') return;
        if (done === 'missing') break;
      }
      if (!stopped) emit(IDLE_PLAYER);
    },
  };
}

async function speakOne(args: {
  index: number;
  sentence: string;
  signal: AbortSignal;
  prefetch: (at: number) => void;
  getPending: () => Promise<Uint8Array> | undefined;
  getGapNote: () => string | null;
  pauseAfter: (index: number, sentence: string) => number;
  play: (audio: Uint8Array, signal?: AbortSignal) => Promise<number>;
  emit: (next: PlayerSnapshot) => void;
  isPaused: () => boolean;
  isStopped: () => boolean;
}): Promise<'next' | 'stop' | 'missing'> {
  if (await hold(args.isPaused, args.isStopped)) return 'stop';
  args.emit({
    status: 'playing',
    index: args.index,
    sentence: args.sentence,
    gapNote: args.getGapNote(),
  });
  for (let step = 0; step <= PREFETCH_AHEAD; step += 1) args.prefetch(args.index + step);
  const started = nowMs();
  const pending = args.getPending();
  if (!pending) return 'missing';
  const audio = await pending;
  const synthMs = nowMs() - started;
  if (args.isStopped()) return 'stop';
  if (await hold(args.isPaused, args.isStopped)) return 'stop';
  const durationMs = await args.play(audio, args.signal);
  if (args.isStopped()) return 'stop';
  const gapNote =
    synthMs > durationMs * SLOW_RATIO ? '这台设备合成偏慢，句与句之间会稍作停顿。' : null;
  if (args.isPaused()) {
    args.emit({ status: 'paused', index: args.index, sentence: args.sentence, gapNote });
    if (await hold(args.isPaused, args.isStopped)) return 'stop';
  } else if (gapNote !== args.getGapNote()) {
    args.emit({ status: 'playing', index: args.index, sentence: args.sentence, gapNote });
  }
  const want = args.pauseAfter(args.index, args.sentence);
  const slack = Math.max(0, want - synthMs);
  if (slack > 0 && (await pauseFor(slack, args.isStopped))) return 'stop';
  return 'next';
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

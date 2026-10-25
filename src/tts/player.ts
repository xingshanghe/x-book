import { IDLE_PLAYER, type PlayerSnapshot } from './types';

const SLOW_RATIO = 1.3;

export interface SentencePlayer {
  start(): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
  readonly state: PlayerSnapshot;
}

/**
 * 逐句播放。播第 N 句时预合成第 N+1 句。
 * 合成耗时明显长于音频时长时，记下句间停顿说明，不改走网络。
 */
export function createSentencePlayer(opts: {
  sentences: readonly string[];
  synth: (sentence: string) => Promise<Uint8Array>;
  play: (audio: Uint8Array) => Promise<number>;
  onChange?: (state: PlayerSnapshot) => void;
}): SentencePlayer {
  let snapshot: PlayerSnapshot = IDLE_PLAYER;
  let paused = false;
  let stopped = false;
  const cache = new Map<number, Promise<Uint8Array>>();

  const emit = (next: PlayerSnapshot) => {
    snapshot = next;
    opts.onChange?.(next);
  };

  const prefetch = (index: number) => {
    if (index < 0 || index >= opts.sentences.length || cache.has(index)) return;
    cache.set(index, opts.synth(opts.sentences[index]));
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
      paused = false;
    },
    stop() {
      stopped = true;
      paused = false;
      emit(IDLE_PLAYER);
    },
    async start() {
      stopped = false;
      paused = false;
      for (let index = 0; index < opts.sentences.length; index++) {
        if (stopped) return;
        while (paused && !stopped) {
          await delay(20);
        }
        if (stopped) return;

        const sentence = opts.sentences[index];
        emit({ status: 'playing', index, sentence, gapNote: snapshot.gapNote });
        prefetch(index);
        prefetch(index + 1);
        const started = nowMs();
        const pending = cache.get(index);
        if (!pending) return;
        const audio = await pending;
        const synthMs = nowMs() - started;
        if (stopped) return;
        while (paused && !stopped) await delay(20);
        if (stopped) return;
        const durationMs = await opts.play(audio);
        if (stopped) return;
        const gapNote =
          synthMs > durationMs * SLOW_RATIO
            ? '这台设备合成偏慢，句与句之间会稍作停顿。'
            : snapshot.gapNote;
        if (paused) {
          emit({ status: 'paused', index, sentence, gapNote });
          while (paused && !stopped) await delay(20);
          if (stopped) return;
        } else if (gapNote !== snapshot.gapNote) {
          emit({ status: 'playing', index, sentence, gapNote });
        }
      }
      if (!stopped) emit(IDLE_PLAYER);
    },
  };
}

function nowMs(): number {
  return Date.now();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

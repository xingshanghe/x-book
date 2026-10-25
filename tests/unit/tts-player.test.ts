import { describe, expect, it } from 'vitest';
import { createSentencePlayer } from '@/tts/player';

const sentences = ['甲。', '乙。', '丙。'];

describe('朗读状态机', () => {
  it('按句前进，结束后回到空闲', async () => {
    const seen: number[] = [];
    const player = createSentencePlayer({
      sentences,
      synth: async () => new Uint8Array([1]),
      play: async () => {
        return 20;
      },
      onChange: (state) => {
        if (state.status === 'playing') seen.push(state.index);
      },
    });
    await player.start();
    expect(seen).toEqual([0, 1, 2]);
    expect(player.state.status).toBe('idle');
    expect(player.state.index).toBe(-1);
  });

  it('暂停停在当前句，停止后不再往后读', async () => {
    const gate: { open: (() => void) | null } = { open: null };
    const player = createSentencePlayer({
      sentences,
      synth: async () => new Uint8Array([1]),
      play: () =>
        new Promise((resolve) => {
          gate.open = () => resolve(30);
        }),
    });
    const pending = player.start();
    await waitUntil(() => player.state.status === 'playing');
    player.pause();
    expect(player.state.status).toBe('paused');
    expect(player.state.index).toBe(0);
    expect(player.state.sentence).toBe('甲。');
    gate.open?.();
    await waitUntil(() => player.state.status === 'paused' && player.state.index === 0);
    player.stop();
    await pending;
    expect(player.state.status).toBe('idle');
  });

  it('播放第一句时会再提前合成两句', async () => {
    const started: string[] = [];
    const gate: { open: (() => void) | null } = { open: null };
    const player = createSentencePlayer({
      sentences: ['甲。', '乙。', '丙。', '丁。'],
      synth: async (sentence) => {
        started.push(sentence);
        return new Uint8Array([1]);
      },
      play: () =>
        new Promise((resolve) => {
          gate.open = () => resolve(10);
        }),
    });
    const pending = player.start();
    await waitUntil(() => started.length >= 3);
    expect(started.slice(0, 3)).toEqual(['甲。', '乙。', '丙。']);
    expect(started).not.toContain('丁。');
    player.stop();
    gate.open?.();
    await pending;
  });

  it('合成已经完成时，句后留出停顿', async () => {
    const player = createSentencePlayer({
      sentences: ['甲。'],
      synth: async () => new Uint8Array([1]),
      play: async () => 1,
      pauseAfter: () => 70,
    });
    const started = Date.now();
    await player.start();
    expect(Date.now() - started).toBeGreaterThanOrEqual(60);
  });

  it('合成本身已经等得够久时，不再额外停顿', async () => {
    const player = createSentencePlayer({
      sentences: ['甲。'],
      synth: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return new Uint8Array([1]);
      },
      play: async () => 1,
      pauseAfter: () => 10,
    });
    const started = Date.now();
    await player.start();
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('播放当前句时已经开始合成下一句', async () => {
    const started: string[] = [];
    const gate: { open: (() => void) | null } = { open: null };
    const player = createSentencePlayer({
      sentences,
      synth: async (sentence) => {
        started.push(sentence);
        return new Uint8Array([1]);
      },
      play: () =>
        new Promise((resolve) => {
          gate.open = () => resolve(10);
        }),
    });
    const pending = player.start();
    await waitUntil(() => started.length >= 2);
    expect(started.slice(0, 2)).toEqual(['甲。', '乙。']);
    player.stop();
    gate.open?.();
    await pending;
  });

  it('读完已有的句子后继续读补进来的句子', async () => {
    const seen: string[] = [];
    let pulled = false;
    const player = createSentencePlayer({
      sentences: ['甲。'],
      synth: async (sentence) => {
        seen.push(sentence);
        return new Uint8Array([1]);
      },
      play: async () => 1,
      pull: async () => {
        if (pulled) return [];
        pulled = true;
        return ['乙。', '丙。'];
      },
    });
    await player.start();
    expect(seen).toEqual(['甲。', '乙。', '丙。']);
    expect(player.state.status).toBe('idle');
  });

  it('后面没有句子时读完当前这句就停', async () => {
    const player = createSentencePlayer({
      sentences: ['甲。'],
      synth: async () => new Uint8Array([1]),
      play: async () => 1,
      pull: async () => [],
    });
    await player.start();
    expect(player.state.status).toBe('idle');
    expect(player.state.index).toBe(-1);
  });

  it('停止时中断当前这句，不再往下读', async () => {
    const played: number[] = [];
    let signal: AbortSignal | undefined;
    const player = createSentencePlayer({
      sentences: ['甲。', '乙。'],
      synth: async () => new Uint8Array([1]),
      play: (_audio, next) =>
        new Promise((resolve) => {
          played.push(played.length);
          signal = next;
          next?.addEventListener('abort', () => resolve(0));
        }),
    });
    const pending = player.start();
    await waitUntil(() => signal != null);
    player.stop();
    await pending;
    expect(signal?.aborted).toBe(true);
    expect(played).toEqual([0]);
    expect(player.state.status).toBe('idle');
  });

  it('合成明显慢于音频时长时记下句间停顿', async () => {
    const notes: Array<string | null> = [];
    const player = createSentencePlayer({
      sentences: ['甲。'],
      synth: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return new Uint8Array([1]);
      },
      play: async () => 10,
      onChange: (state) => notes.push(state.gapNote),
    });
    await player.start();
    expect(notes).toContain('这台设备合成偏慢，句与句之间会稍作停顿。');
  });
});

async function waitUntil(pred: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('条件没有在时间内成立');
}

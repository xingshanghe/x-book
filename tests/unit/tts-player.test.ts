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

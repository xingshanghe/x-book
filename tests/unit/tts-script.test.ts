import { describe, expect, it } from 'vitest';
import type { BlockIndexView } from '@/core/reader/progress';
import { loadSpokenWindow, readSpokenScript, sentencesFromLines } from '@/tts/script';

describe('连续朗读取句', () => {
  it('从句中停下时，下次仍从这一句开头读，并带上后面的句子', () => {
    const lines = [
      { text: '甲。乙。', char: 100 },
      { text: '丙。', char: 110 },
    ];
    expect(sentencesFromLines(lines, 100).map((item) => item.text)).toEqual([
      '甲。',
      '乙。',
      '丙。',
    ]);
    expect(sentencesFromLines(lines, 101).map((item) => item.charOffset)).toEqual([100, 102, 110]);
    expect(sentencesFromLines(lines, 102).map((item) => item.text)).toEqual(['乙。', '丙。']);
    expect(sentencesFromLines(lines, 100).map((item) => item.paragraphEnd)).toEqual([
      false,
      true,
      true,
    ]);
  });

  it('一次只取窗口里的句子，并给出下一次的起点', async () => {
    const blocks = [['甲。乙。', '丙。'], ['丁。'], ['戊。']];
    const idx = viewOf(blocks);
    const first = await loadSpokenWindow(readOf(blocks), idx, 0, 1);
    expect(first.sentences.map((item) => item.text)).toEqual(['甲。', '乙。', '丙。']);
    expect(first.nextChar).toBe(idx.charOffsets[1]);

    const fromSecond = await loadSpokenWindow(readOf(blocks), idx, first.nextChar ?? 0, 1);
    expect(fromSecond.sentences.map((item) => item.text)).toEqual(['丁。']);
    expect(fromSecond.nextChar).toBe(idx.charOffsets[2]);
  });

  it('停在后一句时不会把前面的句子再读一遍', async () => {
    const blocks = [['甲。乙。', '丙。']];
    const idx = viewOf(blocks);
    const window = await loadSpokenWindow(readOf(blocks), idx, 2, 1);
    expect(window.sentences.map((item) => item.text)).toEqual(['乙。', '丙。']);
    expect(window.nextChar).toBeNull();
  });

  it('空块会跳过，分页符不读', async () => {
    const blocks = [['\f'], ['甲。']];
    const idx = viewOf(blocks);
    const window = await readSpokenScript(readOf(blocks), idx, 0, 1);
    expect(window.sentences.map((item) => item.text)).toEqual(['甲。']);
    expect(window.nextChar).toBeNull();
  });
});

function readOf(blocks: string[][]): (block: number) => Promise<string[]> {
  return (block) => Promise.resolve(blocks[block] ?? []);
}

function viewOf(blocks: string[][]): BlockIndexView {
  const charOffsets: number[] = [];
  const charCounts: number[] = [];
  let cursor = 0;
  for (const lines of blocks) {
    charOffsets.push(cursor);
    let count = 0;
    for (const line of lines) count += line.length + 1;
    charCounts.push(count);
    cursor += count;
  }
  return {
    starts: new Uint32Array(blocks.length),
    charCounts: Uint32Array.from(charCounts),
    charOffsets: Uint32Array.from(charOffsets),
    lineCounts: Uint32Array.from(blocks.map((lines) => lines.length)),
    count: blocks.length,
  };
}

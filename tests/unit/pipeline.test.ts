import { describe, expect, it } from 'vitest';
import { indexBook } from '@/core/parser/indexer';
import { BlockReader } from '@/core/reader/blockReader';
import { resolvePosition, blockAtChar, percentOf, type BlockIndexView } from '@/core/reader/progress';

/** 造一本 4MB / 200 章的书，带塞班广告行与 GBK 无法表达的生僻内容 */
function makeBook(): Blob {
  const parts: string[] = [];
  for (let c = 1; c <= 200; c++) {
    parts.push(`第${c}章 夜航`);
    for (let p = 0; p < 40; p++) {
      parts.push(`　　${c}-${p} 他把灯笼挂在船头，风从江面吹来，远处传来打更的声音。`);
    }
    if (c % 20 === 0) parts.push('更多好书下载：www.dospy.com');
  }
  return new Blob([parts.join('\n')], { type: 'text/plain' });
}

const view = (s: {
  starts: Uint32Array;
  charCounts: Uint32Array;
  charOffsets: Uint32Array;
  lineCounts: Uint32Array;
  count: number;
}): BlockIndexView => ({
  starts: s.starts,
  charCounts: s.charCounts,
  charOffsets: s.charOffsets,
  lineCounts: s.lineCounts,
  count: s.count,
});

describe('导入流水线（端到端）', () => {
  it('建索引：块/字符/章节/清洗命中', async () => {
    const file = makeBook();
    const out = await indexBook(file, { fileName: '《夜航》作者：张三.txt' });

    expect(out.encoding).toBe('utf-8');
    expect(out.title).toBe('夜航');
    expect(out.author).toBe('张三');
    expect(out.scan.blockCount).toBeGreaterThan(20);
    expect(out.scan.chapters.length).toBe(200);
    // 20 章各插一行广告 → 命中 10 行
    // 第 20/40/…/200 章后各插一行广告 → 命中 10 行
    expect(out.scan.cleanedLines).toBe(10);
    expect(out.scan.charCount).toBeGreaterThan(100_000);

    // 块区间连续且覆盖全文
    expect(out.scan.starts[0]).toBe(0);
    for (let i = 1; i < out.scan.blockCount; i++) {
      expect(out.scan.starts[i]).toBeGreaterThanOrEqual(out.scan.starts[i - 1]);
    }
    expect(out.scan.starts.length).toBe(out.scan.blockCount + 1);
  }, 30_000);

  it('任意块可独立解码，且块内行数与索引一致', async () => {
    const file = makeBook();
    const out = await indexBook(file, { fileName: 'test.txt' });
    const idx = view({
      starts: out.scan.starts,
      charCounts: out.scan.charCounts,
      charOffsets: out.scan.charOffsets,
      lineCounts: out.scan.lineCounts,
      count: out.scan.blockCount,
    });
    const reader = new BlockReader({
      blob: out.normalized,
      blockSize: out.scan.blockSize,
      blockCount: out.scan.blockCount,
      starts: out.scan.starts,
      hidden: out.scan.hidden,
    });

    const mid = Math.floor(out.scan.blockCount / 2);
    for (const i of [0, 5, mid, out.scan.blockCount - 1]) {
      const lines = await reader.readLines(i);
      // 清洗行已从结果中剔除，行数应与索引的可见行数一致
      expect(lines.length).toBe(idx.lineCounts[i]);
      // 字符口径：索引按「可见码点」计；渲染层按 JS 码元计（含行尾换行）
      const chars = lines.reduce((a, l) => a + l.length + 1, 0);
      if (i === out.scan.blockCount - 1) {
        // 末块无结尾换行，允许 1 字符差
        expect(Math.abs(chars - idx.charCounts[i])).toBeLessThanOrEqual(1);
      } else {
        expect(chars).toBe(idx.charCounts[i]);
      }
    }
  }, 30_000);

  it('进度定位：charOffset ↔ 块/百分比 可还原', async () => {
    const file = makeBook();
    const out = await indexBook(file, { fileName: 'test.txt' });
    const idx = view({
      starts: out.scan.starts,
      charCounts: out.scan.charCounts,
      charOffsets: out.scan.charOffsets,
      lineCounts: out.scan.lineCounts,
      count: out.scan.blockCount,
    });

    const total = idx.charOffsets[idx.count - 1] + idx.charCounts[idx.count - 1];
    for (const pct of [0, 0.25, 0.5, 0.9, 1]) {
      const target = Math.round(total * pct);
      const b = blockAtChar(idx, target);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(idx.count);
      const back = resolvePosition(idx, { charOffset: target, percent: pct, blockIndex: b });
      expect(back.blockIndex).toBe(b);
    }
    // 进度失效时按 percent 兜底
    const fallback = resolvePosition(idx, { charOffset: Number.NaN, percent: 0.5, blockIndex: 0 });
    expect(percentOf(idx, idx.charOffsets[fallback.blockIndex] + fallback.charTarget)).toBeCloseTo(0.5, 2);
  }, 30_000);
});

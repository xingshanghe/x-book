import { describe, expect, it } from 'vitest';
import {
  clampPage,
  columnOffsets,
  type LineBox,
  packLinePages,
  pageIndexForLine,
  pageMetrics,
  pickFlowLine,
  screenCount,
  screenIndexForPage,
} from '@/features/reader/pageLayout';

const base = {
  viewportW: 900,
  viewportH: 800,
  fontSize: 19,
  lineHeight: 1.9,
  maxWidthCh: 38,
  paragraphSpacingEm: 0.6,
};

describe('pageMetrics', () => {
  it('单页步长等于列宽加列缝，下一列翻过来正好顶到左缘', () => {
    const m = pageMetrics(base);
    expect(m.cols).toBe(1);
    expect(m.pitch).toBe(m.colW + m.gap);
    expect(m.stride).toBe(m.pitch);
    expect(m.pageW).toBe(m.colW);
    expect(m.pitch - m.stride).toBe(0);
  });

  it('双页翻一页只跨过这一屏，不会把步长再乘一次而跳过一整屏', () => {
    const m = pageMetrics({ ...base, viewportW: 2200, viewportH: 1000 });
    expect(m.cols).toBe(2);
    expect(m.pageW).toBe(m.colW * 2 + m.gap);
    expect(m.stride).toBe(2 * (m.colW + m.gap));
    expect(m.stride).toBe(m.pageW + m.gap);
    // 第 2 列（上一页右页）的右缘，紧接着第 3 列（下一页左页）的左缘
    expect(1 * m.pitch + m.colW + m.gap).toBe(2 * m.pitch);
    expect(2 * m.pitch - m.stride).toBe(0);
  });

  it('列高是行高的整数倍，并且放得进视口', () => {
    const m = pageMetrics(base);
    expect(m.contentH % m.linePx).toBe(0);
    expect(m.contentH).toBeGreaterThan(0);
    expect(m.padTop + m.contentH).toBeLessThanOrEqual(base.viewportH);
    expect(m.linePx).toBe(Math.round(19 * 1.9));
  });

  it('视口还没量到时不产出会用来除的宽度', () => {
    const m = pageMetrics({ ...base, viewportW: 0, viewportH: 0 });
    expect(m.pageW).toBe(0);
    expect(m.stride).toBe(0);
  });
});

function grid(count: number, linePx: number, gap = 0): LineBox[] {
  let top = 0;
  return Array.from({ length: count }, () => {
    const box = { top, bottom: top + linePx };
    top += linePx + gap;
    return box;
  });
}

function coveredLines(lines: LineBox[], pages: { line: number }[]): number[] {
  const owned = new Array(lines.length).fill(0);
  for (let i = 0; i < pages.length; i++) {
    const start = pages[i].line;
    const end = pages[i + 1]?.line ?? lines.length;
    for (let n = start; n < end; n++) owned[n] += 1;
  }
  return owned;
}

describe('按行装页', () => {
  it('每一行只属于一页，下一页从上一页的下一行开始', () => {
    const lines = grid(50, 36, 11);
    const pages = packLinePages(lines, 36 * 20);
    expect(coveredLines(lines, pages)).toEqual(new Array(50).fill(1));
    for (let i = 0; i < pages.length; i++) {
      const start = pages[i].line;
      const end = pages[i + 1]?.line ?? lines.length;
      const origin = lines[start].top;
      if (end - start > 1) {
        for (let n = start; n < end; n++) {
          expect(lines[n].bottom - origin).toBeLessThanOrEqual(36 * 20 + 0.01);
        }
      }
    }
  });

  it('刚好越出列高的行整行进下一页，不和上一页重叠', () => {
    const lines: LineBox[] = [
      { top: 0, bottom: 36 },
      { top: 36, bottom: 72 },
      { top: 80, bottom: 116 },
    ];
    const pages = packLinePages(lines, 100);
    expect(pages.map((page) => page.line)).toEqual([0, 2]);
    expect(pages[1].offset).toBe(80);
  });

  it('没有段距时一页的行数等于列高除以行高', () => {
    const linePx = 36;
    const rows = 20;
    const lines = grid(100, linePx);
    const pages = packLinePages(lines, linePx * rows);
    expect(pages.map((page) => page.line)).toEqual([0, 20, 40, 60, 80]);
  });

  it('双页一屏两栏，末栏没有内容时留空而不是回到开头', () => {
    const lines = grid(5, 36);
    const pages = packLinePages(lines, 36 * 2);
    expect(screenCount(pages.length, 2)).toBe(2);
    expect(columnOffsets(0, pages, 2)).toEqual([0, 72]);
    expect(columnOffsets(1, pages, 2)[1]).toBeNull();
    expect(screenIndexForPage(pageIndexForLine(4, pages), 2)).toBe(1);
  });

  it('页码夹在有效范围内', () => {
    expect(clampPage(-3, 4)).toBe(0);
    expect(clampPage(9, 4)).toBe(3);
    expect(clampPage(2, 1)).toBe(0);
  });
});

describe('pickFlowLine', () => {
  const lines = [
    { char: 0, block: 0 },
    { char: 40, block: 0 },
    { char: 90, block: 2 },
    { char: 140, block: 3 },
  ];

  it('字符和块号邻近时落到那一行', () => {
    expect(pickFlowLine(lines, 50)?.char).toBe(90);
    expect(pickFlowLine(lines, 50, 2)?.char).toBe(90);
  });

  it('字符漂得很远时改用块号', () => {
    expect(pickFlowLine(lines, 0, 3)?.char).toBe(140);
  });
});

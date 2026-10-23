import { describe, expect, it } from 'vitest';
import {
  chapterPushes,
  clampPage,
  columnOffsets,
  type LineBox,
  packLinePages,
  pageIndexForLine,
  pageMetrics,
  pickFlowLine,
  type PushLine,
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

function shiftByPushes(lines: PushLine[], pushes: ReadonlyMap<number, number>): PushLine[] {
  let shift = 0;
  return lines.map((line) => {
    const push = line.breakBefore ? (pushes.get(line.char) ?? 0) : 0;
    const next = { ...line, top: line.top + shift + push, bottom: line.bottom + shift + push };
    shift += push;
    return next;
  });
}

describe('章回另起一页', () => {
  const contentH = 200;
  const raw: PushLine[] = [
    { char: 1, top: 0, bottom: 30 },
    { char: 2, top: 40, bottom: 70 },
    { char: 3, top: 80, bottom: 130, breakBefore: true },
    { char: 4, top: 140, bottom: 170 },
  ];

  it('页内还有空时，把章回标题推到下一页页首', () => {
    const pushes = chapterPushes(raw, contentH, new Map());
    expect(pushes.get(3)).toBe(120);
    const shifted = shiftByPushes(raw, pushes);
    expect(shifted[2].top).toBe(200);
    expect(packLinePages(shifted, contentH).map((page) => page.line)).toEqual([0, 2]);
  });

  it('空白已经算进去之后，再算一次不会越推越远', () => {
    const first = chapterPushes(raw, contentH, new Map());
    const shifted = shiftByPushes(raw, first);
    const second = chapterPushes(shifted, contentH, first);
    expect(second.get(3)).toBe(first.get(3));
  });

  it('开篇标题就在页首，不再多推一页空白', () => {
    const lines: PushLine[] = [
      { char: 1, top: 0, bottom: 40, breakBefore: true },
      { char: 2, top: 50, bottom: 80 },
    ];
    expect(chapterPushes(lines, contentH, new Map()).size).toBe(0);
  });

  it('标题已经落在下一页时不再补空白', () => {
    const lines: PushLine[] = [
      { char: 1, top: 0, bottom: 90 },
      { char: 2, top: 100, bottom: 140, breakBefore: true },
    ];
    expect(chapterPushes(lines, 100, new Map()).size).toBe(0);
  });

  it('连续两个章回各自另起一页', () => {
    const lines: PushLine[] = [
      { char: 1, top: 0, bottom: 30 },
      { char: 2, top: 40, bottom: 80, breakBefore: true },
      { char: 3, top: 90, bottom: 120 },
      { char: 4, top: 130, bottom: 170, breakBefore: true },
    ];
    const pushes = chapterPushes(lines, 100, new Map());
    expect(pushes.get(2)).toBe(60);
    expect(pushes.get(4)).toBe(10);
    const shifted = shiftByPushes(lines, pushes);
    expect(packLinePages(shifted, 100).map((page) => page.line)).toEqual([0, 1, 3]);
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

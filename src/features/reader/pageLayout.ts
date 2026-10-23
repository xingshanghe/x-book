/**
 * 左右翻页的几何。
 *
 * 断行交给浏览器，分页按测到的行盒切：
 * 一页只收「底部还在列高里」的整行，下一页从下一行开始。
 * 因此不会切掉半行，也不会让同一行在两页上各出现一次。
 */

export const COLUMN_GAP = 56;

export interface PageMetrics {
  /** 一屏几列：窄窗 1，宽窗 2 */
  cols: 1 | 2;
  colW: number;
  gap: number;
  /** 视口能看到的宽度（双页含中缝，不含翻过去的那道缝） */
  pageW: number;
  /** 相邻两列左缘的距离 */
  pitch: number;
  /** 翻一页移动的距离 */
  stride: number;
  /** 列内容高度，行高的整数倍 */
  contentH: number;
  linePx: number;
  /** 列块在视口里垂直居中的上边距 */
  padTop: number;
  paragraphGapPx: number;
}

export interface PageMetricsInput {
  viewportW: number;
  viewportH: number;
  fontSize: number;
  lineHeight: number;
  maxWidthCh: number;
  paragraphSpacingEm: number;
  gap?: number;
}

export function pageMetrics(input: PageMetricsInput): PageMetrics {
  const gap = input.gap ?? COLUMN_GAP;
  const fontSize = Math.max(1, input.fontSize);
  const linePx = Math.max(1, Math.round(fontSize * input.lineHeight));
  const paragraphGapPx = Math.max(0, Math.round(input.paragraphSpacingEm * fontSize));

  if (input.viewportW < 80 || input.viewportH < 80) {
    return {
      cols: 1,
      colW: 0,
      gap,
      pageW: 0,
      pitch: 0,
      stride: 0,
      contentH: 0,
      linePx,
      padTop: 0,
      paragraphGapPx,
    };
  }

  // 与滚动模式的 --w-scale 同一套档位，宽屏才加宽
  const wScale =
    input.viewportW >= 1600
      ? 1.36
      : input.viewportW >= 1300
        ? 1.24
        : input.viewportW >= 1000
          ? 1.12
          : 1;
  const maxCol = Math.round(input.maxWidthCh * fontSize * 1.02 * wScale);
  const avail = Math.max(240, input.viewportW - 48);
  const canDouble = avail >= maxCol * 2 + gap + 24;
  const colW = canDouble
    ? Math.min(maxCol, Math.floor((avail - gap) / 2))
    : Math.min(avail, maxCol);
  const cols: 1 | 2 = canDouble ? 2 : 1;
  const pitch = colW + gap;
  const pageW = cols * colW + (cols - 1) * gap;
  const stride = cols * pitch;

  // 上下各留一点空，列高再向下取整到整行，末行不会被视口切掉半截
  const inset = Math.round(fontSize * 0.9);
  const inner = Math.max(linePx, input.viewportH - inset * 2);
  const rows = Math.max(1, Math.floor(inner / linePx));
  const contentH = rows * linePx;
  const padTop = Math.max(0, Math.floor((input.viewportH - contentH) / 2));

  return { cols, colW, gap, pageW, pitch, stride, contentH, linePx, padTop, paragraphGapPx };
}

/** 一行在正文流里的上下沿，相对列内容的顶端。 */
export interface LineBox {
  top: number;
  bottom: number;
}

/** 一页（双页时的一栏）从哪一行开始，以及要把正文上移多少才能让这行贴住列顶。 */
export interface LinePage {
  line: number;
  offset: number;
}

/**
 * 把行盒装进一页页里。
 * 装不下的行整行挪到下一页，不切、不重复。
 * 比列高还高的单行单独成页，避免被跳过。
 */
export function packLinePages(lines: readonly LineBox[], contentH: number): LinePage[] {
  if (!lines.length || contentH <= 0) return [{ line: 0, offset: 0 }];
  const pages: LinePage[] = [];
  let index = 0;
  while (index < lines.length) {
    const origin = lines[index].top;
    let next = index;
    while (next < lines.length && lines[next].bottom - origin <= contentH + 0.01) next += 1;
    if (next === index) next = index + 1;
    pages.push({ line: index, offset: origin });
    index = next;
  }
  return pages;
}

/** 一行落在第几页（从 0 计）。 */
export function pageIndexForLine(lineIndex: number, pages: readonly LinePage[]): number {
  if (!pages.length) return 0;
  let found = 0;
  for (let i = 0; i < pages.length; i++) {
    if (pages[i].line <= lineIndex) found = i;
    else break;
  }
  return found;
}

/** 一屏有几栏。翻一次走一屏，所以页码按屏计。 */
export function screenCount(pageCount: number, cols: number): number {
  const per = Math.max(1, cols);
  return Math.max(1, Math.ceil(Math.max(1, pageCount) / per));
}

export function screenIndexForPage(pageIndex: number, cols: number): number {
  return Math.floor(Math.max(0, pageIndex) / Math.max(1, cols));
}

/** 这一屏每一栏的纵向偏移。没有内容的栏是 null，不能回绕到开头。 */
export function columnOffsets(
  screen: number,
  pages: readonly LinePage[],
  cols: number,
): (number | null)[] {
  const per = Math.max(1, cols);
  return Array.from({ length: per }, (_, slot) => {
    const page = pages[screen * per + slot];
    return page ? page.offset : null;
  });
}

export function clampPage(index: number, count: number): number {
  if (count <= 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.trunc(index)));
}

export interface FlowAnchor {
  char: number;
  block: number;
}

export interface PushLine extends LineBox {
  char: number;
  breakBefore?: boolean;
  /** 已经插在这一行前面、并算进 top/bottom 的空白（章回另起一页） */
  push?: number;
}

/**
 * 章回标题如果还挤在当前页里，就算出要把它推到下一页页首的空白。
 * 空白算进现有 top 之后再调用，结果应保持不变，避免来回补空白。
 */
export function chapterPushes(
  lines: readonly PushLine[],
  contentH: number,
  current: ReadonlyMap<number, number>,
): Map<number, number> {
  const next = new Map<number, number>();
  if (contentH <= 0 || lines.length === 0) return next;

  let applied = 0;
  const natural = lines.map((line) => {
    const push = line.breakBefore ? (current.get(line.char) ?? line.push ?? 0) : 0;
    const box = { top: line.top - applied - push, bottom: line.bottom - applied - push };
    applied += push;
    return { ...box, breakBefore: Boolean(line.breakBefore), char: line.char };
  });

  let shift = 0;
  let origin = natural[0].top;
  for (let i = 0; i < natural.length; i++) {
    const top = natural[i].top + shift;
    const bottom = natural[i].bottom + shift;
    if (i > 0 && natural[i].breakBefore) {
      const used = top - origin;
      if (used < contentH - 0.5) {
        const computed = Math.ceil(contentH - used);
        const prev = current.get(natural[i].char) ?? 0;
        const push = prev > 0 && Math.abs(computed - prev) <= 1 ? prev : computed;
        if (push > 0) next.set(natural[i].char, push);
        shift += push;
        origin = top + push;
        continue;
      }
      origin = top;
      continue;
    }
    if (i > 0 && bottom - origin > contentH + 0.01) origin = top;
  }
  return next;
}

/**
 * 字符位置和块号对不上时以块号为准（清洗后字符统计会漂），
 * 两者邻近时用字符落到具体那一行。
 */
export function pickFlowLine<T extends FlowAnchor>(
  lines: readonly T[],
  target: number,
  blockHint?: number,
): T | null {
  if (!lines.length) return null;
  const byBlock = blockHint != null ? lines.find((l) => l.block >= blockHint) : undefined;
  const byChar = lines.find((l) => l.char >= target);
  if (byChar && (!byBlock || Math.abs(byChar.block - byBlock.block) <= 1)) return byChar;
  return byBlock ?? byChar ?? lines[lines.length - 1];
}

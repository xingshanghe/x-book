/**
 * 分页阅读视图（单页 / 双页自适应）。
 *
 * 断行交给浏览器（中文标点、英文单词不能自己算）。
 * 分页按测到的行盒：一栏只放底部还在栏高里的整行，下一栏从下一行开始。
 * 翻一屏就走完这一屏的栏，所以不会缺行，也不会让同一行出现两次。
 *
 * 内容按段装载：有章节取一章，无章节取 300 块，翻到段边界再换段。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { splitByRefs } from '@/core/parser/footnotes';
import type { BlockReader } from '@/core/reader/blockReader';
import type { BlockIndexView } from '@/core/reader/progress';
import type { Chapter, Typography } from '@/types/models';
import {
  clampPage,
  columnOffsets,
  type LinePage,
  packLinePages,
  pageIndexForLine,
  pageMetrics,
  pickFlowLine,
  screenCount,
  screenIndexForPage,
} from './pageLayout';
import { type FlowLine, readSegment, type Segment, segmentOf, totalCharsOf } from './paginate';

const SKELETON_BARS = [
  { id: 'a', width: '88%' },
  { id: 'b', width: '79%' },
  { id: 'c', width: '70%' },
  { id: 'd', width: '88%' },
  { id: 'e', width: '79%' },
  { id: 'f', width: '70%' },
  { id: 'g', width: '88%' },
  { id: 'h', width: '79%' },
  { id: 'i', width: '70%' },
] as const;

const COLUMN_KEYS = ['primary', 'secondary'] as const;

export interface PagedHandle {
  turn: (dir: 1 | -1) => void;
  /** blockHint 来自章节记录，比 charOffset 稳（清洗过的书字符统计会有偏差） */
  seek: (charOffset: number, blockHint?: number) => void;
}

interface Props {
  idx: BlockIndexView;
  reader: BlockReader;
  chapters: Chapter[];
  footnotes: Map<string, string>;
  typography: Typography;
  fontFamily: string;
  charOffset: number;
  /** 打开书时的落点块号（进度里存的，比字符稳） */
  startBlock?: number;
  /** 翻页 / 换段后回报当前位置 */
  onCharChange: (charOffset: number) => void;
  onFootnote: (marker: string) => void;
  flipAnimation: boolean;
  handleRef: React.MutableRefObject<PagedHandle | null>;
  /** 换段时通知外层（用于显示"正在装订下一页"的骨架） */
  onLoadingChange?: (loading: boolean) => void;
  /** 页码变化（底栏显示 第 x / y 页） */
  onPageInfo?: (info: { index: number; count: number }) => void;
}

interface PendingSeek {
  char: number;
  block?: number;
  /** end：换到上一段时落在最后一屏，而不是最后一行所在段落的开头 */
  edge: 'char' | 'end';
}

interface MeasuredLine {
  top: number;
  bottom: number;
  char: number;
}

function measureLines(flow: HTMLElement): MeasuredLine[] {
  const origin = flow.getBoundingClientRect().top;
  const out: MeasuredLine[] = [];
  const nodes = flow.querySelectorAll<HTMLElement>('.qy-line[data-char]');
  for (const node of nodes) {
    const char = Number(node.dataset.char);
    if (!Number.isFinite(char)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    // 元素的 getClientRects 是整段一个框。Range 才会按行盒拆开。
    const rects = [...range.getClientRects()].filter((rect) => rect.width >= 1 && rect.height >= 1);
    range.detach();
    const merged: { top: number; bottom: number }[] = [];
    for (const rect of rects) {
      const top = rect.top - origin;
      const bottom = rect.bottom - origin;
      const last = merged[merged.length - 1];
      // 同一行里的注标和正文会各有一个框，合成一行
      if (last && top < last.bottom - 1) {
        last.top = Math.min(last.top, top);
        last.bottom = Math.max(last.bottom, bottom);
      } else {
        merged.push({ top, bottom });
      }
    }
    for (const line of merged) out.push({ ...line, char });
  }
  return out;
}

function sameOffsets(a: readonly (number | null)[], b: readonly (number | null)[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function FlowBody({
  lines,
  hasFootnotes,
  onFootnote,
}: {
  lines: FlowLine[];
  hasFootnotes: boolean;
  onFootnote: (marker: string) => void;
}) {
  return lines.map((line) => {
    const parts = hasFootnotes ? splitByRefs(line.text) : null;
    const seen = new Map<string, number>();
    return (
      <p className="qy-line" data-char={line.char} key={line.char}>
        {parts
          ? parts.map((part) => {
              const base = part.ref ? `r:${part.ref}` : `t:${part.text}`;
              const nth = seen.get(base) ?? 0;
              seen.set(base, nth + 1);
              const key = nth === 0 ? base : `${base}#${nth}`;
              return part.ref ? (
                <button
                  key={key}
                  type="button"
                  className="qy-ref"
                  onClick={(event) => {
                    event.stopPropagation();
                    onFootnote(part.ref as string);
                  }}
                >
                  {part.ref}
                </button>
              ) : (
                <span key={key}>{part.text}</span>
              );
            })
          : line.text}
      </p>
    );
  });
}

export function PagedView({
  idx,
  reader,
  chapters,
  footnotes,
  typography,
  fontFamily,
  charOffset,
  startBlock,
  onCharChange,
  onFootnote,
  flipAnimation,
  handleRef,
  onLoadingChange,
  onPageInfo,
}: Props) {
  const viewRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const [seg, setSeg] = useState<Segment>(() => segmentOf(idx, chapters, charOffset, startBlock));
  const [lines, setLines] = useState<FlowLine[] | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [offsets, setOffsets] = useState<(number | null)[]>([0]);
  const [seekGen, setSeekGen] = useState(0);

  const pendingSeek = useRef<PendingSeek | null>({
    char: charOffset,
    block: startBlock,
    edge: 'char',
  });
  /** 行盒还没量完时不要把页码写回进度 */
  const seeking = useRef(true);
  const anchorChar = useRef(charOffset);
  const echoChar = useRef<number | null>(null);
  const skipCharEffect = useRef(true);
  const pageRef = useRef({ index: 0, count: 1 });
  const pagesRef = useRef<LinePage[]>([{ line: 0, offset: 0 }]);
  const measuredRef = useRef<MeasuredLine[]>([]);
  pageRef.current = { index: pageIndex, count: pageCount };

  const onPageInfoRef = useRef(onPageInfo);
  onPageInfoRef.current = onPageInfo;
  const onCharChangeRef = useRef(onCharChange);
  onCharChangeRef.current = onCharChange;
  const onLoadingChangeRef = useRef(onLoadingChange);
  onLoadingChangeRef.current = onLoadingChange;

  const metrics = useMemo(
    () =>
      pageMetrics({
        viewportW: box.w,
        viewportH: box.h,
        fontSize: typography.fontSize,
        lineHeight: typography.lineHeight,
        maxWidthCh: typography.maxWidth,
        paragraphSpacingEm: typography.paragraphSpacing,
      }),
    [
      box.w,
      box.h,
      typography.fontSize,
      typography.lineHeight,
      typography.maxWidth,
      typography.paragraphSpacing,
    ],
  );
  const colsRef = useRef(metrics.cols);
  colsRef.current = metrics.cols;

  const reportPosition = useCallback((index: number, count: number) => {
    onPageInfoRef.current?.({ index, count });
    const page = pagesRef.current[index * colsRef.current];
    const line = page ? measuredRef.current[page.line] : undefined;
    if (!line) return;
    anchorChar.current = line.char;
    echoChar.current = line.char;
    onCharChangeRef.current(line.char);
  }, []);

  const showScreen = useCallback((index: number, pages: LinePage[], cols: number) => {
    const count = screenCount(pages.length, cols);
    const next = clampPage(index, count);
    const nextOffsets = columnOffsets(next, pages, cols);
    pageRef.current = { index: next, count };
    setPageIndex(next);
    setPageCount(count);
    setOffsets((current) => (sameOffsets(current, nextOffsets) ? current : nextOffsets));
  }, []);

  /* ---------- 段内容 ---------- */

  useEffect(() => {
    let alive = true;
    setLines(null);
    setPageIndex(0);
    setOffsets([0]);
    onLoadingChangeRef.current?.(true);
    void readSegment(reader, idx, seg)
      .then((next) => {
        if (!alive) return;
        setLines(next);
        onLoadingChangeRef.current?.(false);
      })
      .catch(() => {
        if (!alive) return;
        setLines([]);
        onLoadingChangeRef.current?.(false);
      });
    return () => {
      alive = false;
    };
  }, [seg, reader, idx]);

  useEffect(() => {
    if (skipCharEffect.current) {
      skipCharEffect.current = false;
      return;
    }
    if (echoChar.current === charOffset) {
      echoChar.current = null;
      return;
    }
    anchorChar.current = charOffset;
    pendingSeek.current = { char: charOffset, edge: 'char' };
    seeking.current = true;
    if (charOffset < seg.startChar || charOffset >= seg.endChar) {
      setSeg(segmentOf(idx, chapters, charOffset));
      return;
    }
    setSeekGen((n) => n + 1);
  }, [charOffset, seg.startChar, seg.endChar, idx, chapters]);

  /* ---------- 尺寸 ---------- */

  useLayoutEffect(() => {
    const host = viewRef.current?.parentElement;
    if (!host) return;
    const measure = () => setBox({ w: host.clientWidth, h: host.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  /* ---------- 按行盒分页 ---------- */

  const metricsKey = `${metrics.pageW}:${metrics.contentH}:${metrics.cols}:${metrics.linePx}:${metrics.colW}`;
  const prevMetricsKey = useRef('');

  useLayoutEffect(() => {
    const flow = flowRef.current;
    void seekGen;
    if (!flow || !lines || metrics.contentH <= 0) return;
    if (!lines.length) {
      seeking.current = false;
      pagesRef.current = [{ line: 0, offset: 0 }];
      measuredRef.current = [];
      showScreen(0, pagesRef.current, metrics.cols);
      return;
    }
    let alive = true;
    let placed = false;
    const resized = prevMetricsKey.current !== '' && prevMetricsKey.current !== metricsKey;
    prevMetricsKey.current = metricsKey;

    const screenFor = (
      char: number,
      block: number | undefined,
      pages: LinePage[],
      measured: MeasuredLine[],
    ) => {
      const para = pickFlowLine(lines, char, block);
      if (!para || !measured.length) return 0;
      const lineIndex = measured.findIndex((item) => item.char === para.char);
      return screenIndexForPage(
        pageIndexForLine(lineIndex < 0 ? 0 : lineIndex, pages),
        metrics.cols,
      );
    };

    const settle = (force: boolean) => {
      if (!alive) return;
      const measured = measureLines(flow);
      if (!measured.length && !force) return;
      const pages = packLinePages(measured, metrics.contentH);
      pagesRef.current = pages;
      measuredRef.current = measured;
      const pending = pendingSeek.current;
      let next = pageRef.current.index;
      if (pending) {
        next =
          pending.edge === 'end'
            ? screenCount(pages.length, metrics.cols) - 1
            : screenFor(pending.char, pending.block, pages, measured);
        pendingSeek.current = null;
        placed = true;
      } else if (resized && !placed) {
        next = screenFor(anchorChar.current, undefined, pages, measured);
        placed = true;
      }
      showScreen(next, pages, metrics.cols);
      seeking.current = false;
      reportPosition(pageRef.current.index, pageRef.current.count);
    };

    settle(false);
    const raf = requestAnimationFrame(() => settle(false));
    const early = window.setTimeout(() => settle(false), 60);
    const late = window.setTimeout(() => settle(true), 240);
    const fonts = document.fonts?.ready.then(() => settle(true));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.clearTimeout(early);
      window.clearTimeout(late);
      void fonts;
    };
  }, [lines, metricsKey, metrics, seekGen, showScreen, reportPosition]);

  useEffect(() => {
    if (seeking.current || !lines?.length) return;
    reportPosition(pageIndex, pageCount);
  }, [pageIndex, pageCount, lines, reportPosition]);

  /* ---------- 翻页 ---------- */

  const goToSegment = useCallback(
    (char: number, edge: PendingSeek['edge']) => {
      seeking.current = true;
      pendingSeek.current = { char, edge };
      anchorChar.current = char;
      echoChar.current = char;
      onCharChangeRef.current(char);
      setSeg(segmentOf(idx, chapters, char));
    },
    [idx, chapters],
  );

  const turn = useCallback(
    (dir: 1 | -1) => {
      if (!lines?.length || seeking.current) return;
      const { index, count } = pageRef.current;
      if (dir === 1 && index >= count - 1) {
        if (seg.endChar < totalCharsOf(idx)) goToSegment(seg.endChar, 'char');
        return;
      }
      if (dir === -1 && index <= 0) {
        if (seg.startChar > 0) goToSegment(Math.max(0, seg.startChar - 1), 'end');
        return;
      }
      showScreen(index + dir, pagesRef.current, metrics.cols);
    },
    [lines, seg.startChar, seg.endChar, idx, goToSegment, metrics.cols, showScreen],
  );

  useEffect(() => {
    handleRef.current = {
      turn,
      seek: (char: number, blockHint?: number) => {
        seeking.current = true;
        pendingSeek.current = { char, block: blockHint, edge: 'char' };
        anchorChar.current = char;
        echoChar.current = char;
        onCharChangeRef.current(char);
        if (char < seg.startChar || char >= seg.endChar) {
          setSeg(segmentOf(idx, chapters, char, blockHint));
          return;
        }
        setSeekGen((n) => n + 1);
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, turn, seg.startChar, seg.endChar, idx, chapters]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let locked = false;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      const dominant =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(dominant) < 8) return;
      event.preventDefault();
      if (locked) return;
      locked = true;
      turn(dominant > 0 ? 1 : -1);
      window.setTimeout(() => {
        locked = false;
      }, 320);
    };
    view.addEventListener('wheel', onWheel, { passive: false });
    return () => view.removeEventListener('wheel', onWheel);
  }, [turn]);

  /* ---------- 渲染 ---------- */

  const hasFootnotes = footnotes.size > 0;
  const flowStyle = {
    width: metrics.colW || '100%',
    fontFamily,
    fontSize: typography.fontSize,
    lineHeight: `${metrics.linePx}px`,
    letterSpacing: `${typography.letterSpacing}em`,
    textAlign: typography.textAlign,
    ['--p-gap' as string]: `${metrics.paragraphGapPx}px`,
    ['--indent' as string]: `${typography.textIndent}em`,
  };

  return (
    <div
      className={`paged-view${metrics.cols === 2 ? ' double' : ''}`}
      ref={viewRef}
      style={{ width: metrics.pageW || undefined }}
      data-page={pageIndex + 1}
      data-flip={flipAnimation ? 'on' : 'off'}
    >
      <div
        className="paged-cols"
        style={{
          marginTop: metrics.padTop,
          height: metrics.contentH || '100%',
          gap: metrics.gap,
        }}
      >
        {COLUMN_KEYS.slice(0, metrics.cols).map((key, slot) => {
          const offset = offsets[slot] ?? null;
          return (
            <div
              key={key}
              className="paged-col"
              style={{ width: metrics.colW || '100%' }}
              aria-hidden={slot > 0 ? true : undefined}
            >
              <div
                className="paged-flow"
                ref={slot === 0 ? flowRef : undefined}
                style={{
                  ...flowStyle,
                  transform: offset == null ? undefined : `translateY(${-offset}px)`,
                  visibility: offset == null ? 'hidden' : 'visible',
                }}
              >
                {slot === 0 && lines === null && (
                  <div className="paged-skeleton" aria-hidden>
                    {SKELETON_BARS.map((bar) => (
                      <span key={bar.id} style={{ width: bar.width }} />
                    ))}
                  </div>
                )}
                {lines && (
                  <FlowBody lines={lines} hasFootnotes={hasFootnotes} onFootnote={onFootnote} />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

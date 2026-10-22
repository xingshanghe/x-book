/**
 * 分页阅读视图（单页 / 双页自适应）。
 *
 * 为什么用 CSS 多列而不是自己算行：
 *   txt 的折行涉及中文标点挤压、英文单词不断行、字距等，自己算必然出错；
 *   交给 `column-fill: auto` + 固定列高，浏览器按真实排版断列，
 *   翻页只需要横向 scrollLeft，天然一页一屏，不会出现半行被切。
 *
 * 代价是不能再用块级虚拟占位，所以内容按「段」限制：
 *   有章节取一章、无章节取 300 块，翻到段边界再换段。
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Chapter, Typography } from '@/types/models';
import type { BlockIndexView } from '@/core/reader/progress';
import type { BlockReader } from '@/core/reader/blockReader';
import { splitByRefs } from '@/core/parser/footnotes';
import { clamp } from '@/lib/format';
import { readSegment, segmentOf, totalCharsOf, type FlowLine, type Segment } from './paginate';

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

const GAP = 56;

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

  const [seg, setSeg] = useState<Segment>(() =>
    segmentOf(idx, chapters, charOffset, startBlock),
  );
  const [lines, setLines] = useState<FlowLine[] | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState({ index: 0, count: 1 });
  const pendingSeek = useRef<{ char: number; block?: number } | null>({
    char: charOffset,
    block: startBlock,
  });
  /** 跳转期间不要上报位置，否则会把刚跳过去的位置又写回来 */
  const seeking = useRef(false);

  // 回调放进 ref：避免父组件每次渲染换新函数导致 scroll 监听反复重绑
  const onPageInfoRef = useRef(onPageInfo);
  onPageInfoRef.current = onPageInfo;

  /* ---------- 段内容 ---------- */

  useEffect(() => {
    let alive = true;
    setLines(null);
    onLoadingChange?.(true);
    void readSegment(reader, idx, seg)
      .then((ls) => {
        if (!alive) return;
        setLines(ls);
        onLoadingChange?.(false);
      })
      .catch(() => {
        if (alive) {
          setLines([]);
          onLoadingChange?.(false);
        }
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seg, reader, idx]);

  // 外部位置跳进别的段 → 换段
  useEffect(() => {
    if (charOffset < seg.startChar || charOffset >= seg.endChar) {
      setSeg(segmentOf(idx, chapters, charOffset));
      pendingSeek.current = { char: charOffset };
    }
  }, [charOffset, seg.startChar, seg.endChar, idx, chapters]);

  /* ---------- 尺寸 / 单双页 ---------- */

  useLayoutEffect(() => {
    // 量的是外层容器：view 自身宽度由下面算出的 pageW 决定，
    // 观察自己会锁死在初始值上（自证循环）。
    const host = viewRef.current?.parentElement;
    if (!host) return;
    const measure = () => setBox({ w: host.clientWidth, h: host.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  const metrics = useMemo(() => {
    const fs = typography.fontSize;
    const lh = typography.lineHeight;
    // 1ch 按一个汉字宽估算：中文正文里这比 em 更准
    // 宽屏下按视口比例适当加宽内容列，与 reader.css 的 --w-scale 保持一致
    const wScale = box.w >= 1600 ? 1.36 : box.w >= 1300 ? 1.24 : box.w >= 1000 ? 1.12 : 1;
    const maxCol = Math.round(typography.maxWidth * fs * 1.02 * wScale);
    // 左右各留 24px：双页时填满整窗会很挤，也让人误以为内容被截断
    const avail = Math.max(240, box.w - 48);
    const canDouble = avail >= maxCol * 2 + GAP + 24;
    const col = canDouble ? Math.min(maxCol, Math.floor((avail - GAP) / 2)) : Math.min(avail, maxCol);
    const pageW = canDouble ? col * 2 + GAP : col;
    return {
      double: canDouble,
      col,
      pageW,
      step: pageW + GAP,
      padY: Math.round(fs * 0.9),
      linePx: fs * lh,
    };
  }, [box.w, typography.maxWidth, typography.fontSize, typography.lineHeight]);

  /* ---------- 定位 ---------- */

  const lineStepPx = metrics.step;

  const seekToLine = useCallback(
    (target: number, smooth = false, blockHint?: number) => {
      const view = viewRef.current;
      const flow = flowRef.current;
      if (!view || !flow || !lines?.length) return;
      // 字符定位更精确，但清洗过的书里行级 char 与章节 charOffset 会差出十几页；
      // 块号由索引器直接给出、不会漂。两者差得远时以块为准，否则用字符落到具体行。
      const byBlock = blockHint != null ? lines.find((l) => l.block >= blockHint) : undefined;
      const byChar = lines.find((l) => l.char >= target);
      const hit =
        byChar && (!byBlock || Math.abs(byChar.block - byBlock.block) <= 1)
          ? byChar
          : (byBlock ?? byChar ?? lines[lines.length - 1]);
      const node = flow.querySelector<HTMLElement>(`[data-char="${hit.char}"]`);
      if (!node) return;
      const flowLeft = flow.getBoundingClientRect().left;
      const offset = Math.max(0, node.getBoundingClientRect().left - flowLeft);
      const index = Math.floor(offset / lineStepPx + 0.02);
      const left = index * lineStepPx;
      if (smooth && flipAnimation) view.scrollTo({ left, behavior: 'smooth' });
      else view.scrollLeft = left;
    },
    [lines, lineStepPx, flipAnimation],
  );


  // 段内容就绪后应用待定位置
  useEffect(() => {
    if (!lines?.length) return;
    const target = pendingSeek.current;
    if (target == null) return;
    pendingSeek.current = null;
    seeking.current = true;
    // 等一帧，确保多列已经完成布局
    const raf = requestAnimationFrame(() => {
      seekToLine(target.char, false, target.block);
      // 再等一帧：让定位引发的 scroll 事件先跑完，之后才允许上报位置。
      // 若目标是段首（scrollLeft 本来就是 0），不会产生 scroll 事件，
      // 这里必须手动同步一次，否则页码停在上一个位置。
      requestAnimationFrame(() => {
        seeking.current = false;
        syncFromView();
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [lines, seekToLine]);

  // 尺寸变化（单页↔双页）后重新对齐当前页并刷新页码
  useEffect(() => {
    if (!lines?.length) return;
    let raf2 = 0;
    const raf = requestAnimationFrame(() => {
      seekToLine(charOffset);
      // 多列重排要等一帧才算出新的 scrollWidth，页码在第二帧才准
      raf2 = requestAnimationFrame(() => syncFromView());
    });
    // 有些 WebView 的多列重排比两帧还慢，再兜一次
    const timer = setTimeout(syncFromView, 260);
    return () => {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics.pageW, metrics.double, lines == null]);

  /* ---------- 页码与当前位置 ---------- */

  const firstVisibleChar = useCallback((): number | null => {
    const view = viewRef.current;
    const flow = flowRef.current;
    if (!view || !flow) return null;
    const vr = view.getBoundingClientRect();
    // 取每列左上角那一点，命中的段落就是该页第一篇
    for (let c = 0; c < (metrics.double ? 2 : 1); c++) {
      const x = vr.left + c * (metrics.col + GAP) + 8;
      const y = vr.top + vr.height * 0.08;
      const el = document.elementFromPoint(x, y);
      const line = el?.closest<HTMLElement>('.qy-line[data-char]');
      if (line) return Number(line.dataset.char);
    }
    return null;
  }, [metrics.double, metrics.col]);

  const syncFromView = useCallback(() => {
    const view = viewRef.current;
    if (!view || seeking.current) return;
    const step = lineStepPx;
    const index = Math.round(view.scrollLeft / step);
    // step 已经按单/双页折算过（双页 = 两列宽 + 缝），
    // 所以 scrollWidth / step 直接就是页数，不能再除一次 2
    const count = Math.max(1, Math.round((view.scrollWidth + GAP) / step));
    setPage({ index, count });
    onPageInfoRef.current?.({ index, count });
    const ch = firstVisibleChar();
    if (ch != null) onCharChange(ch);
  }, [lineStepPx, metrics.double, firstVisibleChar, onCharChange]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncFromView();
      });
    };
    view.addEventListener('scroll', onScroll, { passive: true });
    // 内容变化后主动同步一次（首屏页码 / 段切换）
    const t = requestAnimationFrame(() => syncFromView());
    return () => {
      view.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
      cancelAnimationFrame(t);
    };
  }, [syncFromView, lines]);

  /* ---------- 翻页 ---------- */

  const turn = useCallback(
    (dir: 1 | -1) => {
      const view = viewRef.current;
      if (!view) return;
      const step = lineStepPx * (metrics.double ? 2 : 1);
      const max = view.scrollWidth - view.clientWidth;
      // 段边界：往后翻到头换下一段，往前翻到头换上一段
      if (dir === 1 && view.scrollLeft >= max - 4) {
        if (seg.endChar < totalCharsOf(idx)) {
          const next = seg.endChar;
          seeking.current = true;
          pendingSeek.current = { char: next };
          setSeg(segmentOf(idx, chapters, next));
          onCharChange(next);
        }
        return;
      }
      if (dir === -1 && view.scrollLeft <= 4) {
        if (seg.startChar > 0) {
          const prev = Math.max(0, seg.startChar - 1);
          seeking.current = true;
          pendingSeek.current = { char: prev };
          setSeg(segmentOf(idx, chapters, prev));
          onCharChange(prev);
        }
        return;
      }
      const left = clamp(view.scrollLeft + dir * step, 0, max);
      // 直接赋值：smooth 时连续翻页会读到动画中间值，几下点击叠成一次
      view.scrollLeft = left;
      setPage((p) => ({ ...p, index: Math.round(left / lineStepPx) }));
    },
    [lineStepPx, metrics.double, seg.startChar, seg.endChar, idx, chapters, onCharChange],
  );

  useEffect(() => {
    handleRef.current = {
      turn,
      seek: (char: number, blockHint?: number) => {
        seeking.current = true;
        pendingSeek.current = { char, block: blockHint };
        if (char < seg.startChar || char >= seg.endChar) {
          setSeg(segmentOf(idx, chapters, char, blockHint));
        } else {
          requestAnimationFrame(() => {
            pendingSeek.current = null;
            seekToLine(char, false, blockHint);
            requestAnimationFrame(() => {
              seeking.current = false;
            });
          });
        }
      },
    };
    return () => {
      handleRef.current = null;
    };
  }, [handleRef, turn, seg.startChar, seg.endChar, idx, chapters, seekToLine]);

  /* ---------- 渲染 ---------- */

  const hasFootnotes = footnotes.size > 0;

  return (
    <div
      className={`paged-view${metrics.double ? ' double' : ''}`}
      ref={viewRef}
      style={{ width: metrics.pageW }}
      data-page={page.index + 1}
    >
      <div
        className="paged-flow"
        ref={flowRef}
        style={{
          columnCount: metrics.double ? 2 : 1,
          columnGap: GAP,
          width: '100%',
          height: '100%',
          boxSizing: 'border-box',
          paddingTop: metrics.padY,
          paddingBottom: metrics.padY * 2,
          fontFamily,
          fontSize: typography.fontSize,
          lineHeight: typography.lineHeight,
          letterSpacing: `${typography.letterSpacing}em`,
          textAlign: typography.textAlign,
          // 段距用 em 表达，和字号一起缩放
          ['--p-gap' as string]: `${typography.paragraphSpacing}em`,
          ['--indent' as string]: `${typography.textIndent}em`,
        }}
      >
        {lines === null && (
          <div className="paged-skeleton" aria-hidden>
            {Array.from({ length: 9 }, (_, i) => (
              <span key={i} style={{ width: `${88 - (i % 3) * 9}%` }} />
            ))}
          </div>
        )}
        {lines?.map((l) => {
          const parts = hasFootnotes ? splitByRefs(l.text) : null;
          return (
            <p className="qy-line" data-char={l.char} key={l.char}>
              {parts
                ? parts.map((p, pi) =>
                    p.ref ? (
                      <sup
                        key={pi}
                        className="qy-ref"
                        onClick={(e) => {
                          e.stopPropagation();
                          onFootnote(p.ref as string);
                        }}
                      >
                        {p.ref}
                      </sup>
                    ) : (
                      <span key={pi}>{p.text}</span>
                    ),
                  )
                : l.text}
            </p>
          );
        })}
      </div>
    </div>
  );
}

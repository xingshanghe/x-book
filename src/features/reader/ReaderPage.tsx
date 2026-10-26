/**
 * 阅读器主页面：块级虚拟滚动 + 行级锚点定位。
 *
 * 性能设计：
 *   · 任意时刻只渲染视口 ±2~3 块，100MB 与 1MB 的书渲染成本相同；
 *   · 未渲染块高度用「行数 × 行高 + 段距」估算，滚动条比例从一开始就是准的；
 *   · 渲染过的块记录实测高度（ResizeObserver），估算逐步收敛为精确值；
 *   · 进度锚点 = 全书可见字符偏移（charOffset），换字号/换设备不漂移。
 */

import {
  type ComponentType,
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'wouter';
import { useSettings } from '@/app/store';
import { headingRepeat, takeHeadingPlate } from '@/core/parser/chapters';
import { type CollectedNote, collectNotes } from '@/core/parser/footnotes';
import { isPageBreakLine } from '@/core/parser/reformat';
import { BlockReader } from '@/core/reader/blockReader';
import { type BlockIndexView, resolvePosition } from '@/core/reader/progress';
import { buildTitlePage } from '@/core/reader/titlepage';
import { trimLeadingSpaces } from '@/core/text/sanitize';
import { lineHeightPx } from '@/core/text/typography';
import { readSegment, segmentOf } from '@/features/reader/paginate';
import { clamp, formatPercent, formatRemaining } from '@/lib/format';
import { debounce } from '@/lib/throttle';
import { getBookBlob } from '@/storage/blobStore';
import { listFonts } from '@/storage/fontStore';
import { listBookmarks } from '@/storage/repositories/bookmarkRepo';
import {
  getBlockIndex,
  getBook,
  getChapters,
  getFootnotes,
  touchBook,
} from '@/storage/repositories/bookRepo';
import { getProgress, saveProgress } from '@/storage/repositories/progressRepo';
import { clearReadMark } from '@/tts/resume';
import { desktopReadingReady } from '@/tts/support';
import type { Book, Bookmark, Chapter } from '@/types/models';
import { Button, EmptyState, useToast } from '@/ui';
import {
  IconBook,
  IconBookmark,
  IconChevronLeft,
  IconChevronRight,
  IconList,
  IconMoon,
  IconSearch,
  IconSettings2,
  IconSun,
} from '@/ui/icons';
import { AnnotatedLine } from './AnnotatedLine';
import { ChapterHeading } from './ChapterHeading';
import { type PagedHandle, PagedView } from './PagedView';
import { type ScrollChapterMark, scrollChapterBreaks } from './pageLayout';
import { BookmarkSheet, LayoutSheet, NotePopover, SearchSheet } from './ReaderSheets';
import { TitlePageView } from './TitlePage';
import { TocSidebar } from './TocSidebar';
import './reader.css';

const NO_HEADINGS: readonly string[] = [];
const EMPTY_BREAKS: ReadonlyMap<number, number> = new Map();

interface Loaded {
  book: Book;
  idx: BlockIndexView;
  chapters: Chapter[];
  footnotes: Map<string, string>;
  reader: BlockReader;
  startBlock: number;
  charInBlock: number;
  savedPercent: number;
  excerpt: string[];
  userFonts: { id: string; name: string }[];
}

export function ReaderPage({ id, params }: { id?: string; params?: { id: string } }) {
  const bookId = id ?? params?.id;
  const [, navigate] = useLocation();
  const toast = useToast();
  const settings = useSettings((s) => s.settings);
  const updateSettings = useSettings((s) => s.update);
  const updateTypography = useSettings((s) => s.updateTypography);

  const [data, setData] = useState<Loaded | null>(null);
  /** absent=书没了 / empty=正文为空（历史坏数据） */
  const [missing, setMissing] = useState<null | 'absent' | 'empty'>(null);

  // 虚拟滚动状态
  const heights = useRef(new Map<number, number>());
  const [heightVersion, setHeightVersion] = useState(0);
  const [layoutTick, setLayoutTick] = useState(0);
  /** 滚动阅读里，章回标题前要补的空白，让上一章在屏尾留白、下一章从新的一屏开始 */
  const [chapterBreaks, setChapterBreaks] = useState(EMPTY_BREAKS);
  const [scrollH, setScrollH] = useState(0);
  const chapterBreaksRef = useRef(EMPTY_BREAKS);
  const breakBook = useRef<string | undefined>(undefined);
  const onBlockLayout = useCallback(() => {
    setLayoutTick((n) => n + 1);
  }, []);
  const [win, setWin] = useState({ start: 0, end: 8 });
  // 必须放在所有 early return 之前：数据到达前后 hook 数量一旦变化，
  // React 会抛「Rendered more hooks than during the previous render」并卸载整页，
  // 表现就是点开书一片空白，一个字都看不到。
  const blockIndexes = useMemo(() => {
    const out: number[] = [];
    for (let i = win.start; i < win.end; i++) out.push(i);
    return out;
  }, [win]);
  const headingsByBlock = useMemo(() => {
    const map = new Map<number, readonly string[]>();
    for (const chapter of data?.chapters ?? []) {
      const prev = map.get(chapter.blockIndex) ?? NO_HEADINGS;
      map.set(chapter.blockIndex, [...prev, chapter.title]);
    }
    return map;
  }, [data]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<number | null>(null);
  /** 上一帧把目标行放到的 scrollTop。连续两次一样才算落稳，避免章前空白把行顶出视口。 */
  const placedTop = useRef<number | null>(null);
  const seekConfirm = useRef(false);
  const pageModeRef = useRef(settings.pageMode);
  const pagedRef = useRef<PagedHandle | null>(null);
  const [currentChar, setCurrentChar] = useState(0);
  const [pageInfo, setPageInfo] = useState({ index: 0, count: 1 });
  const [segLoading, setSegLoading] = useState(false);

  // 浮层
  const [sheet, setSheet] = useState<'search' | 'bookmark' | 'layout' | null>(null);
  const [footnote, setFootnote] = useState<{
    marker: string;
    text: string;
    rect: DOMRect;
    noteChar?: number;
  } | null>(null);
  const noteCache = useRef(new Map<number, Map<string, CollectedNote>>());
  const noteOpenedAt = useRef<number | null>(null);
  const [barsVisible, setBarsVisible] = useState(true);
  const [aloudNote, setAloudNote] = useState<string | null>(null);
  const [readPlace, setReadPlace] = useState(0);
  const [Aloud, setAloud] = useState<ComponentType<{
    bookId: string;
    anchorChar: number;
    chapterOffsets: readonly number[];
    /** 读者主动换了位置。朗读据此丢掉停止点。 */
    readPlace: number;
    index: BlockIndexView;
    readLines: (block: number) => Promise<string[]>;
    onFollow: (charOffset: number) => void;
    onClose: () => void;
  }> | null>(null);
  const bookmarksRef = useRef<Bookmark[]>([]);
  const [, bumpBookmarks] = useState(0);
  const [currentText, setCurrentText] = useState('');
  /** 已写回过「读完」标记，避免每次落盘都重复 touch */
  const finishedMarked = useRef(false);

  /* ────────────── 加载书籍 ────────────── */

  useEffect(() => {
    let alive = true;
    heights.current.clear();
    setHeightVersion((v) => v + 1);
    void (async () => {
      if (!bookId) return;
      const book = await getBook(bookId);
      if (!book) {
        setMissing('absent');
        return;
      }
      const [blockIndex, blob] = await Promise.all([getBlockIndex(bookId), getBookBlob(bookId)]);
      if (!blockIndex || !blob) {
        setMissing('absent');
        return;
      }
      // 正文为空说明这份导入没把文件体存下来（历史坏数据），
      // 直接说清楚，别让用户对着一页白纸猜。
      if (blob.size === 0) {
        setMissing('empty');
        return;
      }
      const [chapters, footnoteRec, saved, fonts] = await Promise.all([
        getChapters(bookId),
        getFootnotes(bookId),
        getProgress(bookId),
        listFonts(),
      ]);
      bookmarksRef.current = await listBookmarks(bookId);

      const idx: BlockIndexView = {
        starts: blockIndex.starts,
        charCounts: blockIndex.charCounts,
        charOffsets: blockIndex.charOffsets,
        lineCounts: blockIndex.lineCounts,
        count: blockIndex.count,
      };
      const reader = new BlockReader({
        blob,
        blockSize: blockIndex.blockSize,
        blockCount: blockIndex.count,
        starts: blockIndex.starts,
      });
      const pos = resolvePosition(idx, saved);

      if (!alive) return;
      pendingSeek.current = idx.charOffsets[pos.blockIndex] + pos.charTarget;
      setCurrentChar(pendingSeek.current);
      // 分页模式由 PagedView 自己落页。滚动模式先把窗口放到进度所在的块，
      // 否则 scrollTop 拉到中段时视口对着空白占位，要等下一次滚动才挂上正文。
      if (useSettings.getState().settings.pageMode !== 'page') {
        setWin(windowAround(pos.blockIndex, idx.count));
      }
      // 先把正文交出去：扉页摘要要额外解码几块，
      // 之前它是 await 在 setData 之前的，首屏就白白多等一段。
      setData({
        book,
        idx,
        chapters,
        footnotes: new Map(footnoteRec.map((f) => [f.marker, f.text])),
        reader,
        startBlock: pos.blockIndex,
        charInBlock: pos.charTarget,
        savedPercent: saved?.percent ?? 0,
        excerpt: [],
        userFonts: fonts.map((f) => ({ id: f.family, name: f.name })),
      });

      if (settings.showTitlePage) {
        void buildTitlePage(book, async (n) => {
          const out: string[] = [];
          for (let i = 0; i < Math.min(n, 4); i++)
            out.push(...(await reader.readLines(i)).slice(0, 8));
          return out;
        })
          .then((tp) => {
            if (!alive) return;
            setData((d) => (d && d.book.id === book.id ? { ...d, excerpt: tp.excerpt } : d));
          })
          .catch(() => {
            /* 摘要只是锦上添花，失败不影响阅读 */
          });
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  /* ────────────── 虚拟滚动核心 ────────────── */

  const typo = settings.typography;
  const linePx = lineHeightPx(typo.fontSize, typo.lineHeight);
  const gapPx = typo.paragraphSpacing * typo.fontSize;

  const heightOf = useCallback(
    (i: number): number => {
      const measured = heights.current.get(i);
      if (measured != null) return measured;
      if (!data) return 0;
      const lines = data.idx.lineCounts[i] ?? 0;
      return lines * (linePx + gapPx) + 8;
    },
    [data, linePx, gapPx],
  );

  const titleH = data && settings.showTitlePage ? (heights.current.get(-1) ?? 340) : 0;

  const tops = useMemo(() => {
    const n = data?.idx.count ?? 0;
    const arr = new Float64Array(n + 2);
    arr[0] = titleH; // 扉页
    for (let i = 0; i < n; i++) arr[i + 1] = arr[i] + heightOf(i);
    arr[n + 1] = arr[n];
    return arr;
    // heightVersion 参与依赖：块实测高度变化时重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, heightOf, titleH, heightVersion]);

  const total = tops[data?.idx.count ?? 0] ?? 0;

  const blockAtY = useCallback(
    (y: number): number => {
      let lo = 0;
      let hi = tops.length - 2;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (tops[mid] <= y) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    },
    [tops],
  );

  // 滚动 → 更新渲染窗口。pageMode 在依赖里：从分页切回来时滚动容器才挂上。
  useEffect(() => {
    if (settings.pageMode === 'page') return;
    const el = scrollRef.current;
    if (!el || !data) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        // 落位还没完成时滚动条可能被夹在 0，这时跟着改窗口会和落位来回抢。
        if (pendingSeek.current != null) return;
        const y = el.scrollTop;
        const bottomY = y + el.clientHeight;
        const first = blockAtY(Math.max(0, y - linePx * 4));
        const last = blockAtY(bottomY);
        setWin((w) => {
          const start = Math.max(0, first - 2);
          const end = Math.min(data.idx.count, last + 3);
          return Math.abs(w.start - start) + Math.abs(w.end - end) > 1 ? { start, end } : w;
        });
        const ch = firstVisibleChar();
        if (ch != null) setCurrentChar(ch);
      });
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, blockAtY, linePx, settings.pageMode]);

  // 块实测高度变化 → 修正上方偏移，防止滚动跳动
  useEffect(() => {
    const el = contentRef.current;
    const root = scrollRef.current;
    if (!el || !root || !data) return;
    // 扉页没有块号，高度记在 -1。它一变正文起点就得跟着挪，
    // 否则扉页（min-height: 62vh，常高于估算的 340）会直接压在正文上。
    const measureTitle = (target: HTMLElement): boolean => {
      const h = target.getBoundingClientRect().height;
      if (heights.current.get(-1) === h) return false;
      heights.current.set(-1, h);
      return true;
    };
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const target = e.target as HTMLElement;
        const bi = target.dataset.block;
        if (bi == null) {
          if (measureTitle(target)) changed = true;
          continue;
        }
        const idx = Number(bi);
        const h = target.getBoundingClientRect().height;
        const prev = heights.current.get(idx);
        if (prev === h) continue;
        // 修正锚点：整块都在视口上方时补偿 scrollTop。
        // 用变化前的底边判断，章末补上的空白才不会把正在看的内容往下顶。
        const prevH = prev ?? h;
        const blockTop = tops[idx] ?? 0;
        const anchorY = root.scrollTop;
        if (anchorY > blockTop + prevH) {
          root.scrollTop += h - prevH;
        }
        heights.current.set(idx, h);
        changed = true;
      }
      if (changed) setHeightVersion((v) => v + 1);
    });
    el.querySelectorAll<HTMLElement>('.qy-block').forEach((b) => ro.observe(b));
    const tp = el.querySelector<HTMLElement>('.title-page');
    let titleChanged = false;
    if (tp) {
      ro.observe(tp);
      titleChanged = measureTitle(tp);
    }
    if (titleChanged) setHeightVersion((v) => v + 1);
    return () => ro.disconnect();
  }, [data, win, tops]);

  // 滚动模式：章回标题对齐到视口页首。分页模式由 PagedView 自己推页。
  // biome-ignore lint/correctness/useExhaustiveDependencies: 字号、块高和视口高度变了都要重算章前空白
  useLayoutEffect(() => {
    if (settings.pageMode === 'page' || !data) return;
    const root = scrollRef.current;
    const content = contentRef.current;
    if (!root || !content) return;
    const pageH = root.clientHeight;
    if (pageH < 80) return;
    const nodes = content.querySelectorAll<HTMLElement>('.qy-line.qy-chapter');
    const contentTop = content.getBoundingClientRect().top;
    const openingChar = data.chapters[0]?.charOffset;
    const firstNode = nodes[0];
    const marks: ScrollChapterMark[] = [];
    const seen: number[] = [];
    const seenChar = new Set<number>();
    for (const node of nodes) {
      const char = Number(node.dataset.char);
      // 同一个字符偏移只量一次。重复节点会再推一整屏空白，章回就只剩标题牌。
      if (!Number.isFinite(char) || seenChar.has(char)) continue;
      seenChar.add(char);
      const spacerEl = node.previousElementSibling;
      const spacer =
        spacerEl instanceof HTMLElement && spacerEl.classList.contains('qy-page-break')
          ? spacerEl.getBoundingClientRect().height
          : 0;
      marks.push({
        char,
        top: node.getBoundingClientRect().top - contentTop,
        spacer,
        opening: char === openingChar || (win.start === 0 && node === firstNode),
      });
      seen.push(char);
    }
    const bookId = data.book.id;
    const prev = breakBook.current === bookId ? chapterBreaksRef.current : EMPTY_BREAKS;
    breakBook.current = bookId;
    const measured = scrollChapterBreaks(marks, pageH, prev);
    const next = applyMeasuredBreaks(prev, measured, seen);
    if (next !== prev) {
      chapterBreaksRef.current = next;
      setChapterBreaks(next);
    }
  }, [
    data,
    win,
    heightVersion,
    layoutTick,
    settings.pageMode,
    typo.fontSize,
    typo.lineHeight,
    typo.maxWidth,
    typo.paragraphSpacing,
    typo.letterSpacing,
    typo.textIndent,
    scrollH,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 正文挂上之后滚动容器才存在
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || settings.pageMode === 'page') return;
    const publish = () => {
      const next = root.clientHeight;
      setScrollH((prev) => (prev === next ? prev : next));
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(root);
    return () => ro.disconnect();
  }, [settings.pageMode, data]);

  /* ────────────── 定位 ────────────── */

  const firstVisibleChar = useCallback((): number | null => {
    const root = scrollRef.current;
    const el = contentRef.current;
    if (!root || !el) return null;
    const lines = el.querySelectorAll<HTMLElement>('.qy-line[data-char]');
    const rootTop = root.getBoundingClientRect().top;
    for (const l of lines) {
      const r = l.getBoundingClientRect();
      if (r.bottom > rootTop + linePx * 0.6) return Number(l.dataset.char);
    }
    return null;
  }, [linePx]);

  // 窗口渲染后应用精确跳转。必须在绘制前做完，否则中段进度的第一帧是空白占位。
  useLayoutEffect(() => {
    let raf = 0;
    const cleanup = () => {
      if (raf) cancelAnimationFrame(raf);
    };
    const prevMode = pageModeRef.current;
    pageModeRef.current = settings.pageMode;
    if (settings.pageMode === 'page') return cleanup;
    const root = scrollRef.current;
    if (!root || !data) return cleanup;
    // 行挂上、块高或章前空白变了都要再对一次位。
    void heightVersion;
    void layoutTick;
    void chapterBreaks;

    // 从分页切回来时，滚动容器是新建的，scrollTop 为 0。按当前进度重新落位，
    // 不能沿用打开时的 pending，也不能把 0 当成读者的位置写回进度。
    if (prevMode === 'page') {
      pendingSeek.current = currentChar;
      placedTop.current = null;
      seekConfirm.current = false;
      const block = blockAtCharOffset(data.idx, currentChar);
      const next = windowAround(block, data.idx.count);
      if (win.start !== next.start || win.end !== next.end) {
        setWin(next);
        return cleanup;
      }
    }

    const target = pendingSeek.current;
    if (target == null) return cleanup;
    const block = blockAtCharOffset(data.idx, target);
    const next = windowAround(block, data.idx.count);
    if (win.start > block || win.end <= block) {
      setWin(next);
      placeScroll(root, Math.max(0, (tops[block] ?? 0) - linePx));
      return cleanup;
    }
    const el = contentRef.current;
    const lines = el?.querySelectorAll<HTMLElement>('.qy-line[data-char]');
    const rough = Math.max(0, (tops[block] ?? 0) - linePx);
    if (!lines || lines.length === 0) {
      placeScroll(root, rough);
      return cleanup;
    }
    let hit: HTMLElement | null = null;
    for (const line of lines) {
      if (Number(line.dataset.char) >= target) {
        hit = line;
        break;
      }
    }
    if (!hit) {
      placeScroll(root, rough);
      for (let i = block; i < win.end; i++) {
        const node = el?.querySelector(`.qy-block[data-block="${i}"]`);
        if (!node?.querySelector('.qy-line[data-char]')) return cleanup;
      }
      pendingSeek.current = null;
      placedTop.current = null;
      return cleanup;
    }
    const rootTop = root.getBoundingClientRect().top;
    const landed = Math.max(0, hit.getBoundingClientRect().top - rootTop + root.scrollTop - 8);
    placeScroll(root, landed);
    const stable = placedTop.current != null && Math.abs(placedTop.current - landed) <= 1;
    placedTop.current = landed;
    // 第一次只记下位置。章前空白往往在下一帧才撑开，确认过再交还滚动。
    if (stable || seekConfirm.current) {
      setCurrentChar(target);
      pendingSeek.current = null;
      placedTop.current = null;
      seekConfirm.current = false;
      return cleanup;
    }
    seekConfirm.current = true;
    raf = requestAnimationFrame(() => setLayoutTick((n) => n + 1));
    return cleanup;
  }, [
    win,
    data,
    tops,
    heightVersion,
    layoutTick,
    linePx,
    settings.pageMode,
    chapterBreaks,
    currentChar,
  ]);

  const seekToChar = useCallback(
    (charOffset: number, blockHint?: number) => {
      if (!data) return;
      const clamped = clamp(
        charOffset,
        0,
        data.idx.charOffsets[data.idx.count - 1] + data.idx.charCounts[data.idx.count - 1],
      );
      const b = blockHint ?? blockAtCharOffset(data.idx, clamped);
      pendingSeek.current = clamped;
      // 先记下目标，朗读才知道人已经换了章节。等滚动落稳再写，会晚一拍。
      setCurrentChar(clamped);
      setWin({
        start: Math.max(0, b - 1),
        end: Math.min(data.idx.count, b + 3),
      });
      const y = tops[b] ?? 0;
      const root = scrollRef.current;
      if (root) placeScroll(root, Math.max(0, y - linePx));
    },
    [data, tops, linePx],
  );

  /** 统一的「跳转到某字符」：分页模式交给 PagedView，滚动模式用滚动定位 */
  const seek = useCallback(
    (char: number, blockHint?: number) => {
      if (settings.pageMode === 'page') {
        pagedRef.current?.seek(char, blockHint);
        setCurrentChar(char);
      } else {
        seekToChar(char, blockHint);
      }
    },
    [settings.pageMode, seekToChar],
  );

  /** 目录、进度、书签这些是读者自己选的位置，下一次朗读从这里开始。 */
  const jumpTo = useCallback(
    (char: number, blockHint?: number) => {
      if (bookId) clearReadMark(bookId);
      setReadPlace((n) => n + 1);
      seek(char, blockHint);
    },
    [bookId, seek],
  );

  const openNote = useCallback(
    (marker: string, rect: DOMRect, char: number, known?: string, noteChar?: number) => {
      noteOpenedAt.current = currentChar;
      if (known) {
        setFootnote({ marker, text: known, rect, noteChar });
        return;
      }
      setFootnote({ marker, text: '正在查找这条注释…', rect, noteChar });
      const loaded = data;
      if (!loaded) return;
      const chapter = loaded.chapters.length ? chapIndexAt(loaded.chapters, char) : -1;
      const cached = chapter >= 0 ? noteCache.current.get(chapter)?.get(marker) : undefined;
      if (cached) {
        setFootnote({ marker, text: cached.text, rect, noteChar: cached.char });
        return;
      }
      void (async () => {
        const flow = await readSegment(
          loaded.reader,
          loaded.idx,
          segmentOf(loaded.idx, loaded.chapters, char),
        );
        const found = collectNotes(flow);
        if (chapter >= 0) noteCache.current.set(chapter, found);
        const note = found.get(marker);
        const text = note?.text ?? loaded.footnotes.get(marker) ?? '这一章里没有找到对应注释。';
        setFootnote((current) =>
          current && current.marker === marker && current.rect === rect
            ? { marker, text, rect, noteChar: note?.char }
            : current,
        );
      })();
    },
    [data, currentChar],
  );

  useEffect(() => {
    noteCache.current.clear();
  }, [data?.book.id]);

  useEffect(() => {
    setFootnote((current) => (current && noteOpenedAt.current !== currentChar ? null : current));
  }, [currentChar]);

  // 当前可视文本（书签/摘录用）
  useEffect(() => {
    if (!data) return;
    let alive = true;
    void textAroundChar(data.reader, data.idx, currentChar).then((t) => {
      if (alive) setCurrentText(t);
    });
    return () => {
      alive = false;
    };
  }, [data, currentChar]);

  /* ────────────── 翻页 ────────────── */

  const turnPage = useCallback(
    (dir: 1 | -1) => {
      const root = scrollRef.current;
      if (!root) return;
      const step = Math.max(120, root.clientHeight - typo.fontSize * 2.5);
      const target = clamp(root.scrollTop + dir * step, 0, total);
      root.scrollTop = target;
      // 吸附到行首：翻页永不切断文字
      requestAnimationFrame(() => {
        const el = contentRef.current;
        if (!el) return;
        const lines = el.querySelectorAll<HTMLElement>('.qy-line[data-char]');
        if (!lines.length) return;
        const rootTop = root.getBoundingClientRect().top;
        if (dir === 1) {
          for (const l of lines) {
            if (l.getBoundingClientRect().top >= rootTop - 1) {
              root.scrollTop += l.getBoundingClientRect().top - rootTop;
              break;
            }
          }
        } else {
          let last: HTMLElement | null = null;
          for (const l of lines) {
            if (l.getBoundingClientRect().top < rootTop - 1) last = l;
            else break;
          }
          if (last) root.scrollTop += last.getBoundingClientRect().top - rootTop;
        }
      });
    },
    [total, typo.fontSize],
  );

  /** 统一的「翻一页」：分页模式翻一屏（双页时两列），滚动模式滚一屏 */
  const turn = useCallback(
    (dir: 1 | -1) => {
      if (settings.pageMode === 'page') pagedRef.current?.turn(dir);
      else turnPage(dir);
    },
    [settings.pageMode, turnPage],
  );

  /* ────────────── 键盘与手势 ────────────── */

  useEffect(() => {
    if (!settings.enableShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (footnote) setFootnote(null);
        setSheet(null);
        return;
      }
      if (sheet || footnote) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          turn(1);
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          turn(-1);
          break;
        case 't':
          updateSettings({ tocDocked: !useSettings.getState().settings.tocDocked });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings.enableShortcuts, turn, sheet, footnote]);

  // 水平滑动翻页
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isTouchDevice()) return;
    let x0 = 0;
    let y0 = 0;
    const ts = (e: TouchEvent) => {
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    };
    const te = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - x0;
      const dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6) turn(dx < 0 ? 1 : -1);
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchend', te, { passive: true });
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchend', te);
    };
  }, [turn]);

  /* ────────────── 进度落盘 ────────────── */

  /**
   * 位置落盘。分页 / 滚动两种模式统一走这里：
   * 原先只有滚动模式的 scroll 回调才写库，而默认是分页模式，
   * 于是整本书翻完一条进度都没存，退出重进只剩 0%。
   */
  const persist = useCallback(
    (ch: number) => {
      const d = data;
      if (!d) return;
      const last = d.idx.count - 1;
      const totalChars = (d.idx.charOffsets[last] ?? 0) + (d.idx.charCounts[last] ?? 0);
      if (totalChars <= 0) return;
      const charOffset = Math.round(clamp(ch, 0, totalChars));
      const percent = charOffset / totalChars;
      void saveProgress({
        bookId: d.book.id,
        chapterIndex: d.chapters.length ? chapIndexAt(d.chapters, charOffset) : 0,
        blockIndex: blockAtCharOffset(d.idx, charOffset),
        lineInBlock: 0,
        charOffset,
        percent,
        updatedAt: Date.now(),
        deviceId: settings.deviceId,
      });
      if (percent >= 0.995 && !finishedMarked.current) {
        finishedMarked.current = true;
        if (!d.book.finished) void touchBook(d.book.id, { finished: true, finishedAt: Date.now() });
      }
    },
    [data, settings.deviceId],
  );

  // 去抖实例只建一次：随 data 重建会把上一次的待写位置丢在半路
  const persistRef = useRef(persist);
  persistRef.current = persist;
  const scheduleSave = useMemo(() => debounce((ch: number) => persistRef.current(ch), 500), []);
  const charRef = useRef(0);

  // 位置一变就排队落盘（翻页 / 拖动进度条 / 目录跳转都会走到这里）
  useEffect(() => {
    if (!data) return;
    charRef.current = currentChar;
    scheduleSave(currentChar);
  }, [currentChar, data, scheduleSave]);

  // 关窗 / 切后台 / 离开阅读页：立刻写一次，别等去抖计时器
  useEffect(() => {
    const flush = () => {
      scheduleSave.cancel();
      persistRef.current(charRef.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, [scheduleSave]);

  /* ────────────── 渲染 ────────────── */

  if (missing) {
    return (
      <div className="reader">
        <div className="reader-bar top">
          <button
            type="button"
            className="qy-icon-btn"
            onClick={() => navigate('/')}
            aria-label="返回书架"
          >
            <IconChevronLeft />
          </button>
        </div>
        <EmptyState
          title={missing === 'empty' ? '这本书没有正文' : '找不到这本书'}
          hint={
            missing === 'empty'
              ? '导入时正文没能写入本地库，删掉这本书重新导入一次即可。'
              : '它可能已被删除，或索引文件缺失。回到书架重新导入即可。'
          }
          action={<Button onClick={() => navigate('/')}>返回书架</Button>}
        />
      </div>
    );
  }

  if (!data) {
    // 打开书的那一刻绝不能是黑屏：给一块书页骨架，
    // 让「在忙」这件事可见，而不是让人以为点坏了。
    return (
      <div className="reader">
        <div className="reader-loading" aria-busy="true">
          <div className="reader-loading-mark">轻阅</div>
          <div className="reader-loading-lines" aria-hidden>
            <span style={{ width: '92%' }} />
            <span style={{ width: '88%' }} />
            <span style={{ width: '94%' }} />
            <span style={{ width: '76%' }} />
            <span style={{ width: '90%' }} />
            <span style={{ width: '54%' }} />
          </div>
          <p>正在铺开书页…</p>
        </div>
      </div>
    );
  }

  const { book, idx, chapters, reader } = data;
  const totalChars = idx.charOffsets[idx.count - 1] + idx.charCounts[idx.count - 1];
  const percent = totalChars > 0 ? clamp(currentChar / totalChars, 0, 1) : 0;
  const currentChapter = chapters.length ? chapters[chapIndexAt(chapters, currentChar)] : null;
  const chapterName = currentChapter?.title ?? (chapters.length ? '' : book.title);

  const onContentTap = (e: React.MouseEvent) => {
    if (window.getSelection()?.toString()) return;
    if (!settings.tapToTurn) return;
    const x = e.clientX / window.innerWidth;
    if (x < 0.3) turn(-1);
    else if (x > 0.7) turn(1);
    else setBarsVisible((v) => !v);
  };

  const fontFamily =
    typo && settings.bodyFont === 'kai'
      ? 'var(--font-kai)'
      : settings.bodyFont === 'serif'
        ? 'var(--font-serif)'
        : settings.bodyFont === 'sans'
          ? 'var(--font-sans)'
          : `"${settings.bodyFont}", var(--font-kai)`;

  return (
    <div className={`reader${settings.tocDocked ? ' with-toc' : ''}`}>
      {settings.tocDocked && (
        <TocSidebar
          chapters={chapters}
          bookmarks={bookmarksRef.current}
          currentChar={currentChar}
          onJump={jumpTo}
          onJumpBookmark={(b) => jumpTo(b.charOffset)}
          onClose={() => updateSettings({ tocDocked: false })}
        />
      )}

      <div className="reader-main">
        <header
          className={`reader-bar top${barsVisible ? '' : ' hidden'}`}
          data-tauri-drag-region=""
        >
          <button
            type="button"
            className="qy-icon-btn"
            onClick={() => navigate('/')}
            aria-label="返回书架"
          >
            <IconChevronLeft />
          </button>
          <button
            type="button"
            className={`qy-icon-btn${settings.tocDocked ? ' on' : ''}`}
            onClick={() => updateSettings({ tocDocked: !settings.tocDocked })}
            aria-label={settings.tocDocked ? '收起目录' : '展开目录'}
            aria-pressed={settings.tocDocked}
          >
            <IconList />
          </button>
          <span className="title" data-tauri-drag-region="">
            {book.title}
          </span>
          <button
            type="button"
            className="qy-icon-btn"
            onClick={() => setSheet('search')}
            aria-label="搜索"
          >
            <IconSearch />
          </button>
        </header>

        {settings.pageMode === 'page' ? (
          <div className="reader-paged-wrap" onClick={onContentTap}>
            <PagedView
              idx={idx}
              reader={reader}
              chapters={chapters}
              typography={typo}
              fontFamily={fontFamily}
              charOffset={currentChar}
              startBlock={data.startBlock}
              onCharChange={setCurrentChar}
              onFootnote={openNote}
              flipAnimation={settings.flipAnimation}
              handleRef={pagedRef}
              onLoadingChange={setSegLoading}
              onPageInfo={setPageInfo}
            />
          </div>
        ) : (
          <div ref={scrollRef} className="reader-scroll" onClick={onContentTap}>
            <div
              ref={contentRef}
              className="reader-content"
              style={
                {
                  maxWidth: `calc((${typo.maxWidth}ch + 48px) * var(--w-scale, 1))`,
                  '--fs': `${typo.fontSize}px`,
                  '--lh': typo.lineHeight,
                  '--indent': `${typo.textIndent}em`,
                  '--ls': `${typo.letterSpacing}em`,
                  fontFamily,
                  fontSize: typo.fontSize,
                  lineHeight: typo.lineHeight,
                } as React.CSSProperties
              }
            >
              {/* 扉页占位用 min-height：实测高度回来之前也不会被正文压住 */}
              <div style={{ minHeight: tops[0] }} aria-hidden={win.start > 0}>
                {settings.showTitlePage && win.start === 0 && (
                  <TitlePageView book={book} excerpt={data.excerpt} />
                )}
              </div>
              {/* 上方占位 */}
              <div style={{ height: Math.max(0, tops[win.start] - tops[0]) }} aria-hidden />
              {blockIndexes.map((i) => (
                <LazyBlock
                  key={i}
                  index={i}
                  reader={reader}
                  charBase={idx.charOffsets[i] ?? 0}
                  fontSize={typo.fontSize}
                  headings={headingsByBlock.get(i) ?? NO_HEADINGS}
                  chapterBreaks={chapterBreaks}
                  onLayout={onBlockLayout}
                  onFootnote={openNote}
                />
              ))}
              {/* 下方占位 */}
              <div style={{ height: Math.max(0, total - tops[win.end]) }} aria-hidden />
            </div>
          </div>
        )}

        <footer className={`reader-bar bottom${barsVisible ? '' : ' hidden'}`}>
          <span className="chapter">
            {chapterName}
            {settings.pageMode === 'page' && pageInfo.count > 1 && (
              <span className="page-no">
                {' '}
                · {pageInfo.index + 1} / {pageInfo.count}
              </span>
            )}
            {segLoading && <span className="page-no"> · 装订中…</span>}
          </span>
          <div className="reader-progress-row">
            <span className="pct">{formatPercent(percent)}</span>
            <input
              type="range"
              min={0}
              max={1000}
              value={Math.round(percent * 1000)}
              style={{ '--pct': `${percent * 100}%` } as React.CSSProperties}
              onChange={(e) => jumpTo((Number(e.target.value) / 1000) * totalChars)}
              aria-label="阅读进度"
            />
            <span className="pct">
              {totalChars > 0 ? formatRemaining(totalChars - currentChar) : ''}
            </span>
          </div>
          <div className="reader-tools">
            <button
              type="button"
              className="qy-icon-btn"
              onClick={() => turn(-1)}
              aria-label="上一页"
            >
              <IconChevronLeft />
            </button>
            <button
              type="button"
              className={`qy-icon-btn${settings.tocDocked ? ' on' : ''}`}
              onClick={() => updateSettings({ tocDocked: !settings.tocDocked })}
              aria-label="目录"
              aria-pressed={settings.tocDocked}
            >
              <IconList />
            </button>
            <button
              type="button"
              className="qy-icon-btn"
              onClick={() => setSheet('bookmark')}
              aria-label="书签"
            >
              <IconBookmark />
            </button>
            <button
              type="button"
              className="qy-icon-btn"
              onClick={() => setSheet('layout')}
              aria-label="排版"
            >
              <IconSettings2 />
            </button>
            <button
              type="button"
              className="qy-icon-btn"
              aria-label="切换昼夜"
              onClick={() =>
                updateSettings({
                  themeMode: useSettings.getState().resolvedTheme === 'night' ? 'day' : 'night',
                })
              }
            >
              {useSettings.getState().resolvedTheme === 'night' ? <IconSun /> : <IconMoon />}
            </button>
            <button
              type="button"
              className="qy-icon-btn"
              aria-label="朗读"
              onClick={() => {
                if (!desktopReadingReady()) {
                  setAloudNote('朗读即将支持');
                  return;
                }
                void import('./ReadAloud').then((mod) => setAloud(() => mod.ReadAloud));
              }}
            >
              读
            </button>
            <button
              type="button"
              className="qy-icon-btn"
              onClick={() => turn(1)}
              aria-label="下一页"
            >
              <IconChevronRight />
            </button>
          </div>
          {aloudNote && <span className="hint">{aloudNote}</span>}
          {Aloud && (
            <Aloud
              bookId={book.id}
              anchorChar={currentChar}
              chapterOffsets={chapters.map((chapter) => chapter.charOffset)}
              readPlace={readPlace}
              index={idx}
              readLines={(block) => reader.readLines(block)}
              onFollow={seek}
              onClose={() => setAloud(null)}
            />
          )}
          {settings.showProgressHints && percent > 0.9 && percent < 1 && (
            <span className="hint">快读完啦，还剩 {formatRemaining(totalChars - currentChar)}</span>
          )}
        </footer>
      </div>

      <SearchSheet
        open={sheet === 'search'}
        onClose={() => setSheet(null)}
        book={book}
        onJump={jumpTo}
      />
      <BookmarkSheet
        open={sheet === 'bookmark'}
        onClose={() => setSheet(null)}
        bookId={book.id}
        current={
          currentText
            ? {
                charOffset: currentChar,
                blockIndex: blockAtCharOffset(idx, currentChar),
                lineInBlock: 0,
                text: currentText,
              }
            : null
        }
        onJump={(b) => jumpTo(b.charOffset)}
        onChanged={() => {
          void listBookmarks(book.id).then((bs) => {
            bookmarksRef.current = bs;
            bumpBookmarks((v) => v + 1);
          });
        }}
      />
      <LayoutSheet
        open={sheet === 'layout'}
        onClose={() => setSheet(null)}
        typography={typo}
        onChange={updateTypography}
        themeMode={settings.themeMode}
        resolvedTheme={useSettings.getState().resolvedTheme}
        onTheme={(t) => updateSettings({ themeMode: t })}
        pageMode={settings.pageMode}
        onPageMode={(m) => updateSettings({ pageMode: m })}
        bodyFont={settings.bodyFont}
        onBodyFont={(f) => updateSettings({ bodyFont: f })}
        userFontNames={data.userFonts}
        flipAnimation={settings.flipAnimation}
        onFlipAnimation={(v) => updateSettings({ flipAnimation: v })}
        showTitlePage={settings.showTitlePage}
        onShowTitlePage={(v) => updateSettings({ showTitlePage: v })}
      />
      <NotePopover
        marker={footnote?.marker ?? null}
        text={footnote?.text ?? null}
        rect={footnote?.rect ?? null}
        noteChar={footnote?.noteChar}
        onJump={(char) => {
          setFootnote(null);
          jumpTo(char);
        }}
        onClose={() => setFootnote(null)}
      />
      {toast ? null : null}
      <span hidden>
        <IconBook />
      </span>
    </div>
  );
}

/* ────────────── 块组件 ────────────── */

function LazyBlock({
  index,
  reader,
  charBase,
  fontSize,
  headings,
  chapterBreaks,
  onLayout,
  onFootnote,
}: {
  index: number;
  reader: BlockReader;
  charBase: number;
  fontSize: number;
  headings: readonly string[];
  chapterBreaks: ReadonlyMap<number, number>;
  onLayout: () => void;
  onFootnote: (
    marker: string,
    anchor: DOMRect,
    char: number,
    text?: string,
    noteChar?: number,
  ) => void;
}) {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    void reader.readLines(index).then((ls) => {
      if (alive) setLines(ls);
    });
    return () => {
      alive = false;
    };
  }, [reader, index]);

  useLayoutEffect(() => {
    if (lines) onLayout();
  }, [lines, onLayout]);

  const seen = new Set<string>();
  const positioned = lines ? positionedLines(lines, charBase) : [];
  const blockNotes = collectNotes(positioned);
  return (
    <section className="qy-block" data-block={index}>
      {lines === null ? (
        <div style={{ height: fontSize * 2 }} aria-hidden />
      ) : (
        positioned.map((line) => {
          if (!line.text) return null;
          if (headingRepeat(line.text, seen)) return null;
          const plate = takeHeadingPlate(line.text, headings, seen);
          if (plate) {
            const gap = chapterBreaks.get(line.char) ?? 0;
            return (
              <Fragment key={`ln-${line.char}`}>
                <div className="qy-page-break" style={{ height: gap }} aria-hidden="true" />
                <ChapterHeading char={line.char} plate={plate} />
              </Fragment>
            );
          }
          return (
            <AnnotatedLine
              key={`ln-${line.char}`}
              text={line.text}
              char={line.char}
              onNote={(marker, anchor, at) => {
                const found = blockNotes.get(marker);
                onFootnote(marker, anchor, at, found?.text, found?.char);
              }}
            />
          );
        })
      )}
    </section>
  );
}

function windowAround(block: number, count: number): { start: number; end: number } {
  const start = Math.max(0, block - 2);
  const end = Math.min(count, Math.max(block + 6, start + 8));
  return { start, end };
}

/** 程序改完 scrollTop 后把滚动层标脏，否则 WebKit 要等鼠标或按键才画出新位置。 */
function placeScroll(node: HTMLElement, y: number) {
  const next = Math.max(0, y);
  node.scrollTop = next;
  if (Math.abs(node.scrollTop - next) > 1) return;
  // 一次写到位时，有的 WebKit 不画新视口。再脏 1px 才补上这一帧。
  node.scrollTop = next + 1;
  node.scrollTop = next;
  void node.getBoundingClientRect();
}

function applyMeasuredBreaks(
  prev: ReadonlyMap<number, number>,
  measured: ReadonlyMap<number, number>,
  seen: readonly number[],
): ReadonlyMap<number, number> {
  let changed = false;
  const next = new Map(prev);
  for (const char of seen) {
    const height = measured.get(char) ?? 0;
    const old = next.get(char) ?? 0;
    if (height === old) continue;
    if (height > 0 && old > 0 && Math.abs(height - old) <= 1) continue;
    changed = true;
    if (height > 0) next.set(char, height);
    else next.delete(char);
  }
  return changed ? next : prev;
}

function positionedLines(lines: string[], charBase: number): { text: string; char: number }[] {
  const out: { text: string; char: number }[] = [];
  let acc = 0;
  for (const raw of lines) {
    if (!isPageBreakLine(raw)) out.push({ text: trimLeadingSpaces(raw), char: charBase + acc });
    acc += raw.length + 1;
  }
  return out;
}

function blockAtCharOffset(idx: BlockIndexView, charOffset: number): number {
  let lo = 0;
  let hi = idx.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((idx.charOffsets[mid] ?? 0) <= charOffset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function chapIndexAt(chapters: Chapter[], charOffset: number): number {
  let lo = 0;
  let hi = chapters.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (chapters[mid].charOffset <= charOffset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

async function textAroundChar(
  reader: BlockReader,
  idx: BlockIndexView,
  charOffset: number,
): Promise<string> {
  const b = blockAtCharOffset(idx, charOffset);
  const lines = await reader.readLines(b);
  const base = idx.charOffsets[b] ?? 0;
  let acc = 0;
  for (const l of lines) {
    if (base + acc + l.length >= charOffset) return trimLeadingSpaces(l).slice(0, 60);
    acc += l.length + 1;
  }
  return '';
}

function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
}

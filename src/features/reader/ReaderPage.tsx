/**
 * 阅读器主页面：块级虚拟滚动 + 行级锚点定位。
 *
 * 性能设计：
 *   · 任意时刻只渲染视口 ±2~3 块，100MB 与 1MB 的书渲染成本相同；
 *   · 未渲染块高度用「行数 × 行高 + 段距」估算，滚动条比例从一开始就是准的；
 *   · 渲染过的块记录实测高度（ResizeObserver），估算逐步收敛为精确值；
 *   · 进度锚点 = 全书可见字符偏移（charOffset），换字号/换设备不漂移。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useSettings } from '@/app/store';
import type { Book, Chapter } from '@/types/models';
import { getBook } from '@/storage/repositories/bookRepo';
import { getBookBlob } from '@/storage/blobStore';
import { getBlockIndex, getChapters, getFootnotes, touchBook } from '@/storage/repositories/bookRepo';
import { getProgress, saveProgress } from '@/storage/repositories/progressRepo';
import { listBookmarks } from '@/storage/repositories/bookmarkRepo';
import { listFonts } from '@/storage/fontStore';
import { BlockReader } from '@/core/reader/blockReader';
import { resolvePosition, type BlockIndexView } from '@/core/reader/progress';
import { splitByRefs } from '@/core/parser/footnotes';
import { lineHeightPx } from '@/core/text/typography';
import { trimLeadingSpaces } from '@/core/text/sanitize';
import { buildTitlePage } from '@/core/reader/titlepage';
import { debounce } from '@/lib/throttle';
import { formatPercent, formatRemaining, clamp } from '@/lib/format';
import type { Bookmark } from '@/types/models';
import { Button, EmptyState, useToast } from '@/ui';
import {
  IconBook,
  IconBookmark,
  IconChevronLeft,
  IconList,
  IconMoon,
  IconSearch,
  IconSettings2,
  IconSun,
} from '@/ui/icons';
import {
  BookmarkSheet,
  FootnoteSheet,
  LayoutSheet,
  SearchSheet,
  TocSheet,
} from './ReaderSheets';
import { TitlePageView } from './TitlePage';
import './reader.css';

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
  const [missing, setMissing] = useState(false);

  // 虚拟滚动状态
  const heights = useRef(new Map<number, number>());
  const [heightVersion, setHeightVersion] = useState(0);
  const [win, setWin] = useState({ start: 0, end: 8 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingSeek = useRef<number | null>(null);
  const [currentChar, setCurrentChar] = useState(0);

  // 浮层
  const [sheet, setSheet] = useState<'toc' | 'search' | 'bookmark' | 'layout' | null>(null);
  const [footnote, setFootnote] = useState<{ marker: string; text: string } | null>(null);
  const [barsVisible, setBarsVisible] = useState(true);
  const bookmarksRef = useRef<Bookmark[]>([]);
  const [, bumpBookmarks] = useState(0);
  const [currentText, setCurrentText] = useState('');

  /* ────────────── 加载书籍 ────────────── */

  useEffect(() => {
    let alive = true;
    heights.current.clear();
    setHeightVersion((v) => v + 1);
    void (async () => {
      if (!bookId) return;
      const book = await getBook(bookId);
      if (!book) {
        setMissing(true);
        return;
      }
      const [blockIndex, blob] = await Promise.all([getBlockIndex(bookId), getBookBlob(bookId)]);
      if (!blockIndex || !blob) {
        setMissing(true);
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
      const reader = new BlockReader({ blob, blockSize: blockIndex.blockSize, blockCount: blockIndex.count, starts: blockIndex.starts });
      const pos = resolvePosition(idx, saved);
      const excerpt = settings.showTitlePage
        ? (await buildTitlePage(book, async (n) => {
            const out: string[] = [];
            for (let i = 0; i < Math.min(n, 4); i++) out.push(...(await reader.readLines(i)).slice(0, 8));
            return out;
          })).excerpt
        : [];

      if (!alive) return;
      pendingSeek.current = idx.charOffsets[pos.blockIndex] + pos.charTarget;
      setCurrentChar(pendingSeek.current);
      setData({
        book,
        idx,
        chapters,
        footnotes: new Map(footnoteRec.map((f) => [f.marker, f.text])),
        reader,
        startBlock: pos.blockIndex,
        charInBlock: pos.charTarget,
        savedPercent: saved?.percent ?? 0,
        excerpt,
        userFonts: fonts.map((f) => ({ id: f.family, name: f.name })),
      });
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

  const titleH = data && settings.showTitlePage ? heights.current.get(-1) ?? 340 : 0;

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

  // 滚动 → 更新渲染窗口
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !data) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = el.scrollTop;
        const bottomY = y + el.clientHeight;
        const first = blockAtY(Math.max(0, y - linePx * 4));
        const last = blockAtY(bottomY);
        setWin((w) => {
          const start = Math.max(0, first - 2);
          const end = Math.min(data.idx.count, last + 3);
          return Math.abs(w.start - start) + Math.abs(w.end - end) > 1 ? { start, end } : w;
        });
        scheduleSave();
        const ch = firstVisibleChar();
        if (ch != null) setCurrentChar(ch);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, blockAtY, linePx]);

  // 块实测高度变化 → 修正上方偏移，防止滚动跳动
  useEffect(() => {
    const el = contentRef.current;
    const root = scrollRef.current;
    if (!el || !root || !data) return;
    const ro = new ResizeObserver((entries) => {
      let changed = false;
      for (const e of entries) {
        const bi = (e.target as HTMLElement).dataset.block;
        if (bi == null) continue;
        const idx = Number(bi);
        const h = (e.target as HTMLElement).getBoundingClientRect().height;
        const prev = heights.current.get(idx);
        if (prev === h) continue;
        // 修正锚点：高度变化发生在视口上方时补偿 scrollTop
        const blockTop = tops[idx] ?? 0;
        const anchorY = root.scrollTop;
        if (anchorY > blockTop + h) {
          root.scrollTop += h - (prev ?? h);
        }
        heights.current.set(idx, h);
        changed = true;
      }
      if (changed) setHeightVersion((v) => v + 1);
    });
    el.querySelectorAll<HTMLElement>('.qy-block').forEach((b) => ro.observe(b));
    const tp = el.querySelector<HTMLElement>('.title-page');
    if (tp) {
      ro.observe(tp);
      heights.current.set(-1, tp.getBoundingClientRect().height);
    }
    return () => ro.disconnect();
  }, [data, win, tops]);

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

  // 窗口渲染后应用精确跳转
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || !data) return;
    const target = pendingSeek.current;
    if (target == null) return;
    const el = contentRef.current;
    if (!el) return;
    const lines = el.querySelectorAll<HTMLElement>('.qy-line[data-char]');
    if (lines.length === 0) return;
    const rootTop = root.getBoundingClientRect().top;
    let hit: HTMLElement | null = null;
    for (const l of lines) {
      const cs = Number(l.dataset.char);
      if (cs >= target) {
        hit = l;
        break;
      }
    }
    if (hit) {
      const top = hit.getBoundingClientRect().top - rootTop + root.scrollTop;
      root.scrollTop = Math.max(0, top - 8);
      setCurrentChar(target);
      pendingSeek.current = null;
    }
  }, [win, data, tops, heightVersion]);

  const seekToChar = useCallback(
    (charOffset: number) => {
      if (!data) return;
      const clamped = clamp(charOffset, 0, data.idx.charOffsets[data.idx.count - 1] + data.idx.charCounts[data.idx.count - 1]);
      const b = blockAtCharOffset(data.idx, clamped);
      pendingSeek.current = clamped;
      const y = tops[b] ?? 0;
      const root = scrollRef.current;
      if (root) root.scrollTop = Math.max(0, y - linePx);
    },
    [data, tops, linePx],
  );

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

  /* ────────────── 键盘与手势 ────────────── */

  useEffect(() => {
    if (!settings.enableShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (sheet || footnote) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
        case ' ':
          e.preventDefault();
          if (settings.pageMode === 'page') turnPage(1);
          else scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.85, behavior: 'smooth' });
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          if (settings.pageMode === 'page') turnPage(-1);
          else scrollRef.current?.scrollBy({ top: -scrollRef.current.clientHeight * 0.85, behavior: 'smooth' });
          break;
        case 't':
          setSheet((s) => (s === 'toc' ? null : 'toc'));
          break;
        case 'Escape':
          setSheet(null);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings.enableShortcuts, settings.pageMode, turnPage, sheet, footnote]);

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
      if (Math.abs(dx) > 64 && Math.abs(dx) > Math.abs(dy) * 1.6) turnPage(dx < 0 ? 1 : -1);
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchend', te, { passive: true });
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchend', te);
    };
  }, [turnPage]);

  /* ────────────── 进度落盘 ────────────── */

  const scheduleSave = useMemo(
    () =>
      debounce(() => {
        const d = data;
        if (!d) return;
        const ch = firstVisibleChar();
        if (ch == null) return;
        const totalChars = d.idx.charOffsets[d.idx.count - 1] + d.idx.charCounts[d.idx.count - 1];
        const percent = totalChars > 0 ? ch / totalChars : 0;
        void saveProgress({
          bookId: d.book.id,
          chapterIndex: 0,
          blockIndex: 0,
          lineInBlock: 0,
          charOffset: ch,
          percent,
          updatedAt: Date.now(),
          deviceId: settings.deviceId,
        });
        if (percent >= 0.995 && !d.book.finished) {
          void touchBook(d.book.id, { finished: true, finishedAt: Date.now() });
        }
      }, 500),
    [data, firstVisibleChar, settings.deviceId],
  );

  useEffect(() => {
    const flush = () => scheduleSave.flush();
    document.addEventListener('visibilitychange', flush);
    return () => {
      document.removeEventListener('visibilitychange', flush);
      flush();
      scheduleSave.cancel();
    };
  }, [scheduleSave]);

  /* ────────────── 渲染 ────────────── */

  if (missing) {
    return (
      <div className="reader">
        <div className="reader-bar top">
          <button type="button" className="qy-icon-btn" onClick={() => navigate('/')} aria-label="返回书架">
            <IconChevronLeft />
          </button>
        </div>
        <EmptyState
          title="找不到这本书"
          hint="它可能已被删除，或索引文件缺失。回到书架重新导入即可。"
          action={<Button onClick={() => navigate('/')}>返回书架</Button>}
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="reader">
        <EmptyState title="书页翻动中…" />
      </div>
    );
  }

  const { book, idx, chapters, reader } = data;
  const totalChars = idx.charOffsets[idx.count - 1] + idx.charCounts[idx.count - 1];
  const percent = totalChars > 0 ? clamp(currentChar / totalChars, 0, 1) : 0;
  const currentChapter = chapters.length
    ? chapters[chapIndexAt(chapters, currentChar)]
    : null;
  const chapterName = currentChapter?.title ?? (chapters.length ? '' : book.title);

  const blockIndexes = useMemo(() => {
    const out: number[] = [];
    for (let i = win.start; i < win.end; i++) out.push(i);
    return out;
  }, [win]);

  const onContentTap = (e: React.MouseEvent) => {
    if (window.getSelection()?.toString()) return;
    if (!settings.tapToTurn || settings.pageMode !== 'page') return;
    const x = e.clientX / window.innerWidth;
    if (x < 0.3) turnPage(-1);
    else if (x > 0.7) turnPage(1);
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
    <div className="reader">
      <header className={`reader-bar top${barsVisible ? '' : ' hidden'}`}>
        <button type="button" className="qy-icon-btn" onClick={() => navigate('/')} aria-label="返回书架">
          <IconChevronLeft />
        </button>
        <span className="title">{book.title}</span>
        <button
          type="button"
          className="qy-icon-btn"
          onClick={() => setSheet('search')}
          aria-label="搜索"
        >
          <IconSearch />
        </button>
      </header>

      <div
        ref={scrollRef}
        className="reader-scroll"
        style={settings.pageMode === 'page' ? { scrollbarWidth: 'none' } : undefined}
      >
        <div
          ref={contentRef}
          className="reader-content"
          onClick={onContentTap}
          style={{
            maxWidth: `calc(${typo.maxWidth}ch + 48px)`,
            '--fs': `${typo.fontSize}px`,
            '--lh': typo.lineHeight,
            '--indent': `${typo.textIndent}em`,
            '--ls': `${typo.letterSpacing}em`,
            fontFamily,
            fontSize: typo.fontSize,
            lineHeight: typo.lineHeight,
          } as React.CSSProperties}
        >
          <div style={{ height: tops[0] }} aria-hidden={win.start > 0}>
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
              hasFootnotes={data.footnotes.size > 0}
              onFootnote={(m) =>
                setFootnote({ marker: m, text: data.footnotes.get(m) ?? '未找到对应注释。' })
              }
            />
          ))}
          {/* 下方占位 */}
          <div style={{ height: Math.max(0, total - tops[win.end]) }} aria-hidden />
        </div>
      </div>

      <footer className={`reader-bar bottom${barsVisible ? '' : ' hidden'}`}>
        <span className="chapter">{chapterName}</span>
        <div className="reader-progress-row">
          <span className="pct">{formatPercent(percent)}</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(percent * 1000)}
            style={{ '--pct': `${percent * 100}%` } as React.CSSProperties}
            onChange={(e) => seekToChar((Number(e.target.value) / 1000) * totalChars)}
            aria-label="阅读进度"
          />
          <span className="pct">{totalChars > 0 ? formatRemaining(totalChars - currentChar) : ''}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-around' }}>
          <button type="button" className="qy-icon-btn" onClick={() => setSheet('toc')} aria-label="目录">
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
          <button type="button" className="qy-icon-btn" onClick={() => setSheet('layout')} aria-label="排版">
            <IconSettings2 />
          </button>
          <button
            type="button"
            className="qy-icon-btn"
            aria-label="切换昼夜"
            onClick={() =>
              updateSettings({ themeMode: useSettings.getState().resolvedTheme === 'night' ? 'day' : 'night' })
            }
          >
            {useSettings.getState().resolvedTheme === 'night' ? <IconSun /> : <IconMoon />}
          </button>
        </div>
        {settings.showProgressHints && percent > 0.9 && percent < 1 && (
          <span className="hint">快读完啦，还剩 {formatRemaining(totalChars - currentChar)}</span>
        )}
      </footer>

      <TocSheet
        open={sheet === 'toc'}
        onClose={() => setSheet(null)}
        chapters={chapters}
        idx={idx}
        currentCharOffset={currentChar}
        onJump={seekToChar}
        bookmarks={bookmarksRef.current}
        onJumpBookmark={(b) => seekToChar(b.charOffset)}
      />
      <SearchSheet
        open={sheet === 'search'}
        onClose={() => setSheet(null)}
        book={book}
        onJump={seekToChar}
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
        onJump={(b) => seekToChar(b.charOffset)}
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
      <FootnoteSheet
        marker={footnote?.marker ?? null}
        text={footnote?.text ?? null}
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
  hasFootnotes,
  onFootnote,
}: {
  index: number;
  reader: BlockReader;
  charBase: number;
  fontSize: number;
  hasFootnotes: boolean;
  onFootnote: (marker: string) => void;
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

  return (
    <section className="qy-block" data-block={index}>
      {lines === null ? (
        <div style={{ height: fontSize * 2 }} aria-hidden />
      ) : (
        lines.map((line, li) => {
          const char = charBase + charsBefore(lines, li);
          const t = trimLeadingSpaces(line);
          if (!t) return null; // 空行交给段距表达
          const parts = hasFootnotes ? splitByRefs(t) : null;
          return (
            <p className="qy-line" data-char={char} key={li}>
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
                : t}
            </p>
          );
        })
      )}
    </section>
  );
}

function charsBefore(lines: string[], upto: number): number {
  let n = 0;
  for (let i = 0; i < upto; i++) n += lines[i].length + 1;
  return n;
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


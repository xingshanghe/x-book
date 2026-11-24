/**
 * 连环画 / 扫描版 PDF 阅读器：适屏、捏合缩放、滑/点翻页、按页进度与书签。
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useLocation } from 'wouter';
import { useSettings } from '@/app/store';
import {
  clampPageIndex,
  cappedDpr,
  clampPan,
  fitScale,
  pagePercent,
  panBounds,
} from '@/features/comic/fit';
import { PdfEngine } from '@/features/comic/pdfEngine';
import { formatPercent } from '@/lib/format';
import { getBookBlob } from '@/storage/blobStore';
import { putBookCover } from '@/storage/coverStore';
import { addBookmark, listBookmarks, removeBookmark } from '@/storage/repositories/bookmarkRepo';
import { getBook, touchBook } from '@/storage/repositories/bookRepo';
import { getProgress, saveProgress } from '@/storage/repositories/progressRepo';
import type { Book, Bookmark, ComicFitMode } from '@/types/models';
import { Button, EmptyState, toast } from '@/ui';
import {
  IconBookmark,
  IconChevronLeft,
  IconChevronRight,
  IconMinus,
  IconPlus,
} from '@/ui/icons';
import './comic.css';

const FIT_OPTIONS: { id: ComicFitMode; label: string }[] = [
  { id: 'fitPage', label: '整页' },
  { id: 'fitWidth', label: '适宽' },
  { id: 'fitHeight', label: '适高' },
];

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const SWIPE_THRESHOLD = 56;

type LoadState = 'loading' | 'ready' | 'error' | 'absent';

export function ComicReader({ id, params }: { id?: string; params?: { id: string } }) {
  const bookId = id ?? params?.id;
  const [, navigate] = useLocation();
  const settings = useSettings((s) => s.settings);
  const updateSettings = useSettings((s) => s.update);

  const [book, setBook] = useState<Book | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [barsVisible, setBarsVisible] = useState(true);
  /** 用户可见缩放（捏合过程中实时更新，用 CSS 表达） */
  const [zoom, setZoom] = useState(1);
  /** 已栅格化的缩放；捏合结束后再对齐，避免每帧重渲 */
  const [rasterZoom, setRasterZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [animating, setAnimating] = useState(false);
  const [panning, setPanning] = useState(false);
  const [bitmapUrl, setBitmapUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [pageSize, setPageSize] = useState({ width: 1, height: 1 });

  const fitMode = settings.comicFitMode ?? 'fitPage';
  const engineRef = useRef<PdfEngine | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const pageIndexRef = useRef(0);
  const pageCountRef = useRef(0);
  const zoomRef = useRef(1);
  const panRef = useRef({ x: 0, y: 0 });
  const persistRef = useRef<(index: number, count: number) => void>(() => undefined);
  const gesture = useRef<{
    mode: 'none' | 'pan' | 'swipe' | 'pinch';
    startX: number;
    startY: number;
    originPan: { x: number; y: number };
    startDist: number;
    startZoom: number;
    moved: boolean;
  } | null>(null);
  const urlRef = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const finishedMarked = useRef(false);
  const rasterTimer = useRef<number | null>(null);

  const baseFit = fitScale(pageSize.width, pageSize.height, viewport.w, viewport.h, fitMode);
  const displayW = pageSize.width * baseFit * zoom;
  const displayH = pageSize.height * baseFit * zoom;

  const goBack = useCallback(() => navigate('/'), [navigate]);

  const persistProgress = useCallback(
    (index: number, count: number) => {
      if (!bookId || count <= 0) return;
      const percent = pagePercent(index, count);
      const deviceId = useSettings.getState().settings.deviceId;
      void saveProgress({
        bookId,
        chapterIndex: 0,
        blockIndex: index,
        lineInBlock: 0,
        charOffset: index,
        percent,
        updatedAt: Date.now(),
        deviceId,
      });
      if (percent >= 0.995 && !finishedMarked.current) {
        finishedMarked.current = true;
        void touchBook(bookId, { finished: true, finishedAt: Date.now() });
      }
    },
    [bookId],
  );

  const scheduleSave = useCallback(
    (index: number, count: number) => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => persistProgress(index, count), 400);
    },
    [persistProgress],
  );

  const commitRasterZoom = useCallback((next: number) => {
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    setZoom(z);
    if (rasterTimer.current) window.clearTimeout(rasterTimer.current);
    rasterTimer.current = window.setTimeout(() => setRasterZoom(z), 120);
  }, []);

  pageIndexRef.current = pageIndex;
  pageCountRef.current = pageCount;
  zoomRef.current = zoom;
  panRef.current = pan;
  persistRef.current = persistProgress;

  /* ── 打开 PDF ── */
  useEffect(() => {
    let alive = true;
    finishedMarked.current = false;
    void (async () => {
      if (!bookId) return;
      setLoadState('loading');
      const rec = await getBook(bookId);
      if (!alive) return;
      if (!rec) {
        setLoadState('absent');
        return;
      }
      setBook(rec);
      const blob = await getBookBlob(bookId);
      if (!alive) return;
      if (!blob || blob.size === 0) {
        setLoadState('error');
        setErrorMsg('PDF 文件缺失或为空');
        return;
      }
      const engine = new PdfEngine();
      engineRef.current = engine;
      try {
        const count = await engine.open(blob);
        if (!alive) return;
        const saved = await getProgress(bookId);
        const start = clampPageIndex(saved?.blockIndex ?? 0, count);
        setPageCount(count);
        setPageIndex(start);
        pageIndexRef.current = start;
        pageCountRef.current = count;
        const marks = await listBookmarks(bookId);
        if (!alive) return;
        setBookmarks(marks);
        if (count !== (rec.pageCount ?? 0)) {
          void touchBook(bookId, { pageCount: count, blockCount: count });
        }
        if (!rec.hasCover) {
          void (async () => {
            const cover = await engine.renderCoverBlob();
            if (!cover || !alive) return;
            await putBookCover(bookId, cover);
            await touchBook(bookId, { hasCover: true });
          })();
        }
        setLoadState('ready');
        void touchBook(bookId, { lastOpenedAt: Date.now() });
      } catch (e) {
        if (!alive) return;
        setLoadState('error');
        setErrorMsg(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      alive = false;
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (rasterTimer.current) window.clearTimeout(rasterTimer.current);
      persistRef.current(pageIndexRef.current, pageCountRef.current);
      void engineRef.current?.close();
      engineRef.current = null;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [bookId]);

  /* ── 视口尺寸 ── */
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setViewport({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loadState]);

  /* ── 取页尺寸 + 渲染（同一效应，避免翻页闪旧尺寸） ── */
  useEffect(() => {
    if (loadState !== 'ready' || !engineRef.current || viewport.w < 8) return;
    let alive = true;
    const engine = engineRef.current;
    const index = pageIndex;

    setRendering(true);
    void (async () => {
      try {
        engine.cancelAllRenders();
        const size = await engine.pageSize(index);
        if (!alive) return;
        setPageSize(size);
        const fit = fitScale(size.width, size.height, viewport.w, viewport.h, fitMode);
        const cssW = Math.max(1, size.width * fit * rasterZoom);
        const cssH = Math.max(1, size.height * fit * rasterZoom);
        const dpr = cappedDpr();
        const rendered = await engine.renderPage(index, cssW, cssH, dpr);
        if (!alive) return;
        const blob = await new Promise<Blob | null>((resolve) =>
          rendered.canvas.toBlob((b) => resolve(b), 'image/png'),
        );
        if (!alive || !blob) return;
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setBitmapUrl(url);
        engine.prefetch(index - 1, cssW, cssH, dpr);
        engine.prefetch(index + 1, cssW, cssH, dpr);
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (!/cancel/i.test(msg)) toast(msg || '渲染失败', 'warn');
      } finally {
        if (alive) setRendering(false);
      }
    })();

    return () => {
      alive = false;
      engine.cancelAllRenders();
    };
  }, [loadState, pageIndex, viewport.w, viewport.h, fitMode, rasterZoom]);

  /* ── 缩放变化时夹紧平移 ── */
  useEffect(() => {
    const bounds = panBounds(displayW, displayH, viewport.w, viewport.h);
    setPan((p) => clampPan(p.x, p.y, bounds));
  }, [displayW, displayH, viewport.w, viewport.h]);

  const turnTo = useCallback(
    (next: number, animate = settings.flipAnimation) => {
      const clamped = clampPageIndex(next, pageCount);
      if (clamped === pageIndexRef.current) return;
      if (animate) {
        setAnimating(true);
        window.setTimeout(() => setAnimating(false), 220);
      }
      setPageIndex(clamped);
      setZoom(1);
      setRasterZoom(1);
      setPan({ x: 0, y: 0 });
      scheduleSave(clamped, pageCount);
    },
    [pageCount, scheduleSave, settings.flipAnimation],
  );

  const prevPage = useCallback(() => turnTo(pageIndexRef.current - 1), [turnTo]);
  const nextPage = useCallback(() => turnTo(pageIndexRef.current + 1), [turnTo]);

  const tapToTurnRef = useRef(settings.tapToTurn);
  tapToTurnRef.current = settings.tapToTurn;

  /** 点按：以视口中线分左右翻页；中间窄带仍用于显隐顶底栏 */
  const handleViewportTap = useCallback(
    (clientX: number, viewEl: HTMLElement) => {
      if (zoomRef.current > 1.01) {
        setBarsVisible((v) => !v);
        return;
      }
      const rect = viewEl.getBoundingClientRect();
      if (rect.width <= 0) return;
      const ratio = (clientX - rect.left) / rect.width;
      // 中间约 18%：显隐工具栏；两侧：翻页
      if (ratio > 0.41 && ratio < 0.59) {
        setBarsVisible((v) => !v);
        return;
      }
      if (!tapToTurnRef.current) {
        setBarsVisible((v) => !v);
        return;
      }
      if (ratio < 0.5) prevPage();
      else nextPage();
    },
    [nextPage, prevPage],
  );

  /* ── 键盘 ── */
  useEffect(() => {
    if (loadState !== 'ready' || !settings.enableShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        e.preventDefault();
        goBack();
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        prevPage();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        nextPage();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        commitRasterZoom(zoomRef.current + 0.25);
      } else if (e.key === '-') {
        e.preventDefault();
        const next = Math.max(MIN_ZOOM, zoomRef.current - 0.25);
        if (next <= 1) setPan({ x: 0, y: 0 });
        commitRasterZoom(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loadState, settings.enableShortcuts, prevPage, nextPage, goBack, commitRasterZoom]);

  /* ── 指针手势 ── */
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || loadState !== 'ready') return;

    const dist = (a: PointerEvent, b: PointerEvent) => {
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      return Math.hypot(dx, dy);
    };

    const pointers = new Map<number, PointerEvent>();

    const onDown = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, e);
      if (pointers.size === 1) {
        gesture.current = {
          mode: zoomRef.current > 1.01 ? 'pan' : 'swipe',
          startX: e.clientX,
          startY: e.clientY,
          originPan: { ...panRef.current },
          startDist: 0,
          startZoom: zoomRef.current,
          moved: false,
        };
        setPanning(zoomRef.current > 1.01);
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        gesture.current = {
          mode: 'pinch',
          startX: (a.clientX + b.clientX) / 2,
          startY: (a.clientY + b.clientY) / 2,
          originPan: { ...panRef.current },
          startDist: dist(a, b) || 1,
          startZoom: zoomRef.current,
          moved: false,
        };
        setPanning(true);
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e);
      const g = gesture.current;
      if (!g) return;

      if (g.mode === 'pinch' && pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = dist(a, b) || 1;
        const nextZoom = Math.min(
          MAX_ZOOM,
          Math.max(MIN_ZOOM, g.startZoom * (d / g.startDist)),
        );
        // 捏合过程只改 CSS 缩放，不触发栅格化
        setZoom(nextZoom);
        g.moved = true;
        const bounds = panBounds(
          pageSize.width * baseFit * nextZoom,
          pageSize.height * baseFit * nextZoom,
          viewport.w,
          viewport.h,
        );
        setPan(clampPan(g.originPan.x, g.originPan.y, bounds));
        return;
      }

      if (g.mode === 'pan') {
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (Math.hypot(dx, dy) > 4) g.moved = true;
        const bounds = panBounds(displayW, displayH, viewport.w, viewport.h);
        const next = clampPan(g.originPan.x + dx, g.originPan.y + dy, bounds);
        setPan(next);
        if (
          Math.abs(dx) > SWIPE_THRESHOLD &&
          Math.abs(dx) > Math.abs(dy) * 1.4 &&
          (next.x === bounds.minX || next.x === bounds.maxX)
        ) {
          if (dx < 0 && next.x === bounds.minX) {
            gesture.current = null;
            nextPage();
          } else if (dx > 0 && next.x === bounds.maxX) {
            gesture.current = null;
            prevPage();
          }
        }
        return;
      }

      if (g.mode === 'swipe') {
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (Math.hypot(dx, dy) > 8) g.moved = true;
      }
    };

    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      const g = gesture.current;
      if (pointers.size === 0) {
        setPanning(false);
        if (g?.mode === 'pinch') {
          commitRasterZoom(zoomRef.current);
        } else if (g?.mode === 'swipe') {
          const dx = e.clientX - g.startX;
          const dy = e.clientY - g.startY;
          if (g.moved && Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.2) {
            if (dx < 0) nextPage();
            else prevPage();
          } else if (!g.moved) {
            // pointer capture 会吞掉子元素 click，点按翻页在这里处理
            handleViewportTap(e.clientX, el);
          }
        } else if (g?.mode === 'pan' && !g.moved) {
          setBarsVisible((v) => !v);
        }
        gesture.current = null;
      } else if (pointers.size === 1 && g?.mode === 'pinch') {
        commitRasterZoom(zoomRef.current);
        const only = [...pointers.values()][0];
        gesture.current = {
          mode: zoomRef.current > 1.01 ? 'pan' : 'swipe',
          startX: only.clientX,
          startY: only.clientY,
          originPan: { ...panRef.current },
          startDist: 0,
          startZoom: zoomRef.current,
          moved: true,
        };
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [
    loadState,
    baseFit,
    displayW,
    displayH,
    pageSize.width,
    pageSize.height,
    viewport.w,
    viewport.h,
    nextPage,
    prevPage,
    commitRasterZoom,
    handleViewportTap,
  ]);

  const setFit = (mode: ComicFitMode) => {
    updateSettings({ comicFitMode: mode });
    setZoom(1);
    setRasterZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const currentBookmark = bookmarks.find((b) => b.blockIndex === pageIndex);

  const toggleBookmark = async () => {
    if (!bookId || !book) return;
    if (currentBookmark) {
      await removeBookmark(currentBookmark.id);
      setBookmarks((list) => list.filter((b) => b.id !== currentBookmark.id));
      toast('已移除书签');
      return;
    }
    const rec = await addBookmark({
      bookId,
      kind: 'bookmark',
      chapterIndex: 0,
      blockIndex: pageIndex,
      lineInBlock: 0,
      charOffset: pageIndex,
      text: `第 ${pageIndex + 1} 页`,
      color: 'seal',
    });
    setBookmarks((list) => [...list, rec].sort((a, b) => a.blockIndex - b.blockIndex));
    toast('已添加书签');
  };

  if (loadState === 'absent') {
    return (
      <div className="comic-reader">
        <EmptyState
          title="找不到这本书"
          hint="可能已被删除"
          action={
            <Button variant="ghost" onClick={goBack}>
              返回书架
            </Button>
          }
        />
      </div>
    );
  }

  if (loadState === 'error') {
    return (
      <div className="comic-reader">
        <EmptyState
          title="无法打开 PDF"
          hint={errorMsg || '文件损坏或不受支持'}
          action={
            <Button variant="ghost" onClick={goBack}>
              返回书架
            </Button>
          }
        />
      </div>
    );
  }

  const percent = pagePercent(pageIndex, pageCount);

  return (
    <div className={`comic-reader${barsVisible ? '' : ' bars-hidden'}`}>
      <header className="comic-top">
        <button type="button" className="comic-icon-btn" onClick={goBack} aria-label="返回书架">
          <IconChevronLeft size={20} />
        </button>
        <div className="comic-title">{book?.title ?? '…'}</div>
        <button
          type="button"
          className="comic-icon-btn"
          onClick={() => void toggleBookmark()}
          aria-label={currentBookmark ? '移除书签' : '添加书签'}
        >
          <IconBookmark size={18} />
        </button>
      </header>

      <div ref={viewportRef} className={`comic-viewport${panning ? ' panning' : ''}`}>
        {loadState === 'loading' && <div className="comic-loading">正在打开…</div>}
        {rendering && !bitmapUrl && <div className="comic-loading">渲染中…</div>}
        <div
          className={`comic-stage${animating ? ' animating' : ''}`}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            opacity: animating ? 0.88 : 1,
          }}
        >
          {bitmapUrl && (
            <img
              src={bitmapUrl}
              alt={`第 ${pageIndex + 1} 页`}
              width={Math.round(displayW)}
              height={Math.round(displayH)}
              draggable={false}
            />
          )}
        </div>
      </div>

      <footer className="comic-foot">
        <button
          type="button"
          className="comic-icon-btn"
          onClick={prevPage}
          disabled={pageIndex <= 0}
          aria-label="上一页"
        >
          <IconChevronLeft size={18} />
        </button>
        <div className="comic-fit-seg" role="group" aria-label="适屏">
          {FIT_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={fitMode === opt.id ? 'active' : ''}
              onClick={() => setFit(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="comic-page-label">
          {pageCount > 0 ? `${pageIndex + 1} / ${pageCount}` : '—'} · {formatPercent(percent)}
        </span>
        <button
          type="button"
          className="comic-icon-btn"
          onClick={() => {
            const next = Math.max(MIN_ZOOM, zoom - 0.25);
            if (next <= 1) setPan({ x: 0, y: 0 });
            commitRasterZoom(next);
          }}
          disabled={zoom <= MIN_ZOOM}
          aria-label="缩小"
        >
          <IconMinus size={16} />
        </button>
        <button
          type="button"
          className="comic-icon-btn"
          onClick={() => commitRasterZoom(zoom + 0.25)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="放大"
        >
          <IconPlus size={16} />
        </button>
        <button
          type="button"
          className="comic-icon-btn"
          onClick={nextPage}
          disabled={pageIndex >= pageCount - 1}
          aria-label="下一页"
        >
          <IconChevronRight size={18} />
        </button>
      </footer>
    </div>
  );
}

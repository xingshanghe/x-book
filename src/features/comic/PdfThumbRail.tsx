/**
 * PDF 页缩略图侧栏：对齐 TXT 常驻目录，占左侧一列、正文让位。
 * 列表虚拟化 + 并发闸，大文档不会一次挂几百个观察器。
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Bookmark } from '@/types/models';
import { IconClose } from '@/ui/icons';
import type { PdfEngine } from './pdfEngine';

const THUMB_EDGE = 144;
/** 同时渲几张缩略图，避免打满 pdf.js */
const THUMB_CONCURRENCY = 2;
/** 单项预估高度（图框 3:4 + 页码 + gap），用于虚拟列表 */
const ITEM_STRIDE = 220;
const OVERSCAN = 4;

interface Props {
  engine: PdfEngine;
  pageCount: number;
  currentIndex: number;
  bookmarks: Bookmark[];
  onJump: (pageIndex: number) => void;
  onClose: () => void;
}

export function PdfThumbRail({
  engine,
  pageCount,
  currentIndex,
  bookmarks,
  onJump,
  onClose,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [virtOffset, setVirtOffset] = useState(0);
  const bookmarked = useMemo(() => {
    const set = new Set<number>();
    for (const b of bookmarks) set.add(b.blockIndex);
    return set;
  }, [bookmarks]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const measure = () => setViewH(el.clientHeight);
    measure();
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const virt = listRef.current?.querySelector('.comic-thumb-virt');
    setVirtOffset(virt instanceof HTMLElement ? virt.offsetTop : 0);
  }, [bookmarks.length, pageCount]);

  // 翻页时把当前页滚进视口（按索引算位置，虚拟窗外也能定位）
  useEffect(() => {
    const root = listRef.current;
    if (!root || currentIndex < 0 || pageCount <= 0) return;
    const targetTop = virtOffset + currentIndex * ITEM_STRIDE;
    const viewTop = root.scrollTop;
    const viewBottom = viewTop + root.clientHeight;
    if (targetTop >= viewTop && targetTop + ITEM_STRIDE <= viewBottom) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.scrollTo({
      top: Math.max(0, targetTop - root.clientHeight / 2 + ITEM_STRIDE / 2),
      behavior: reduce ? 'auto' : 'smooth',
    });
  }, [currentIndex, pageCount, virtOffset]);

  const total = Math.max(0, pageCount);
  const listScroll = Math.max(0, scrollTop - virtOffset);
  const start = Math.max(0, Math.floor(listScroll / ITEM_STRIDE) - OVERSCAN);
  const visibleCount = Math.ceil((viewH || 1) / ITEM_STRIDE) + OVERSCAN * 2;
  const end = Math.min(total, start + visibleCount);
  const topPad = start * ITEM_STRIDE;
  const bottomPad = Math.max(0, (total - end) * ITEM_STRIDE);

  const windowIndexes = useMemo(() => {
    const out: number[] = [];
    for (let i = start; i < end; i++) out.push(i);
    return out;
  }, [start, end]);

  return (
    <aside className="comic-thumb-rail" aria-label="页缩略图">
      <header className="comic-thumb-head">
        <span>缩略图</span>
        <span className="count">{pageCount || '—'}</span>
        <button type="button" className="comic-icon-btn" onClick={onClose} aria-label="收起缩略图">
          <IconClose size={16} />
        </button>
      </header>

      <div className="comic-thumb-body" ref={listRef}>
        {bookmarks.length > 0 && (
          <>
            <h4 className="comic-thumb-group">书签 · {bookmarks.length}</h4>
            {bookmarks.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`comic-thumb-bm${b.blockIndex === currentIndex ? ' current' : ''}`}
                onClick={() => onJump(b.blockIndex)}
                aria-current={b.blockIndex === currentIndex ? 'page' : undefined}
              >
                <span className="no">签</span>
                <span className="truncate">{b.text || `第 ${b.blockIndex + 1} 页`}</span>
              </button>
            ))}
            <h4 className="comic-thumb-group">页面</h4>
          </>
        )}

        {total === 0 ? (
          <p className="comic-thumb-empty">暂无页面</p>
        ) : (
          <div className="comic-thumb-virt" style={{ paddingTop: topPad, paddingBottom: bottomPad }}>
            {windowIndexes.map((index) => (
              <ThumbItem
                key={index}
                engine={engine}
                index={index}
                current={index === currentIndex}
                bookmarked={bookmarked.has(index)}
                onJump={onJump}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

function ThumbItem({
  engine,
  index,
  current,
  bookmarked,
  onJump,
}: {
  engine: PdfEngine;
  index: number;
  current: boolean;
  bookmarked: boolean;
  onJump: (pageIndex: number) => void;
}) {
  const urlRef = useRef<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const slot = acquireThumbSlot(() => alive);
    void (async () => {
      const ok = await slot.promise;
      if (!ok) return;
      if (!alive) {
        releaseThumbSlot();
        return;
      }
      try {
        const blob = await engine.renderThumbBlob(index, THUMB_EDGE);
        if (!alive || !blob) return;
        const next = URL.createObjectURL(blob);
        if (!alive) {
          URL.revokeObjectURL(next);
          return;
        }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setUrl(next);
      } catch {
        /* 单页失败忽略，占位即可 */
      } finally {
        releaseThumbSlot();
      }
    })();
    return () => {
      alive = false;
      slot.cancel();
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [engine, index]);

  return (
    <button
      type="button"
      className={`comic-thumb${current ? ' current' : ''}${bookmarked ? ' marked' : ''}`}
      style={{ height: ITEM_STRIDE }}
      onClick={() => onJump(index)}
      aria-current={current ? 'page' : undefined}
      aria-label={`第 ${index + 1} 页`}
    >
      <span className="comic-thumb-frame">
        {url ? <img src={url} alt="" draggable={false} /> : <span className="comic-thumb-skel" />}
      </span>
      <span className="comic-thumb-no">{index + 1}</span>
    </button>
  );
}

interface ThumbSlot {
  promise: Promise<boolean>;
  cancel: () => void;
}

interface ThumbWaiter {
  alive: () => boolean;
  resolve: (ok: boolean) => void;
}

/** 全局缩略图并发闸，多个 ThumbItem 共用 */
let thumbActive = 0;
const thumbWaiters: ThumbWaiter[] = [];

function acquireThumbSlot(alive: () => boolean): ThumbSlot {
  if (thumbActive < THUMB_CONCURRENCY) {
    thumbActive += 1;
    return { promise: Promise.resolve(true), cancel: () => undefined };
  }

  let settled = false;
  let waiter: ThumbWaiter | null = null;
  const promise = new Promise<boolean>((resolve) => {
    waiter = {
      alive,
      resolve: (ok) => {
        if (settled) return;
        settled = true;
        if (ok) thumbActive += 1;
        resolve(ok);
      },
    };
    thumbWaiters.push(waiter);
  });

  return {
    promise,
    cancel: () => {
      if (settled || !waiter) return;
      const i = thumbWaiters.indexOf(waiter);
      if (i >= 0) thumbWaiters.splice(i, 1);
      waiter.resolve(false);
    },
  };
}

function releaseThumbSlot(): void {
  thumbActive = Math.max(0, thumbActive - 1);
  while (thumbWaiters.length > 0 && thumbActive < THUMB_CONCURRENCY) {
    const next = thumbWaiters.shift();
    if (!next) break;
    if (!next.alive()) {
      next.resolve(false);
      continue;
    }
    next.resolve(true);
    return;
  }
}

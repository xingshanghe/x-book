/**
 * 常驻目录侧栏。
 *
 * 与抽屉式目录的区别：它占自己的那一列，正文自动让位，不做遮罩，
 * 所以可以在阅读时一直开着对照；窄窗口下由外层折叠成抽屉。
 */

import { useEffect, useMemo, useRef } from 'react';
import type { Bookmark, Chapter } from '@/types/models';
import { chapterAtChar } from '@/core/reader/progress';
import { IconClose } from '@/ui/icons';

interface Props {
  chapters: Chapter[];
  bookmarks: Bookmark[];
  currentChar: number;
  /** 第二个参数是章节所在块号，分页视图按它定位比按字符稳 */
  onJump: (charOffset: number, blockHint?: number) => void;
  onJumpBookmark: (b: Bookmark) => void;
  onClose: () => void;
}

export function TocSidebar({
  chapters,
  bookmarks,
  currentChar,
  onJump,
  onJumpBookmark,
  onClose,
}: Props) {
  const current = useMemo(
    () =>
      chapters.length
        ? chapterAtChar(
            chapters.map((c) => c.charOffset),
            currentChar,
          )
        : -1,
    [chapters, currentChar],
  );
  const listRef = useRef<HTMLDivElement>(null);

  // 当前章跟着走，但只在切换章节时滚动，避免阅读时侧栏一直抖
  useEffect(() => {
    if (current < 0) return;
    const el = listRef.current?.querySelector('.toc-item.current');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [current]);

  return (
    <aside className="toc-rail" aria-label="目录">
      <header className="toc-rail-head">
        <span>目录</span>
        <span className="count">{chapters.length || '—'}</span>
        <button type="button" className="qy-icon-btn" onClick={onClose} aria-label="收起目录">
          <IconClose size={16} />
        </button>
      </header>

      <div className="toc-rail-body" ref={listRef}>
        {bookmarks.length > 0 && (
          <>
            <h4 className="toc-rail-group">书签 · {bookmarks.length}</h4>
            {bookmarks.map((b) => (
              <button
                key={b.id}
                type="button"
                className="toc-item bm"
                onClick={() => onJumpBookmark(b)}
              >
                <span className="no">{b.kind === 'extract' ? '摘' : '签'}</span>
                <span className="clamp-2">{b.text.slice(0, 40) || '（未命名位置）'}</span>
              </button>
            ))}
            <h4 className="toc-rail-group">章节</h4>
          </>
        )}

        {chapters.length === 0 ? (
          <p className="toc-rail-empty">本书未识别出章节，可继续按进度阅读。</p>
        ) : (
          chapters.map((c, i) => (
            <button
              key={c.index}
              type="button"
              className={`toc-item${i === current ? ' current' : ''}`}
              onClick={() => onJump(c.charOffset, c.blockIndex)}
              title={c.title}
            >
              <span className="no">{i + 1}</span>
              <span className="truncate">{c.shortTitle || c.title}</span>
            </button>
          ))
        )}
      </div>
    </aside>
  );
}

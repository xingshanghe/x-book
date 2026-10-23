/** 阅读器浮层：目录、书签/摘录、搜索、排版抽屉、脚注 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Book, Bookmark, Chapter, Typography } from '@/types/models';
import type { BlockIndexView } from '@/core/reader/progress';
import { chapterAtChar } from '@/core/reader/progress';
import { searchBook, type SearchHit } from '@/storage/repositories/searchRepo';
import {
  addBookmark,
  listBookmarks,
  removeBookmark,
} from '@/storage/repositories/bookmarkRepo';
import {
  BODY_FONT_OPTIONS,
  FONT_SIZE_RANGE,
  INDENT_RANGE,
  LINE_HEIGHT_RANGE,
  SPACING_RANGE,
  WIDTH_RANGE,
} from '@/storage/repositories/defaults';
import { Button, Segmented, Sheet, Slider, Switch, useToast } from '@/ui';
import { IconTrash } from '@/ui/icons';
import { formatPercent, formatRelative } from '@/lib/format';
import type { ThemeName } from '@/types/models';

/* ─────────────── 目录 ─────────────── */

export function TocSheet({
  open,
  onClose,
  chapters,
  idx,
  currentCharOffset,
  onJump,
  bookmarks,
  onJumpBookmark,
}: {
  open: boolean;
  onClose: () => void;
  chapters: Chapter[];
  idx: BlockIndexView;
  currentCharOffset: number;
  onJump: (charOffset: number) => void;
  bookmarks: Bookmark[];
  onJumpBookmark: (b: Bookmark) => void;
}) {
  const current = useMemo(
    () => (chapters.length ? chapterAtChar(chapters.map((c) => c.charOffset), currentCharOffset) : -1),
    [chapters, currentCharOffset],
  );
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('.toc-item.current');
    el?.scrollIntoView({ block: 'center' });
  }, [open, current]);

  return (
    <Sheet open={open} onClose={onClose} title={`目录 · ${chapters.length || '无章节'}`} side="left">
      <div ref={listRef} style={{ maxHeight: '70vh', overflowY: 'auto' }}>
        {chapters.length === 0 && (
          <p style={{ color: 'var(--ink-3)', fontSize: 13, lineHeight: 1.8 }}>
            本书未识别出章节。可在设置中开启「向本书学习」或阅读时在行首添加{' '}
            <code>[::]</code> 标记手动划章。
          </p>
        )}
        {bookmarks.length > 0 && (
          <>
            <h4 style={{ margin: '10px 0 6px', fontSize: 13, color: 'var(--ink-3)' }}>
              书签与摘录 · {bookmarks.length}
            </h4>
            {bookmarks.map((b) => (
              <button key={b.id} type="button" className="toc-item" onClick={() => onJumpBookmark(b)}>
                <span className="no">{formatPercent(b.charOffset / Math.max(1, idx.charOffsets[idx.count - 1]))}</span>
                <span className="clamp-2">{b.text.slice(0, 40)}</span>
              </button>
            ))}
            <hr style={{ margin: '12px 0' }} />
          </>
        )}
        {chapters.map((c, i) => (
          <button
            key={c.index}
            type="button"
            className={`toc-item${i === current ? ' current' : ''}`}
            onClick={() => {
              onJump(c.charOffset);
              onClose();
            }}
          >
            <span className="no">{i + 1}</span>
            <span className="truncate">{c.title}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/* ─────────────── 搜索 ─────────────── */

export function SearchSheet({
  open,
  onClose,
  book,
  onJump,
}: {
  open: boolean;
  onClose: () => void;
  book: Book;
  onJump: (charOffset: number) => void;
}) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      abort.current?.abort();
      setHits(null);
      setQ('');
    }
  }, [open]);

  const run = async () => {
    const query = q.trim();
    if (!query) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(true);
    try {
      const res = await searchBook(book, query, { signal: ac.signal, limit: 120 });
      setHits(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="全书搜索" side="right">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
          placeholder="输入关键词"
          style={{
            flex: 1,
            background: 'var(--paper-0)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '9px 12px',
            outline: 'none',
          }}
        />
        <Button variant="primary" onClick={() => void run()} disabled={busy}>
          {busy ? '搜索中…' : '搜索'}
        </Button>
      </div>
      <div style={{ maxHeight: '64vh', overflowY: 'auto' }}>
        {hits === null ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>搜索在本地完成，不消耗网络。</p>
        ) : hits.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>没有找到「{q}」。</p>
        ) : (
          <>
            <p style={{ color: 'var(--ink-3)', fontSize: 12, margin: '4px 0 8px' }}>
              共 {hits.length} 处命中
            </p>
            {hits.map((h, i) => (
              <button
                key={i}
                type="button"
                className="search-hit"
                onClick={() => {
                  onJump(h.charOffset);
                  onClose();
                }}
              >
                {h.preview.slice(0, h.matchStart)}
                <mark>{h.preview.slice(h.matchStart, h.matchEnd)}</mark>
                {h.preview.slice(h.matchEnd)}
              </button>
            ))}
          </>
        )}
      </div>
    </Sheet>
  );
}

/* ─────────────── 书签面板 ─────────────── */

export function BookmarkSheet({
  open,
  onClose,
  bookId,
  current,
  onJump,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  bookId: string;
  current: { charOffset: number; blockIndex: number; lineInBlock: number; text: string } | null;
  onJump: (b: Bookmark) => void;
  onChanged: () => void;
}) {
  const toast = useToast().push;
  const [items, setItems] = useState<Bookmark[]>([]);

  useEffect(() => {
    if (!open) return;
    void listBookmarks(bookId).then(setItems);
  }, [open, bookId]);

  const add = async (kind: 'bookmark' | 'extract') => {
    if (!current) return;
    await addBookmark({
      bookId,
      kind,
      chapterIndex: 0,
      blockIndex: current.blockIndex,
      lineInBlock: current.lineInBlock,
      charOffset: current.charOffset,
      text: current.text.slice(0, 120),
      color: 'seal',
    });
    setItems(await listBookmarks(bookId));
    onChanged();
    toast(kind === 'bookmark' ? '已加书签' : '已收藏摘录', 'ok');
  };

  return (
    <Sheet open={open} onClose={onClose} title={`书签 · ${items.length}`} side="bottom">
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
        <Button variant="primary" onClick={() => void add('bookmark')} disabled={!current}>
          在当前位置加书签
        </Button>
        <Button onClick={() => void add('extract')} disabled={!current}>
          收藏本段摘录
        </Button>
      </div>
      <div style={{ maxHeight: '52vh', overflowY: 'auto' }}>
        {items.length === 0 ? (
          <p style={{ color: 'var(--ink-3)', fontSize: 13 }}>还没有书签。</p>
        ) : (
          items.map((b) => (
            <div key={b.id} className="bm-item" style={{ display: 'block' }}>
              <button
                type="button"
                style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}
                onClick={() => {
                  onJump(b);
                  onClose();
                }}
              >
                <span className={`bm-kind ${b.kind === 'extract' ? '' : ''}`}>
                  {b.kind === 'extract' ? '摘录' : '书签'}
                </span>
                <span className="text"> {b.text}</span>
                <span className="meta">
                  <span>{formatPercent(b.charOffset / Math.max(1, 1))}</span>
                  <span>{formatRelative(b.createdAt)}</span>
                </span>
              </button>
              <button
                type="button"
                className="qy-icon-btn"
                style={{ width: 26, height: 26, float: 'right', marginTop: -6 }}
                aria-label="删除书签"
                onClick={async () => {
                  await removeBookmark(b.id);
                  setItems(await listBookmarks(bookId));
                  onChanged();
                }}
              >
                <IconTrash size={14} />
              </button>
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}

/* ─────────────── 排版抽屉 ─────────────── */

const THEMES: { value: ThemeName; label: string }[] = [
  { value: 'day', label: '纸黄' },
  { value: 'sepia', label: '宣纸' },
  { value: 'night', label: '黛蓝' },
];

export function LayoutSheet({
  open,
  onClose,
  typography,
  onChange,
  themeMode,
  resolvedTheme,
  onTheme,
  pageMode,
  onPageMode,
  bodyFont,
  onBodyFont,
  userFontNames,
  flipAnimation,
  onFlipAnimation,
  showTitlePage,
  onShowTitlePage,
}: {
  open: boolean;
  onClose: () => void;
  typography: Typography;
  onChange: (patch: Partial<Typography>) => void;
  themeMode: string;
  resolvedTheme: ThemeName;
  onTheme: (t: ThemeName) => void;
  pageMode: 'scroll' | 'page';
  onPageMode: (m: 'scroll' | 'page') => void;
  bodyFont: string;
  onBodyFont: (f: string) => void;
  userFontNames: { id: string; name: string }[];
  flipAnimation: boolean;
  onFlipAnimation: (v: boolean) => void;
  showTitlePage: boolean;
  onShowTitlePage: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="排版与外观" side="bottom">
      <div className="type-preview" aria-hidden>
        轻阅按需精工，流式解析让百万字大书即刻打开。
        纸黄、宣纸、黛蓝三套底色，随日夜流转。
      </div>

      <div className="segment-group">
        <span className="label">阅读模式</span>
        <Segmented
          value={pageMode}
          options={[
            { value: 'scroll', label: '上下滚动' },
            { value: 'page', label: '左右翻页' },
          ]}
          onChange={onPageMode}
        />
        <span className="label">底色</span>
        <Segmented value={resolvedTheme} options={THEMES} onChange={onTheme} />
        <span className="label">正文字体</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {BODY_FONT_OPTIONS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="font-chip"
              aria-pressed={bodyFont === f.id}
              onClick={() => onBodyFont(f.id)}
              style={{
                fontFamily:
                  f.id === 'kai' ? 'var(--font-kai)' : f.id === 'serif' ? 'var(--font-serif)' : 'var(--font-sans)',
              }}
            >
              {f.sample} {f.label}
            </button>
          ))}
          {userFontNames.map((f) => (
            <button
              key={f.id}
              type="button"
              className="font-chip"
              aria-pressed={bodyFont === f.id}
              onClick={() => onBodyFont(f.id)}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>

      <Slider
        label="字号"
        min={FONT_SIZE_RANGE.min}
        max={FONT_SIZE_RANGE.max}
        step={FONT_SIZE_RANGE.step}
        value={typography.fontSize}
        onChange={(v) => onChange({ fontSize: v })}
        format={(v) => `${v}px`}
      />
      <Slider
        label="行距"
        min={LINE_HEIGHT_RANGE.min}
        max={LINE_HEIGHT_RANGE.max}
        step={LINE_HEIGHT_RANGE.step}
        value={typography.lineHeight}
        onChange={(v) => onChange({ lineHeight: v })}
        format={(v) => v.toFixed(2)}
      />
      <Slider
        label="段距"
        min={SPACING_RANGE.min}
        max={SPACING_RANGE.max}
        step={SPACING_RANGE.step}
        value={typography.paragraphSpacing}
        onChange={(v) => onChange({ paragraphSpacing: v })}
        format={(v) => `${v.toFixed(2)}em`}
      />
      <Slider
        label="缩进"
        min={INDENT_RANGE.min}
        max={INDENT_RANGE.max}
        step={INDENT_RANGE.step}
        value={typography.textIndent}
        onChange={(v) => onChange({ textIndent: v })}
        format={(v) => `${v}em`}
      />
      <Slider
        label="版心宽度"
        min={WIDTH_RANGE.min}
        max={WIDTH_RANGE.max}
        step={WIDTH_RANGE.step}
        value={typography.maxWidth}
        onChange={(v) => onChange({ maxWidth: v })}
        format={(v) => `${v} 字`}
      />
      <Switch label="扉页" hint="打开书时先展示书名与藏书章" checked={showTitlePage} onChange={onShowTitlePage} />
      <Switch label="翻页动画" checked={flipAnimation} onChange={onFlipAnimation} />
      <p style={{ fontSize: 12, color: 'var(--ink-3)', padding: '10px 0 4px' }}>
        当前跟随系统：{themeMode === 'system' ? '是（可在设置改为固定）' : '否'}
      </p>
    </Sheet>
  );
}

/* ─────────────── 注释浮层（贴在注号旁边，易笺同款） ─────────────── */

export function NotePopover({
  marker,
  text,
  rect,
  noteChar,
  onJump,
  onClose,
}: {
  marker: string | null;
  text: string | null;
  rect: DOMRect | null;
  noteChar?: number;
  onJump: (char: number) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!marker) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('.qy-ref, .footnote-pop')) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [marker, onClose]);

  if (!marker || !rect || text == null) return null;

  const width = Math.min(340, window.innerWidth - 24);
  const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
  const below = window.innerHeight - rect.bottom > 168;
  const label = /^\d+$/.test(marker) ? `[${marker}]` : marker;
  const arrow = rect.left + rect.width / 2 - left;

  return (
    <div
      className={`footnote-pop${below ? ' arrow-up' : ' arrow-down'}`}
      role="dialog"
      aria-label={`注释 ${label}`}
      style={{
        left,
        width,
        top: below ? rect.bottom + 10 : undefined,
        bottom: below ? undefined : window.innerHeight - rect.top + 10,
        ['--arrow-left' as string]: `${arrow}px`,
      }}
    >
      <p>
        <span className="qy-note-no">{label}</span>
        {text}
      </p>
      {noteChar != null && (
        <button type="button" className="footnote-jump" onClick={() => onJump(noteChar)}>
          翻到这条注释
        </button>
      )}
    </div>
  );
}

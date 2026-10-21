/** 书架页：导入、网格、继续阅读、搜索、排序 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useSettings } from '@/app/store';
import { listBooks, deleteBook, touchBook } from '@/storage/repositories/bookRepo';
import { allProgress } from '@/storage/repositories/progressRepo';
import type { Book, ShelfSort } from '@/types/models';
import { Button, EmptyState, Menu, Progress, Segmented, useToast } from '@/ui';
import { IconClose, IconGear, IconPlus, IconSearch, LogoMark } from '@/ui/icons';
import { formatChars, formatPercent, formatRelative } from '@/lib/format';
import { BookCover } from './BookCover';
import { ImportTray, useDropImport } from './ImportDropzone';
import { useImportQueue } from '@/features/import/importQueue';
import './shelf.css';

const SORTS: { value: ShelfSort; label: string }[] = [
  { value: 'recent', label: '最近在读' },
  { value: 'added', label: '加入时间' },
  { value: 'title', label: '书名' },
  { value: 'author', label: '作者' },
  { value: 'progress', label: '进度' },
];

export function ShelfPage() {
  const [, navigate] = useLocation();
  const toast = useToast().push;
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const [books, setBooks] = useState<Book[] | null>(null);
  const [percentMap, setPercentMap] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [dropProps, dropping] = useDropImport();
  const fileInput = useRef<HTMLInputElement>(null);
  const tasks = useImportQueue((s) => s.tasks);

  const reload = useCallback(async () => {
    const [list, prog] = await Promise.all([listBooks(), allProgress()]);
    const map: Record<string, number> = {};
    for (const p of prog) map[p.bookId] = p.percent;
    setPercentMap(map);
    setBooks(list);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 导入任务完成后刷新书架
  useEffect(() => {
    if (tasks.some((t) => t.status === 'done')) void reload();
  }, [tasks, reload]);

  const openBook = useCallback(
    async (id: string) => {
      await touchBook(id, { lastOpenedAt: Date.now() });
      navigate(`/read/${id}`);
    },
    [navigate],
  );

  const filtered = useMemo(() => {
    if (!books) return null;
    const q = query.trim().toLowerCase();
    let list = books;
    if (q) {
      list = books.filter(
        (b) => b.title.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q),
      );
    }
    return sortBooks(list, percentMap, settings.sortMode);
  }, [books, query, percentMap, settings.sortMode]);

  const continueBook = useMemo(() => {
    if (!books) return null;
    const reading = books
      .filter((b) => (percentMap[b.id] ?? 0) > 0.001 && (percentMap[b.id] ?? 0) < 0.995)
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
    return reading[0] ?? null;
  }, [books, percentMap]);

  const pickFiles = () => fileInput.current?.click();

  const onFiles = (files: FileList | null) => {
    if (!files?.length) return;
    useImportQueue.getState().add([...files]);
  };

  const removeBook = async (book: Book) => {
    if (!window.confirm(`确定删除《${book.title}》？\n阅读进度、书签与文件将一并移除，此操作不可撤销。`))
      return;
    await deleteBook(book.id);
    toast('已删除', 'ok');
    void reload();
  };

  const markFinished = async (book: Book, finished: boolean) => {
    await touchBook(book.id, { finished, finishedAt: finished ? Date.now() : undefined });
    void reload();
  };

  return (
    <div className="shelf" {...dropProps}>
      <header className="shelf-top">
        <span className="brand">
          <LogoMark size={17} />
          轻阅<small>QINGYUE</small>
        </span>
        <div className="shelf-search">
          <IconSearch size={17} />
          <input
            placeholder="搜索书名或作者"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索"
          />
          {query && (
            <button type="button" className="qy-icon-btn" style={{ width: 28, height: 28 }} onClick={() => setQuery('')}>
              <IconClose size={15} />
            </button>
          )}
        </div>
        <span className="spacer" />
        <Segmented
          size="sm"
          value={settings.sortMode}
          options={SORTS}
          onChange={(v) => update({ sortMode: v })}
        />
        <button type="button" className="qy-icon-btn" onClick={() => navigate('/settings')} aria-label="设置">
          <IconGear />
        </button>
      </header>

      <main className="shelf-body">
        {filtered === null ? (
          <EmptyState title="书页翻动中…" />
        ) : filtered.length === 0 && !query ? (
          <EmptyState
            title="书架还是空的"
            hint="把 txt 文件拖进来，或点击右下角的 + 导入。导入完成后即可完全离线阅读。"
            action={
              <Button variant="primary" icon={<IconPlus />} onClick={pickFiles}>
                导入 txt
              </Button>
            }
          />
        ) : (
          <>
            {continueBook && !query && (
              <>
                <h2 className="shelf-section-title">继续阅读</h2>
                <button
                  type="button"
                  className="continue-card"
                  onClick={() => void openBook(continueBook.id)}
                >
                  <BookCover book={continueBook} percent={percentMap[continueBook.id]} width={64} />
                  <span className="continue-meta">
                    <h3>{continueBook.title}</h3>
                    <p>
                      {continueBook.author ? `${continueBook.author} · ` : ''}
                      {formatPercent(percentMap[continueBook.id] ?? 0)} ·{' '}
                      {formatRelative(continueBook.lastOpenedAt ?? continueBook.createdAt)}
                    </p>
                    <Progress value={percentMap[continueBook.id] ?? 0} style={{ maxWidth: 280 }} />
                  </span>
                </button>
              </>
            )}

            <h2 className="shelf-section-title">
              {query ? '搜索结果' : '全部书籍'}
              <small>
                {filtered.length} 本
                {query ? ` · “${query}”` : ''}
              </small>
            </h2>

            <div className={`shelf-grid${settings.shelfDensity === 'compact' ? ' compact' : ''}`}>
              {filtered.map((book) => (
                <div className="shelf-cell" key={book.id}>
                  <Menu
                    align="end"
                    trigger={
                      <BookCover
                        book={book}
                        percent={percentMap[book.id]}
                        onClick={() => void openBook(book.id)}
                      />
                    }
                    items={[
                      { key: 'open', label: '开始阅读', onSelect: () => void openBook(book.id) },
                      {
                        key: 'finish',
                        label: book.finished ? '标记未读完' : '标记已读完',
                        onSelect: () => void markFinished(book, !book.finished),
                      },
                      {
                        key: 'del',
                        label: '删除本书',
                        danger: true,
                        onSelect: () => void removeBook(book),
                      },
                    ]}
                  />
                  <span className="shelf-cell-title clamp-2">{book.title}</span>
                  <span className="shelf-cell-sub">
                    {percentMap[book.id] != null && percentMap[book.id] > 0.001
                      ? `${formatPercent(percentMap[book.id])} · ${formatChars(book.charCount)}`
                      : formatChars(book.charCount)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>

      <button type="button" className="fab" onClick={pickFiles} aria-label="导入书籍">
        <IconPlus size={24} />
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".txt,.text,.md,.log,text/plain"
        multiple
        hidden
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <ImportTray />
      {dropping && <div className="dropzone-overlay">松手导入 · 完全离线可用</div>}
    </div>
  );
}

function sortBooks(list: Book[], percentMap: Record<string, number>, mode: ShelfSort): Book[] {
  const arr = [...list];
  switch (mode) {
    case 'recent':
      return arr.sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt));
    case 'added':
      return arr.sort((a, b) => b.createdAt - a.createdAt);
    case 'title':
      return arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
    case 'author':
      return arr.sort((a, b) => (a.author ?? '~').localeCompare(b.author ?? '~', 'zh-Hans-CN'));
    case 'progress':
      return arr.sort((a, b) => (percentMap[b.id] ?? 0) - (percentMap[a.id] ?? 0));
  }
}

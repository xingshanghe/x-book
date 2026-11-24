/** 按书籍类型分流：txt → ReaderPage，pdf → ComicReader（懒加载） */

import { Suspense, lazy, useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { ReaderPage } from '@/features/reader/ReaderPage';
import { isPdfBook } from '@/lib/bookKind';
import { getBook } from '@/storage/repositories/bookRepo';
import { Button, EmptyState } from '@/ui';

const ComicReader = lazy(() =>
  import('@/features/comic/ComicReader').then((m) => ({ default: m.ComicReader })),
);

type Kind = 'loading' | 'txt' | 'pdf' | 'absent';

export function ReadGate({ id, params }: { id?: string; params?: { id: string } }) {
  const bookId = id ?? params?.id;
  const [, navigate] = useLocation();
  const [kind, setKind] = useState<Kind>('loading');

  useEffect(() => {
    let alive = true;
    setKind('loading');
    void (async () => {
      if (!bookId) {
        if (alive) setKind('absent');
        return;
      }
      const book = await getBook(bookId);
      if (!alive) return;
      if (!book) setKind('absent');
      else setKind(isPdfBook(book) ? 'pdf' : 'txt');
    })();
    return () => {
      alive = false;
    };
  }, [bookId]);

  if (kind === 'pdf') {
    return (
      <Suspense fallback={<div className="qy-loading-screen" style={{ minHeight: '100dvh' }} />}>
        <ComicReader id={bookId} />
      </Suspense>
    );
  }
  if (kind === 'txt') return <ReaderPage id={bookId} />;
  if (kind === 'absent') {
    return (
      <EmptyState
        title="找不到这本书"
        hint="可能已被删除"
        action={
          <Button variant="ghost" onClick={() => navigate('/')}>
            返回书架
          </Button>
        }
      />
    );
  }
  return <div className="qy-loading-screen" style={{ minHeight: '100dvh' }} />;
}

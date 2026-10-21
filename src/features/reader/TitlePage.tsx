/** 扉页：书名、作者、藏书章、开头摘录（吸收自易笺） */

import type { Book } from '@/types/models';
import { formatDate } from '@/lib/format';

export function TitlePageView({
  book,
  excerpt,
}: {
  book: Book;
  excerpt: string[];
}) {
  return (
    <div className="title-page">
      <div className="seal" aria-hidden>
        轻阅藏书
      </div>
      <h1>{book.title}</h1>
      {book.author && <div className="author">{book.author} 著</div>}
      {excerpt.length > 0 && (
        <div className="excerpt">
          {excerpt.slice(0, 6).map((l, i) => (
            <p key={i} style={{ margin: 0 }}>
              {l}
            </p>
          ))}
        </div>
      )}
      <div className="meta">
        {formatDate(book.createdAt)} 入藏
        {book.chapterCount > 0 ? ` · ${book.chapterCount} 章` : ''}
      </div>
    </div>
  );
}

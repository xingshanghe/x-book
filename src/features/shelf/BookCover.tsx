/** 自动封面：靛蓝底 + 书名竖排/横排 + 朱红丝带 + 底部进度条（零图片素材） */

import { useMemo } from 'react';
import type { Book } from '@/types/models';
import { formatPercent } from '@/lib/format';
import './shelf.css';

const TITLE_BY_HUE: Record<number, string> = {};

export function BookCover({
  book,
  percent,
  width = 132,
  onClick,
  onContextMenu,
}: {
  book: Book;
  percent?: number;
  width?: number;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  const height = Math.round(width * 1.42);
  const hue = book.coverHue;

  // 每本书一个稳定但各异的靛蓝变体：在同一色族里微调明度/饱和
  const { top, bottom, ink } = useMemo(() => {
    const l = 26 + (hue % 7);
    const c = 30 + (hue % 13);
    return {
      top: `hsl(221 ${c}% ${l + 4}%)`,
      bottom: `hsl(214 ${c + 6}% ${l - 6}%)`,
      ink: 'rgba(251,245,231,.94)',
    };
  }, [hue]);

  const title = book.title.length > 10 ? `${book.title.slice(0, 10)}…` : book.title;
  const vertical = book.title.length <= 6;

  return (
    <button
      type="button"
      className="qy-cover"
      style={{ width, height }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={book.title}
    >
      <span className="qy-cover-cloth" style={{ background: `linear-gradient(160deg, ${top}, ${bottom})` }}>
        {/* 格纹窗框 */}
        <span className="gingham qy-cover-frame" />
        {/* 书名 */}
        {vertical ? (
          <span className="qy-cover-title vert" style={{ color: ink }}>
            {book.title.split('').map((ch, i) => (
              <i key={i}>{ch}</i>
            ))}
          </span>
        ) : (
          <span className="qy-cover-title" style={{ color: ink }}>
            {title}
          </span>
        )}
        {book.author && (
          <span className="qy-cover-author" style={{ color: ink }}>
            {book.author.slice(0, 8)}
          </span>
        )}
        {/* 朱红丝带 */}
        <span className="qy-ribbon" />
        {/* 底部进度条 */}
        {percent != null && percent > 0.001 && (
          <span className="qy-cover-progress">
            <span style={{ width: formatPercent(percent) }} data-pct={formatPercent(percent)} />
          </span>
        )}
        {book.finished && <span className="qy-cover-finished">读完</span>}
      </span>
    </button>
  );
}

export { TITLE_BY_HUE };

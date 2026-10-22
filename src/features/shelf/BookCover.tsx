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
  variant = 'full',
  onClick,
  onContextMenu,
}: {
  book: Book;
  percent?: number;
  width?: number;
  /** mark = 只留布面 + 丝带 + 一个书名首字（用于「继续阅读」卡，书名在卡片正文里，不再重复） */
  variant?: 'full' | 'mark';
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

  // 历史数据里可能存在空书名，取长度前先兜底，避免一条脏数据崩掉整页
  const rawTitle = book.title ?? '';
  const title = rawTitle.length > 10 ? `${rawTitle.slice(0, 10)}…` : rawTitle;
  const vertical = rawTitle.length <= 6;
  const mark = variant === 'mark';

  const content = (
    <span className="qy-cover-cloth" style={{ background: `linear-gradient(160deg, ${top}, ${bottom})` }}>
      {/* 格纹窗框 */}
      <span className="gingham qy-cover-frame" />
      {/* 书名 */}
      {mark ? null : vertical ? (
        <span className="qy-cover-title vert" style={{ color: ink }}>
          {rawTitle.split('').map((ch, i) => (
            <i key={i}>{ch}</i>
          ))}
        </span>
      ) : (
        <span className="qy-cover-title" style={{ color: ink }}>
          {title}
        </span>
      )}
      {!mark && book.author && (
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
  );

  // 没有点击行为时用 span：按钮里再套按钮是非法结构，会把外层点击吃掉
  if (!onClick && !onContextMenu) {
    return (
      <span className={`qy-cover static${mark ? ' mark' : ''}`} style={{ width, height }} aria-hidden>
        {content}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`qy-cover${mark ? ' mark' : ''}`}
      style={{ width, height }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      aria-label={rawTitle}
    >
      {content}
    </button>
  );
}

export { TITLE_BY_HUE };

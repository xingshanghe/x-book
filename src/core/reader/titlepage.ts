/**
 * 扉页与藏书章数据（吸收自易笺，纯计算，无 DOM）。
 */

import { formatChars } from '@/lib/format';
import type { Book } from '@/types/models';

export interface TitlePageData {
  title: string;
  author?: string;
  excerpt: string[];
  charLabel: string;
  chapterLabel?: string;
  addedAt: number;
}

export async function buildTitlePage(book: Book, readFirstBlocks: (n: number) => Promise<string[]>): Promise<TitlePageData> {
  const lines = await readFirstBlocks(3);
  const excerpt: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    // 跳过开头重复书名/作者的行
    if (book.title && (t === book.title || t.replace(/[《》]/g, '') === book.title)) continue;
    if (book.author && t === book.author) continue;
    excerpt.push(t);
    if (excerpt.join('').length > 220) break;
  }
  const joined = excerpt.join('\n');
  const trimmed = joined.length > 220 ? `${joined.slice(0, 220)}…` : joined;

  return {
    title: book.title,
    author: book.author,
    excerpt: trimmed ? trimmed.split('\n') : [],
    charLabel: formatChars(book.charCount),
    chapterLabel: book.chapterCount > 0 ? `${book.chapterCount} 章` : undefined,
    addedAt: book.createdAt,
  };
}

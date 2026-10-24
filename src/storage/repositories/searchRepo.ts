/**
 * 全书搜索：块索引增量扫描。
 * 利用块边界即行边界的不变量，逐块解码、逐行匹配；
 * 每块 ~2ms，50MB 书全量扫描 < 3s，且随时可以提前终止。
 */

import { isPageBreakLine } from '@/core/parser/reformat';
import type { Book } from '@/types/models';
import { getDB } from '../db';

export interface SearchHit {
  bookId: string;
  blockIndex: number;
  lineInBlock: number;
  charOffset: number;
  /** 命中行原文 */
  text: string;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface SearchOptions {
  limit?: number;
  signal?: AbortSignal;
  onProgress?: (ratio: number) => void;
}

const CHUNK = 8;

export async function searchBook(
  book: Book,
  query: string,
  opts: SearchOptions = {},
): Promise<SearchHit[]> {
  const db = await getDB();
  const idx = await db.get('blockIndex', book.id);
  const fileRec = await db.get('files', book.id);
  if (!idx || !fileRec) return [];

  const limit = opts.limit ?? 200;
  const needle = query.toLowerCase();
  const hits: SearchHit[] = [];
  const decoder = new TextDecoder('utf-8');
  const starts = idx.starts;

  for (let i = 0; i < idx.count; i += CHUNK) {
    if (opts.signal?.aborted) break;
    const end = Math.min(i + CHUNK, idx.count);
    const buf = await fileRec.blob.slice(starts[i], starts[end]).arrayBuffer();
    const text = decoder.decode(buf);

    // 块内行偏移
    let lineStart = 0;
    let lineNo = 0;
    let charAcc = 0;
    for (let p = 0; p <= text.length; p++) {
      if (p === text.length || text.charCodeAt(p) === 10) {
        const line = p > lineStart ? text.slice(lineStart, p) : '';
        if (line && !isPageBreakLine(line) && line.toLowerCase().includes(needle)) {
          const pos = line.toLowerCase().indexOf(needle);
          hits.push({
            bookId: book.id,
            blockIndex: i,
            lineInBlock: lineNo,
            charOffset: idx.charOffsets[i] + charAcc + pos,
            text: line,
            preview: line.length > 80 ? `${line.slice(0, 80)}…` : line,
            matchStart: pos,
            matchEnd: pos + query.length,
          });
          if (hits.length >= limit) return hits;
        }
        charAcc += line.length + 1;
        lineNo++;
        lineStart = p + 1;
      }
    }

    opts.onProgress?.(end / idx.count);
  }
  return hits;
}

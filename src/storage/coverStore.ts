/**
 * 连环画封面缩略图。与正文 PDF 分存，删除书籍时一并清掉。
 */

import { getDB } from './db';

export async function putBookCover(bookId: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('covers', { id: bookId, blob });
}

export async function getBookCover(bookId: string): Promise<Blob | undefined> {
  const db = await getDB();
  const rec = await db.get('covers', bookId);
  return rec?.blob;
}

export async function deleteBookCover(bookId: string): Promise<void> {
  const db = await getDB();
  await db.delete('covers', bookId);
}

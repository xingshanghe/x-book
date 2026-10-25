/** 书籍元数据 + 索引产物（块索引 / 章节 / 脚注） */

import type { BlockIndex, Book, Chapter, FootnoteEntry } from '@/types/models';
import { nanoid, coverHue } from '@/lib/id';
import { getDB } from '../db';
import { deleteBookFile } from '../blobStore';

export async function listBooks(): Promise<Book[]> {
  const db = await getDB();
  const all = await db.getAll('books');
  return all.sort((a, b) => (b.lastOpenedAt ?? b.createdAt) - (a.lastOpenedAt ?? a.createdAt));
}

export async function getBook(id: string): Promise<Book | undefined> {
  const db = await getDB();
  return db.get('books', id);
}

export async function putBook(book: Book): Promise<void> {
  const db = await getDB();
  await db.put('books', book);
}

export async function findByFingerprint(fp: string): Promise<Book | undefined> {
  const db = await getDB();
  return db.getFromIndex('books', 'by-fingerprint', fp);
}

export async function touchBook(id: string, patch: Partial<Book>): Promise<Book | undefined> {
  const db = await getDB();
  const book = await db.get('books', id);
  if (!book) return undefined;
  const next = { ...book, ...patch };
  await db.put('books', next);
  return next;
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['books', 'files', 'chapters', 'blockIndex', 'footnotes', 'progress', 'bookmarks'], 'readwrite');
  await tx.objectStore('books').delete(id);
  await tx.objectStore('files').delete(id);
  await tx.objectStore('chapters').delete(id);
  await tx.objectStore('blockIndex').delete(id);
  await tx.objectStore('footnotes').delete(id);
  await tx.objectStore('progress').delete(id);
  const bm = tx.objectStore('bookmarks');
  // 旧库可能建了书签表却没有 by-book。直接 index() 会让整笔删除事务作废。
  if (bm.indexNames.contains('by-book')) {
    let cursor = await bm.index('by-book').openCursor(IDBKeyRange.only(id));
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  } else {
    let cursor = await bm.openCursor();
    while (cursor) {
      if (cursor.value.bookId === id) await cursor.delete();
      cursor = await cursor.continue();
    }
  }
  await tx.done;
  await deleteBookFile(id);
}

/* ───────────── 索引产物 ───────────── */

export async function saveIndex(
  bookId: string,
  blockIndex: BlockIndex,
  chapters: Chapter[],
  footnotes: FootnoteEntry[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(['blockIndex', 'chapters', 'footnotes'], 'readwrite');
  await tx.objectStore('blockIndex').put({ ...blockIndex, bookId });
  await tx.objectStore('chapters').put({ bookId, items: chapters });
  await tx.objectStore('footnotes').put({ bookId, items: footnotes });
  await tx.done;
}

export async function getBlockIndex(bookId: string): Promise<(BlockIndex & { bookId: string }) | undefined> {
  const db = await getDB();
  return db.get('blockIndex', bookId);
}

export async function getChapters(bookId: string): Promise<Chapter[]> {
  const db = await getDB();
  const rec = await db.get('chapters', bookId);
  return rec?.items ?? [];
}

export async function getFootnotes(bookId: string): Promise<FootnoteEntry[]> {
  const db = await getDB();
  const rec = await db.get('footnotes', bookId);
  return rec?.items ?? [];
}

/** 新书初始化（导入流水线结束后调用） */
export function newBookRecord(partial: {
  title: string;
  author?: string;
  size: number;
  encoding: Book['encoding'];
  fingerprint: string;
  blockCount: number;
  charCount: number;
  lineCount: number;
  chapterCount: number;
  cleanedLines: number;
  footnoteCount: number;
  blockSize: number;
}): Book {
  const now = Date.now();
  return {
    id: nanoid(10),
    title: partial.title,
    author: partial.author,
    size: partial.size,
    encoding: partial.encoding,
    fingerprint: partial.fingerprint,
    blockSize: partial.blockSize,
    blockCount: partial.blockCount,
    charCount: partial.charCount,
    lineCount: partial.lineCount,
    chapterCount: partial.chapterCount,
    cleanedLines: partial.cleanedLines,
    footnoteCount: partial.footnoteCount,
    status: 'ready',
    indexProgress: 1,
    finished: false,
    createdAt: now,
    coverHue: coverHue(partial.fingerprint),
  };
}

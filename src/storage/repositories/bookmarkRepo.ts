/** 书签与摘录 */

import type { Bookmark, BookmarkKind } from '@/types/models';
import { nanoid } from '@/lib/id';
import { getDB } from '../db';

export async function listBookmarks(bookId: string): Promise<Bookmark[]> {
  const db = await getDB();
  const all = await db.getAllFromIndex('bookmarks', 'by-book', bookId);
  return all.sort((a, b) => a.charOffset - b.charOffset);
}

export async function addBookmark(
  b: Omit<Bookmark, 'id' | 'createdAt'> & { id?: string },
): Promise<Bookmark> {
  const db = await getDB();
  const rec: Bookmark = { ...b, id: b.id ?? nanoid(10), createdAt: Date.now() };
  await db.put('bookmarks', rec);
  return rec;
}

export async function removeBookmark(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('bookmarks', id);
}

export async function updateBookmark(id: string, patch: Partial<Bookmark>): Promise<Bookmark | undefined> {
  const db = await getDB();
  const rec = await db.get('bookmarks', id);
  if (!rec) return undefined;
  const next = { ...rec, ...patch };
  await db.put('bookmarks', next);
  return next;
}

export function isBookmark(kind: BookmarkKind): boolean {
  return kind === 'bookmark';
}

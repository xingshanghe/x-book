/** 书籍文件体（Blob）读写 —— 与元数据同库，事务一致性免费获得 */

import { getDB } from './db';

export async function putBookFile(bookId: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('files', { id: bookId, blob });
}

export async function getBookBlob(bookId: string): Promise<Blob | undefined> {
  const db = await getDB();
  const rec = await db.get('files', bookId);
  return rec?.blob;
}

export async function deleteBookFile(bookId: string): Promise<void> {
  const db = await getDB();
  await db.delete('files', bookId);
}

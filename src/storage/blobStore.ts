/**
 * 书籍缓存。
 * 这里存的是导入时格式化后的 UTF-8 正文（章回已拆行，章与章之间有分页符），
 * 阅读和目录跳转都读这份，不再回读用户原来的文件。
 */

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

/** 阅读进度：每本一条，写入去抖 500ms + visibilitychange 强制落盘 */

import type { Progress } from '@/types/models';
import { getDB } from '../db';

export async function getProgress(bookId: string): Promise<Progress | undefined> {
  const db = await getDB();
  return db.get('progress', bookId);
}

export async function saveProgress(p: Progress): Promise<void> {
  const db = await getDB();
  await db.put('progress', p);
}

export async function allProgress(): Promise<Progress[]> {
  const db = await getDB();
  return db.getAll('progress');
}

export async function clearProgress(bookId: string): Promise<void> {
  const db = await getDB();
  await db.delete('progress', bookId);
}

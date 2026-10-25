/**
 * 存储层入口：IndexedDB schema 与迁移。
 * 库名 qingyue，版本 2。所有读写必须经过本文件或 repositories。
 */

import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { VoicePack } from '@/tts/types';
import type { BlockIndex, Book, Bookmark, Chapter, FootnoteEntry, Progress } from '@/types/models';

export interface QingyueDB extends DBSchema {
  books: {
    key: string;
    value: Book;
    indexes: { 'by-fingerprint': string; 'by-lastOpened': number };
  };
  files: { key: string; value: { id: string; blob: Blob } };
  chapters: { key: string; value: { bookId: string; items: Chapter[] } };
  blockIndex: { key: string; value: BlockIndex & { bookId: string } };
  footnotes: { key: string; value: { bookId: string; items: FootnoteEntry[] } };
  progress: { key: string; value: Progress };
  bookmarks: { key: string; value: Bookmark; indexes: { 'by-book': string } };
  settings: { key: string; value: { key: string; value: unknown } };
  fonts: {
    key: string;
    value: { id: string; name: string; family: string; blob: Blob; addedAt: number };
  };
  outbox: { key: string; value: { id: string; op: unknown; updatedAt: number } };
  voices: { key: string; value: VoicePack };
}

const DB_NAME = 'qingyue';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<QingyueDB>> | null = null;

export function getDB(): Promise<IDBPDatabase<QingyueDB>> {
  if (!dbPromise) {
    dbPromise = openDB<QingyueDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) {
          const s = db.createObjectStore('books', { keyPath: 'id' });
          s.createIndex('by-fingerprint', 'fingerprint');
          s.createIndex('by-lastOpened', 'lastOpenedAt');
        }
        if (!db.objectStoreNames.contains('files'))
          db.createObjectStore('files', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chapters'))
          db.createObjectStore('chapters', { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains('blockIndex'))
          db.createObjectStore('blockIndex', { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains('footnotes'))
          db.createObjectStore('footnotes', { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains('progress'))
          db.createObjectStore('progress', { keyPath: 'bookId' });
        if (!db.objectStoreNames.contains('bookmarks')) {
          const s = db.createObjectStore('bookmarks', { keyPath: 'id' });
          s.createIndex('by-book', 'bookId');
        }
        if (!db.objectStoreNames.contains('settings'))
          db.createObjectStore('settings', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('fonts'))
          db.createObjectStore('fonts', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('outbox'))
          db.createObjectStore('outbox', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('voices'))
          db.createObjectStore('voices', { keyPath: 'id' });
      },
      blocked() {
        // 另一个标签页持有旧版本连接：提示用户刷新
        console.warn('[qingyue] 数据库升级被其他标签页阻塞，请关闭旧标签页后刷新');
      },
      blocking() {
        // 本页阻塞了其他页的升级：主动放行
        dbPromise?.then((db) => db.close());
        dbPromise = null;
        location.reload();
      },
    });
  }
  return dbPromise;
}

export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

/** 全库清空（设置页的「危险区」） */
export async function wipeAll(): Promise<void> {
  const db = await getDB();
  const names = [
    'books',
    'files',
    'chapters',
    'blockIndex',
    'footnotes',
    'progress',
    'bookmarks',
    'fonts',
    'outbox',
    'voices',
  ] as const;
  const tx = db.transaction([...names], 'readwrite');
  for (const n of names) tx.objectStore(n).clear();
  await tx.done;
}

export async function usageEstimate(): Promise<{
  usage: number;
  quota: number;
  persisted: boolean;
}> {
  let usage = 0;
  let quota = 0;
  let persisted = false;
  try {
    const e = await navigator.storage.estimate();
    usage = e.usage ?? 0;
    quota = e.quota ?? 0;
    persisted = (await navigator.storage.persisted?.()) ?? false;
  } catch {
    /* 忽略 */
  }
  return { usage, quota, persisted };
}

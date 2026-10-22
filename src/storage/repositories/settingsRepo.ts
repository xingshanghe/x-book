/** 设置存取：单条 key=value，含全局默认与每本书的排版覆盖 */

import type { AppSettings } from '@/types/models';
import { getDB } from '../db';
import { defaultSettings } from './defaults';

const KEY = 'default';

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = localStorage.getItem('qingyue.settings.v1');
    if (!raw) return defaultSettings();
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const base = defaultSettings();
    const merged: AppSettings = {
      ...base,
      ...parsed,
      typography: { ...base.typography, ...parsed.typography },
    };
    // v1 → v2：阅读器默认改为分页 + 左侧常驻目录。
    // 一次性的，之后用户自己改的选择会被尊重。
    if ((parsed.schemaVersion ?? 1) < 2) {
      merged.pageMode = 'page';
      merged.tocDocked = true;
      merged.schemaVersion = 2;
      saveSettings(merged);
    }
    return merged;
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem('qingyue.settings.v1', JSON.stringify(s));
  // IndexedDB 里留一份，作为 localStorage 被清时的兜底
  void (async () => {
    try {
      const db = await getDB();
      await db.put('settings', { key: KEY, value: s });
    } catch {
      /* 忽略 */
    }
  })();
}

export async function loadSettingsFromIDB(): Promise<AppSettings | null> {
  try {
    const db = await getDB();
    const rec = await db.get('settings', KEY);
    if (!rec) return null;
    const s = rec.value as AppSettings;
    return { ...defaultSettings(), ...s, typography: { ...defaultSettings().typography, ...s.typography } };
  } catch {
    return null;
  }
}

/** 每本书的排版覆盖（字号/字体/主题等），存 settings 库，key 为 `book:<id>` */
export async function loadBookOverride<T>(bookId: string): Promise<T | null> {
  try {
    const db = await getDB();
    const rec = await db.get('settings', `book:${bookId}`);
    return (rec?.value as T) ?? null;
  } catch {
    return null;
  }
}

export async function saveBookOverride<T>(bookId: string, value: T): Promise<void> {
  const db = await getDB();
  await db.put('settings', { key: `book:${bookId}`, value });
}

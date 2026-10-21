/** 自备字体：TTF/OTF/WOFF2 拖入 → FontFace 注册 + IndexedDB 持久化（≤ 12 个） */

import { getDB } from './db';

export interface StoredFont {
  id: string;
  name: string;
  family: string;
  blob: Blob;
  addedAt: number;
}

const MAX_FONTS = 12;
const FAMILY_PREFIX = 'qy-user-';

export async function listFonts(): Promise<StoredFont[]> {
  const db = await getDB();
  const all = await db.getAll('fonts');
  return all.sort((a, b) => a.addedAt - b.addedAt);
}

export async function addFont(file: File): Promise<StoredFont> {
  const existing = await listFonts();
  if (existing.length >= MAX_FONTS) {
    throw new Error(`最多保留 ${MAX_FONTS} 个自备字体，请先删除不再使用的`);
  }

  const name = file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, '').slice(0, 40);
  const id = `${FAMILY_PREFIX}${Date.now().toString(36)}`;
  const rec: StoredFont = { id, name, family: id, blob: file, addedAt: Date.now() };

  const db = await getDB();
  await db.put('fonts', rec);
  await registerFont(rec);
  return rec;
}

export async function removeFont(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('fonts', id);
}

/** 启动时逐个注册到 document.fonts */
export async function restoreFonts(): Promise<string[]> {
  try {
    const fonts = await listFonts();
    const families: string[] = [];
    for (const f of fonts) {
      await registerFont(f);
      families.push(f.family);
    }
    return families;
  } catch {
    return [];
  }
}

async function registerFont(f: StoredFont): Promise<void> {
  if (typeof document === 'undefined') return;
  if ([...document.fonts].some((fd) => fd.family === f.family)) return;
  const buf = await f.blob.arrayBuffer();
  const face = new FontFace(f.family, buf, { display: 'swap' });
  await face.load();
  document.fonts.add(face);
}

export const ACCEPTED_FONT_TYPES = '.ttf,.otf,.woff,.woff2,.ttc';

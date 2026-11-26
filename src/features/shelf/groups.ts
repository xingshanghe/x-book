/**
 * 书架自定义分组：一书一组（Book.group），目录来自 settings.shelfGroups。
 */

import type { Book } from '@/types/models';

export type ShelfGroupFilter = 'all' | 'ungrouped' | string;

/** 书本拖放到分组芯片的自定义 MIME，与文件导入拖放隔离 */
export const BOOK_DRAG_MIME = 'application/x-qingyue-book-ids';

const RESERVED = new Set(['全部', '全部书籍', '未分组']);

/** 拖起时：若拖的是已选书，带上全部选中；否则只带这一本 */
export function resolveDragBookIds(draggedId: string, selectedIds: ReadonlySet<string>): string[] {
  if (selectedIds.has(draggedId) && selectedIds.size > 0) {
    return [...selectedIds];
  }
  return [draggedId];
}

export function encodeBookDragPayload(ids: readonly string[]): string {
  return JSON.stringify([...ids]);
}

/** 解析拖放 payload；非法或空则返回 [] */
export function parseBookDragPayload(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== 'string' || !item || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  } catch {
    return [];
  }
}

/** 清洗组名：去空白、截断；空或保留名返回 null */
export function normalizeGroupName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, 24);
  if (!name || RESERVED.has(name)) return null;
  return name;
}

/** 目录优先，再补上书里出现但不在目录中的组名 */
export function listShelfGroups(
  catalog: readonly string[],
  books: readonly Pick<Book, 'group'>[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    const name = normalizeGroupName(raw);
    if (!name || seen.has(name)) return;
    seen.add(name);
    out.push(name);
  };
  for (const g of catalog) push(g);
  for (const b of books) push(b.group);
  return out;
}

export function filterBooksByGroup(books: readonly Book[], filter: ShelfGroupFilter): Book[] {
  if (filter === 'all') return [...books];
  if (filter === 'ungrouped') {
    return books.filter((b) => !normalizeGroupName(b.group ?? ''));
  }
  return books.filter((b) => normalizeGroupName(b.group ?? '') === filter);
}

export function groupSectionTitle(filter: ShelfGroupFilter): string {
  if (filter === 'all') return '全部书籍';
  if (filter === 'ungrouped') return '未分组';
  return filter;
}

/** 把新组名插入目录（去重）；无效名返回原目录 */
export function addGroupToCatalog(catalog: readonly string[], raw: string): string[] {
  const name = normalizeGroupName(raw);
  if (!name) return [...catalog];
  const current = listShelfGroups(catalog, []);
  if (current.includes(name)) return current;
  return [...current, name];
}

export function renameGroupInCatalog(
  catalog: readonly string[],
  from: string,
  toRaw: string,
): string[] | null {
  const nextName = normalizeGroupName(toRaw);
  if (!nextName || nextName === from) return null;
  const current = listShelfGroups(catalog, []);
  if (!current.includes(from)) return null;
  if (current.includes(nextName)) return null;
  return current.map((g) => (g === from ? nextName : g));
}

export function removeGroupFromCatalog(catalog: readonly string[], name: string): string[] {
  return listShelfGroups(catalog, []).filter((g) => g !== name);
}

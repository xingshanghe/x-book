/** 记住用户点停止时正在读的那一句。再次开始时从这一句读起。 */

export interface ReadMark {
  charOffset: number;
  sentence: string;
}

const memory = new Map<string, ReadMark>();

function storageKey(bookId: string): string {
  return `qy-tts-stop:${bookId}`;
}

export function rememberReadMark(bookId: string, mark: ReadMark): void {
  memory.set(bookId, mark);
  writeStored(bookId, JSON.stringify(mark));
}

export function recallReadMark(bookId: string): ReadMark | null {
  const cached = memory.get(bookId);
  if (cached) return cached;
  const raw = readStored(bookId);
  if (!raw) return null;
  const parsed = parseMark(raw);
  if (!parsed) return null;
  memory.set(bookId, parsed);
  return parsed;
}

export function clearReadMark(bookId: string): void {
  memory.delete(bookId);
  writeStored(bookId, null);
}

function parseMark(raw: string): ReadMark | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as { charOffset?: unknown; sentence?: unknown };
    if (typeof record.charOffset !== 'number' || !Number.isFinite(record.charOffset)) return null;
    if (typeof record.sentence !== 'string') return null;
    return { charOffset: record.charOffset, sentence: record.sentence };
  } catch {
    return null;
  }
}

function readStored(bookId: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(storageKey(bookId));
  } catch {
    return null;
  }
}

function writeStored(bookId: string, value: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const key = storageKey(bookId);
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 隐私模式写不进去时，这一次打开仍记得 */
  }
}

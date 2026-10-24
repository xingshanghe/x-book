/**
 * 导入时把章回从正文里拆出来，并在新章之前写入分页符。
 * 产出的字节同时送去建索引和写入书籍缓存，字符偏移才对得上。
 */

import { CHAPTER_NUMBER, CHAPTER_UNIT, type ChapterDetector } from './chapters';

/** 分页符。独占一行，阅读时不显示，用来把上一章和下一章切开。 */
export const PAGE_BREAK = '\f';

const INLINE_HEAD = new RegExp(`第\\s*[${CHAPTER_NUMBER}]{1,12}\\s*[${CHAPTER_UNIT}]`, 'g');

const CLOSER: Record<string, string> = {
  '《': '》',
  '「': '」',
  '『': '』',
  '“': '”',
  '"': '"',
};

export function isPageBreakLine(line: string): boolean {
  return line.trim() === PAGE_BREAK;
}

/** 把一行里粘在一起的章回标题拆开。没有标题时原样返回。 */
export function splitHeadingLine(line: string, detector: ChapterDetector): string[] {
  const trimmed = line.replace(/\u3000/g, ' ').trim();
  if (!trimmed) return [];
  if (isPageBreakLine(trimmed)) return [PAGE_BREAK];

  const whole = detector.test(trimmed);
  if (whole) return [whole.title];

  const pieces = splitInline(trimmed, detector);
  if (pieces.length <= 1) return [trimmed];
  return pieces.map((piece) => detector.test(piece)?.title ?? piece);
}

export class ChapterRewriter {
  private readonly decoder = new TextDecoder('utf-8', { fatal: false });
  private readonly encoder = new TextEncoder();
  private buf = '';
  private seenBody = false;
  private heldBlanks = 0;
  private lastEmitted = '';

  constructor(private readonly detector: ChapterDetector) {}

  push(chunk: Uint8Array): Uint8Array[] {
    this.buf += this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  finish(): Uint8Array[] {
    this.buf += this.decoder.decode();
    const out = this.drain(true);
    this.heldBlanks = 0;
    return out;
  }

  private drain(eof: boolean): Uint8Array[] {
    const produced: string[] = [];
    for (;;) {
      const nl = this.buf.indexOf('\n');
      if (nl < 0) break;
      const line = this.buf.slice(0, nl).replace(/\r$/, '');
      this.buf = this.buf.slice(nl + 1);
      this.consume(line, produced);
    }
    if (!eof && this.buf.length > 8192) this.flushLongLine(produced);
    if (eof && this.buf) {
      this.consume(this.buf.replace(/\r$/, ''), produced);
      this.buf = '';
    }
    if (produced.length === 0) return [];
    return [this.encoder.encode(`${produced.join('\n')}\n`)];
  }

  /** 超长无换行段落：留住末尾可能写了一半的章名，前面先交出去。 */
  private flushLongLine(produced: string[]): void {
    let head = this.buf.slice(0, this.buf.length - 120);
    let keep = this.buf.slice(this.buf.length - 120);
    const rewound = rewindPartialHeading(head);
    head = rewound.emit;
    keep = rewound.keep + keep;
    if (!head) {
      head = this.buf.slice(0, 4096);
      keep = this.buf.slice(4096);
    }
    this.buf = keep;
    this.consume(head, produced);
  }

  private consume(raw: string, out: string[]): void {
    const parts = splitHeadingLine(raw, this.detector);
    if (parts.length === 0) {
      this.heldBlanks = 1;
      return;
    }
    for (const part of parts) this.emitPart(part, out);
  }

  private emitPart(part: string, out: string[]): void {
    if (part === PAGE_BREAK) {
      this.heldBlanks = 0;
      this.emitBreak(out);
      return;
    }
    if (this.detector.test(part)) {
      this.heldBlanks = 0;
      this.emitBreak(out);
      this.pushLine(out, part);
      this.seenBody = true;
      return;
    }
    if (this.heldBlanks) {
      this.pushLine(out, '');
      this.heldBlanks = 0;
    }
    this.pushLine(out, part);
    this.seenBody = true;
  }

  private emitBreak(out: string[]): void {
    if (!this.seenBody || this.lastEmitted === PAGE_BREAK) return;
    this.pushLine(out, PAGE_BREAK);
  }

  private pushLine(out: string[], line: string): void {
    out.push(line);
    this.lastEmitted = line;
  }
}

function splitInline(text: string, detector: ChapterDetector): string[] {
  const found = findInline(text, detector);
  if (!found) return [text];
  const out: string[] = [];
  const prefix = text.slice(0, found.start).trim();
  if (prefix) out.push(prefix);
  out.push(found.title);
  const rest = text
    .slice(found.end)
    .replace(/^[\s　]*[。！？!?]+[\s　]*/, '')
    .trim();
  if (rest) out.push(...splitInline(rest, detector));
  return out;
}

function findInline(
  text: string,
  detector: ChapterDetector,
): { start: number; end: number; title: string } | null {
  INLINE_HEAD.lastIndex = 0;
  for (;;) {
    const matched = INLINE_HEAD.exec(text);
    if (!matched) break;
    if (!boundaryBefore(text, matched.index)) continue;
    const end = headingSpan(text, matched.index + matched[0].length);
    if (end == null) continue;
    const hit = detector.test(text.slice(matched.index, end));
    if (!hit) continue;
    return { start: matched.index, end, title: hit.title };
  }
  return null;
}

function boundaryBefore(text: string, index: number): boolean {
  let cursor = index - 1;
  while (cursor >= 0 && /[\s　]/.test(text[cursor])) cursor -= 1;
  if (cursor < 0) return true;
  return '。！？!?…\n”」』'.includes(text[cursor]);
}

/** 标题收到书名号或句末为止。紧贴着的正文留给下一行。 */
function headingSpan(text: string, from: number): number | null {
  let cursor = from;
  while (cursor < text.length && /[\s　]/.test(text[cursor])) cursor += 1;
  const afterCore = cursor;
  const paren = /^[（(][^）)\n]{1,8}[）)]/.exec(text.slice(cursor));
  if (paren) {
    cursor += paren[0].length;
    while (cursor < text.length && /[\s　]/.test(text[cursor])) cursor += 1;
  }
  if (/[：:、.．]/.test(text[cursor] ?? '')) {
    cursor += 1;
    while (cursor < text.length && /[\s　]/.test(text[cursor])) cursor += 1;
  }
  const opener = text[cursor];
  if (opener && CLOSER[opener]) return quotedEnd(text, cursor);
  if (cursor === afterCore && !paren) return null;
  return plainEnd(text, cursor);
}

function quotedEnd(text: string, openerAt: number): number | null {
  const closer = CLOSER[text[openerAt]];
  const end = text.indexOf(closer, openerAt + 1);
  if (end < 0 || end - openerAt > 42) return null;
  let titleEnd = end + 1;
  const rest = text.slice(titleEnd);
  const gap = rest.length - rest.trimStart().length;
  const paren = /^[（(][^）)\n]{1,8}[）)]/.exec(rest.trimStart());
  if (paren) titleEnd += gap + paren[0].length;
  return titleEnd;
}

function plainEnd(text: string, from: number): number | null {
  let cursor = from;
  while (cursor < text.length && cursor - from < 30 && !/[。！？!?\n]/.test(text[cursor]))
    cursor += 1;
  const rest = text.slice(cursor);
  if (rest.trim() === '' || /^[。！？!?]/.test(rest)) return cursor;
  return null;
}

function rewindPartialHeading(head: string): { emit: string; keep: string } {
  const window = head.slice(-120);
  const rel = window.search(
    /第\s*[0-9０-９零一二三四五六七八九十百千万两〇○]{0,12}[^。！？\n]{0,40}$/,
  );
  if (rel < 0) return { emit: head, keep: '' };
  const at = head.length - window.length + rel;
  return { emit: head.slice(0, at), keep: head.slice(at) };
}

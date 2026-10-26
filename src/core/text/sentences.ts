/**
 * 按标点把正文切成句子。纯函数，不访问 DOM。
 * 省略号、破折号、小数点和英文缩写不切。
 */

const ABBREV = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)$/i;

const CLOSE_QUOTE = new Set(['"', "'", '”', '’', '」', '』', '）', ')']);

export interface SentenceSpan {
  text: string;
  /** 换行归一化之后，按 Unicode 码点计的起点。 */
  start: number;
}

/** 切句，并记下每句在原文里的起点，方便从某一句接着读。 */
export function sentenceSpans(input: string): SentenceSpan[] {
  const normalized = input.replace(/\r\n/g, '\n');
  const trimmed = normalized.trim();
  if (!trimmed) return [];
  const leading = Array.from(normalized.slice(0, normalized.indexOf(trimmed))).length;
  return scanSentences(trimmed).map((span) => ({
    text: span.text,
    start: span.start + leading,
  }));
}

export function splitSentences(input: string): string[] {
  return sentenceSpans(input).map((span) => span.text);
}

export interface SentencePiece {
  text: string;
  /** 换行归一化之后，按 Unicode 码点计的起点。 */
  start: number;
  /** 句末切出来的一句。句间空白是 false，朗读时不单独高亮。 */
  sentence: boolean;
}

/**
 * 把一段拆成句子和句间空白，拼回去仍是原文。
 * 句子的 start 与朗读脚本的句起点用同一套切分。
 */
export function sentencePieces(input: string): SentencePiece[] {
  const normalized = input.replace(/\r\n/g, '\n');
  const spans = sentenceSpans(normalized);
  if (spans.length === 0) {
    return normalized ? [{ text: normalized, start: 0, sentence: false }] : [];
  }
  const chars = Array.from(normalized);
  const pieces: SentencePiece[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) {
      pieces.push({
        text: chars.slice(cursor, span.start).join(''),
        start: cursor,
        sentence: false,
      });
    }
    const end = span.start + Array.from(span.text).length;
    pieces.push({ text: span.text, start: span.start, sentence: true });
    cursor = end;
  }
  if (cursor < chars.length) {
    pieces.push({ text: chars.slice(cursor).join(''), start: cursor, sentence: false });
  }
  return pieces;
}

function scanSentences(text: string): SentenceSpan[] {
  const chars = Array.from(text);
  const out: SentenceSpan[] = [];
  let buf = '';
  let bufStart = 0;

  const push = () => {
    const raw = buf;
    buf = '';
    const sentence = raw.trim();
    if (!sentence) return;
    const skipped = Array.from(raw.slice(0, raw.length - raw.trimStart().length)).length;
    out.push({ text: sentence, start: bufStart + skipped });
  };

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (!buf) bufStart = i;
    buf += c;

    if (c === '\n') {
      push();
      continue;
    }
    if (c === '…' || c === '—' || c === '–') continue;
    if (c === '.' && chars[i + 1] === '.' && chars[i + 2] === '.') continue;
    if (c === '.' && chars[i - 1] === '.') continue;

    if (c === '。' || c === '！' || c === '？' || c === '!' || c === '?') {
      i = takeClosingQuotes(chars, i, (ch) => {
        buf += ch;
      });
      push();
      continue;
    }

    if (c === '.') {
      if (isDecimal(chars, i) || isInitial(chars, i) || ABBREV.test(buf.slice(0, -1).trim())) {
        continue;
      }
      i = takeClosingQuotes(chars, i, (ch) => {
        buf += ch;
      });
      push();
    }
  }

  push();
  return out;
}

function takeClosingQuotes(chars: string[], i: number, append: (ch: string) => void): number {
  let j = i;
  while (CLOSE_QUOTE.has(chars[j + 1] ?? '')) {
    j += 1;
    append(chars[j]);
  }
  return j;
}

function isDecimal(chars: string[], i: number): boolean {
  return isDigit(chars[i - 1]) && isDigit(chars[i + 1]);
}

function isInitial(chars: string[], i: number): boolean {
  const prev = chars[i - 1] ?? '';
  const before = chars[i - 2] ?? '';
  return /[A-Za-z]/.test(prev) && (before === '' || before === ' ' || before === '.');
}

function isDigit(ch: string | undefined): boolean {
  return ch != null && ch >= '0' && ch <= '9';
}

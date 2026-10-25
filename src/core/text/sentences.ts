/**
 * 按标点把正文切成句子。纯函数，不访问 DOM。
 * 省略号、破折号、小数点和英文缩写不切。
 */

const ABBREV = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|e\.g|i\.e)$/i;

const CLOSE_QUOTE = new Set(['"', "'", '”', '’', '」', '』', '）', ')']);

export function splitSentences(input: string): string[] {
  const text = input.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const chars = Array.from(text);
  const out: string[] = [];
  let buf = '';

  const push = () => {
    const sentence = buf.trim();
    buf = '';
    if (sentence) out.push(sentence);
  };

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
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

  const tail = buf.trim();
  if (tail) out.push(tail);
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

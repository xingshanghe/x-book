/**
 * 只改送给引擎的读法，不改书架上的原文。
 * 开声的第一段固定一句，避免按下朗读后要等更久。
 */

const DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'] as const;

/** 同一段里，第一声之后最多并这么多句。 */
const NEXT_UTTERANCE_MAX_SENTENCES = 3;
/** 并进去的汉字再多，模型容易发虚，首段也会变慢。超长句仍单独读。 */
const NEXT_UTTERANCE_MAX_CHARS = 80;

const CHAPTER_UNIT = /第(\d{1,4})([章节回集部卷话篇])/g;

export interface UtteranceSentence {
  text: string;
  paragraphEnd: boolean;
}

export function prepareSpokenText(text: string): string {
  const folded = text
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30))
    .replace(/％/g, '%');
  const spoken = folded
    .replace(/(\d{1,4}(?:\.\d{1,2})?)%/g, (_all, raw: string) => `百分之${readDecimal(raw)}`)
    .replace(CHAPTER_UNIT, (_all, raw: string, unit: string) => `第${cardinal(Number(raw))}${unit}`)
    .replace(/(?<!\d)(\d{4})年/g, (_all, raw: string) => `${yearDigits(raw)}年`)
    .replace(/(?<!\d)(\d{1,3})年/g, (_all, raw: string) => `${cardinal(Number(raw))}年`)
    .replace(/(?<!\d)(\d{1,2})月/g, (_all, raw: string) => `${cardinal(Number(raw))}月`)
    .replace(/(?<!\d)(\d{1,2})日/g, (_all, raw: string) => `${cardinal(Number(raw))}日`);
  return spoken.trim() ? spoken : text;
}

/** 从 at 起这一次合成几句。第一声固定一句。 */
export function utteranceCount(
  sentences: readonly UtteranceSentence[],
  at: number,
  firstSound: boolean,
): number {
  if (firstSound || at < 0 || at >= sentences.length) return 1;
  let chars = 0;
  let count = 0;
  const limit = Math.min(sentences.length, at + NEXT_UTTERANCE_MAX_SENTENCES);
  for (let i = at; i < limit; i += 1) {
    const sentence = sentences[i];
    if (!sentence) break;
    const len = Array.from(sentence.text).length;
    if (count > 0 && chars + len > NEXT_UTTERANCE_MAX_CHARS) break;
    count += 1;
    chars += len;
    if (sentence.paragraphEnd) break;
  }
  return Math.max(1, count);
}

export function joinUtterance(parts: readonly string[]): string {
  let out = '';
  for (const part of parts) {
    if (!out) {
      out = part;
      continue;
    }
    const gap = /[.!?]["']?$/.test(out) ? ' ' : '';
    out = `${out}${gap}${part}`;
  }
  return out;
}

/** 一段音频里的进度，按各句字数摊回句号。ratio 取 0 到 1。 */
export function partIndexAtRatio(lengths: readonly number[], ratio: number): number {
  const total = lengths.reduce((sum, len) => sum + len, 0);
  if (lengths.length === 0 || total <= 0) return 0;
  const clamped = Math.min(1, Math.max(0, ratio));
  if (clamped >= 1) return lengths.length - 1;
  const target = clamped * total;
  let covered = 0;
  for (let i = 0; i < lengths.length; i += 1) {
    covered += lengths[i] ?? 0;
    if (target < covered) return i;
  }
  return lengths.length - 1;
}

function readDecimal(raw: string): string {
  const [whole, frac] = raw.split('.');
  const head = cardinal(Number(whole));
  if (!frac) return head;
  const tail = Array.from(frac)
    .map((digit) => DIGITS[Number(digit)] ?? digit)
    .join('');
  return `${head}点${tail}`;
}

function yearDigits(raw: string): string {
  return Array.from(raw)
    .map((digit) => DIGITS[Number(digit)] ?? digit)
    .join('');
}

function cardinal(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 9999) return String(value);
  if (value === 0) return '零';
  const units = ['', '十', '百', '千'];
  const text = String(value);
  let out = '';
  let pendingZero = false;
  for (let i = 0; i < text.length; i += 1) {
    const digit = Number(text[i]);
    const unit = text.length - 1 - i;
    if (digit === 0) {
      pendingZero = out.length > 0;
      continue;
    }
    if (pendingZero) {
      out += '零';
      pendingZero = false;
    }
    const teen = digit === 1 && unit === 1 && out === '';
    if (!teen) out += DIGITS[digit] ?? '';
    out += units[unit] ?? '';
  }
  return out;
}

/**
 * 注音表。只改送给引擎的词表，不改书架上的原文。
 * 引擎按整词最长匹配，并且先载入的读音有效。这里把用户的词放在原词表前面。
 */

export interface Pronunciation {
  word: string;
  reading: string;
}

export interface LexiconEntry {
  word: string;
  phones: string;
}

export const PRONUNCIATION_LIMIT = 200;

const KEY = 'qingyue.tts.pronunciations';

const INITIALS = [
  'zh',
  'ch',
  'sh',
  'b',
  'p',
  'm',
  'f',
  'd',
  't',
  'n',
  'l',
  'g',
  'k',
  'h',
  'j',
  'q',
  'x',
  'r',
  'z',
  'c',
  's',
  'y',
  'w',
] as const;

/** 引擎 tokens.txt 里实际有的韵母声调。没有的组合不能写进词表。 */
const FINAL_TONES: Record<string, string> = {
  a: '12345',
  ai: '12345',
  an: '12345',
  ang: '12345',
  ao: '12345',
  e: '12345',
  ei: '12345',
  en: '12345',
  eng: '12345',
  er: '2345',
  i: '12345',
  ia: '12345',
  ian: '12345',
  iang: '12345',
  iao: '12345',
  ie: '12345',
  in: '12345',
  ing: '12345',
  iong: '1234',
  iu: '12345',
  m: '1245',
  n: '2345',
  ng: '5',
  o: '12345',
  ong: '12345',
  ou: '12345',
  u: '12345',
  ua: '1234',
  uai: '12345',
  uan: '12345',
  uang: '12345',
  ue: '1234',
  ui: '12345',
  un: '12345',
  uo: '12345',
  v: '234',
  ve: '34',
  ê: '1234',
};

const TONE_MARKS: Record<string, { vowel: string; tone: string }> = {
  ā: { vowel: 'a', tone: '1' },
  á: { vowel: 'a', tone: '2' },
  ǎ: { vowel: 'a', tone: '3' },
  à: { vowel: 'a', tone: '4' },
  ē: { vowel: 'e', tone: '1' },
  é: { vowel: 'e', tone: '2' },
  ě: { vowel: 'e', tone: '3' },
  è: { vowel: 'e', tone: '4' },
  ī: { vowel: 'i', tone: '1' },
  í: { vowel: 'i', tone: '2' },
  ǐ: { vowel: 'i', tone: '3' },
  ì: { vowel: 'i', tone: '4' },
  ō: { vowel: 'o', tone: '1' },
  ó: { vowel: 'o', tone: '2' },
  ǒ: { vowel: 'o', tone: '3' },
  ò: { vowel: 'o', tone: '4' },
  ū: { vowel: 'u', tone: '1' },
  ú: { vowel: 'u', tone: '2' },
  ǔ: { vowel: 'u', tone: '3' },
  ù: { vowel: 'u', tone: '4' },
  ǖ: { vowel: 'v', tone: '1' },
  ǘ: { vowel: 'v', tone: '2' },
  ǚ: { vowel: 'v', tone: '3' },
  ǜ: { vowel: 'v', tone: '4' },
};

type PronunciationStore = Pick<Storage, 'getItem' | 'setItem'>;

export function readPronunciations(storage: PronunciationStore = browserStore()): Pronunciation[] {
  const raw = storage.getItem(KEY);
  if (!raw) return [];
  try {
    return normalizeList(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function writePronunciations(
  list: readonly Pronunciation[],
  storage: PronunciationStore = browserStore(),
): Pronunciation[] {
  const next = normalizeList(list);
  storage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** 不能写入时返回给界面的那句话。能写入时是 null。 */
export function explainPronunciation(word: string, reading: string): string | null {
  const chars = Array.from(word.trim());
  if (chars.length === 0) return '请填写词语';
  if (chars.length > 10 || chars.some((ch) => !isHan(ch))) return '词语请用十个以内的汉字';
  const parts = splitReading(reading);
  if (!parts) return '请填写读音';
  if (parts.length !== chars.length) return '读音要和字数一样，每个字一个音节';
  for (const part of parts) {
    if (!phonesOf(part)) return `「${part}」不是带声调的拼音`;
  }
  return null;
}

export function normalizedReading(reading: string): string | null {
  const parts = splitReading(reading);
  if (!parts) return null;
  const syllables: string[] = [];
  for (const part of parts) {
    const syllable = normalizeSyllable(part);
    if (!syllable || !phonesOf(part)) return null;
    syllables.push(syllable);
  }
  return syllables.join(' ');
}

/** 转成引擎词表的一行。无效条目跳过。同一词只留先出现的那条。 */
export function lexiconEntries(list: readonly Pronunciation[]): LexiconEntry[] {
  const out: LexiconEntry[] = [];
  const seen = new Set<string>();
  for (const item of normalizeList(list)) {
    if (seen.has(item.word)) continue;
    const parts = splitReading(item.reading);
    if (!parts) continue;
    const phones = parts.map((part) => phonesOf(part) ?? '').join(' ');
    if (!phones || phones.includes('  ')) continue;
    seen.add(item.word);
    out.push({ word: item.word, phones });
  }
  return out;
}

function normalizeList(input: unknown): Pronunciation[] {
  if (!Array.isArray(input)) return [];
  const out: Pronunciation[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { word?: unknown; reading?: unknown };
    if (typeof record.word !== 'string' || typeof record.reading !== 'string') continue;
    const word = record.word.trim();
    const reading = normalizedReading(record.reading);
    if (!reading || explainPronunciation(word, reading)) continue;
    if (seen.has(word)) continue;
    seen.add(word);
    out.push({ word, reading });
    if (out.length >= PRONUNCIATION_LIMIT) break;
  }
  return out;
}

function splitReading(reading: string): string[] | null {
  const source = reading.trim().toLowerCase().replace(/ü/g, 'v');
  if (!source) return null;
  const parts: string[] = [];
  for (const chunk of source.split(/[\s,，、;；]+/).filter(Boolean)) {
    const taken = takeSyllables(chunk);
    parts.push(...(taken ?? [chunk]));
  }
  return parts.length > 0 ? parts : null;
}

/** 一串拼音里，每次取最长的合法音节。hángzhǎng 会切成 háng、zhǎng。 */
function takeSyllables(chunk: string): string[] | null {
  const parts: string[] = [];
  let rest = chunk;
  while (rest) {
    let found = '';
    for (let len = rest.length; len > 0; len -= 1) {
      const prefix = rest.slice(0, len);
      if (phonesOf(prefix)) {
        found = prefix;
        break;
      }
    }
    if (!found) return null;
    parts.push(found);
    rest = rest.slice(found.length);
  }
  return parts;
}

function normalizeSyllable(raw: string): string | null {
  if (/[1-5]/.test(raw) && !/[1-5]$/.test(raw)) return null;
  let tone = '';
  let body = '';
  for (const ch of raw) {
    const marked = TONE_MARKS[ch];
    if (marked) {
      if (tone) return null;
      body += marked.vowel;
      tone = marked.tone;
      continue;
    }
    if (ch >= '1' && ch <= '5') {
      if (tone) return null;
      tone = ch;
      continue;
    }
    if ((ch >= 'a' && ch <= 'z') || ch === 'ê') {
      body += ch;
      continue;
    }
    return null;
  }
  if (!tone || !body) return null;
  return `${body}${tone}`;
}

function phonesOf(raw: string): string | null {
  const syllable = normalizeSyllable(raw);
  if (!syllable) return null;
  const tone = syllable.slice(-1);
  const body = syllable.slice(0, -1);
  const split = splitBody(body);
  if (!split) return null;
  const final = rewriteFinal(split.initial, split.final);
  if (!FINAL_TONES[final]?.includes(tone)) return null;
  if (!split.initial) return `${final}${tone}`;
  return `${split.initial}0 ${final}${tone}`;
}

function splitBody(body: string): { initial: string; final: string } | null {
  for (const initial of INITIALS) {
    if (!body.startsWith(initial)) continue;
    const rest = body.slice(initial.length);
    if (!rest) continue;
    if (FINAL_TONES[rewriteFinal(initial, rest)]) return { initial, final: rest };
  }
  if (FINAL_TONES[body]) return { initial: '', final: body };
  return null;
}

/** j q x y 后面的 ü 在这份词表里写成 u，n l 后面仍写成 v。 */
function rewriteFinal(initial: string, final: string): string {
  if ('jqxy'.includes(initial) && final.startsWith('v')) return `u${final.slice(1)}`;
  return final;
}

function isHan(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return code >= 0x3400 && code <= 0x9fff;
}

function browserStore(): PronunciationStore {
  try {
    if (typeof localStorage === 'undefined') throw new Error('no storage');
    return localStorage;
  } catch {
    const map = new Map<string, string>();
    return {
      getItem: (key) => map.get(key) ?? null,
      setItem: (key, value) => {
        map.set(key, value);
      },
    };
  }
}

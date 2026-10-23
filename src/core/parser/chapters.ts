/**
 * 章节识别。
 *
 * 三段式：
 *   1. 内置通杀正则（第X章 / 卷X / Chapter N / 序章 楔子 后记 …）
 *   2. 「向这本书学习」：读前 512 KB 的标题模板，学到的模式作用于全书 ——
 *      对付《第1节 xxx》《01. xxx》《三、xxx》这类非标准但自洽的写法
 *   3. 手动标记 `[::]`：行首写 `[::]`（或 `[::]`）即强制视为章标题，优先级最高
 *
 * 只在「行首 40 字节内有可能」时才解码整行，避免全文解码。
 */

/** 内置：绝大多数中文出版物与网文 */
export const BUILTIN_CHAPTER_SOURCES = [
  // 第X章/节/回/卷/部/篇/集/话/折/幕  + 可选标题
  '^\\s*(?:第\\s*[零一二三四五六七八九十百千两〇0-9]{1,12}\\s*[章节節回巻卷部篇集话話折幕折]\\s*[：:、.．。]?\\s*).{0,60}$',
  // 卷 / Chapter / Part /Chapter Roman
  '^\\s*(?:卷\\s*[零一二三四五六七八九十百千两〇0-9]{1,8}|Chapter\\s+[0-9IVXLC]{1,8}|Part\\s+[0-9IVXLC]{1,8})\\s*[:：、.．。]?\\s*.{0,60}$',
  // 纯序号式：1. xxx / 001 xxx / 一、xxx
  '^\\s*(?:[0-9]{1,4}\\s*[.、．:：]\\s*|[零一二三四五六七八九十百千]{1,6}\\s*[、.]\\s*).{1,60}$',
  // 固定词标题
  '^\\s*(?:序章?|序言?|前言|引子|楔子|後记|后记|尾声|尾聲|番外|附录|附錄|自序|楔|引)\\s*[:：、.．。]?\\s*.{0,40}$',
  // 「正文」必须独占一行。写进上面那条会把「正文里有一句话」也当成标题。
  '^\\s*正文\\s*[:：、.．。]?\\s*$',
];

export const MANUAL_MARKER = '[::]';

const CJK_NUM = '零一二三四五六七八九十百千两〇';

export interface DetectorOptions {
  learned?: string[];
  custom?: string;
}

function build(sourceList: string[]): RegExp | null {
  if (sourceList.length === 0) return null;
  try {
    return new RegExp(sourceList.map((s) => `(?:${s})`).join('|'));
  } catch {
    return null;
  }
}

export class ChapterDetector {
  private readonly learnedRegex: RegExp | null;
  private readonly customRegex: RegExp | null;
  private readonly builtinRegex: RegExp;

  constructor(opts: DetectorOptions = {}) {
    this.learnedRegex = opts.learned?.length ? build(opts.learned) : null;
    this.customRegex = opts.custom ? safeBuild(opts.custom) : null;
    this.builtinRegex = build(BUILTIN_CHAPTER_SOURCES) as RegExp;
  }

  /**
   * 判断一行是否为章标题。
   * 返回 null 表示非标题；否则返回 { title, level }
   */
  test(rawLine: string): { title: string; level: number } | null {
    const line = rawLine.trim();
    if (!line) return null;

    // 手动标记最高优先级
    if (line.startsWith(MANUAL_MARKER)) {
      const t = line.slice(MANUAL_MARKER.length).trim() || line;
      return { title: t, level: 0 };
    }

    if (line.length > 80) return null;

    if (this.customRegex?.test(line)) return { title: cleanTitle(line), level: 2 };
    if (this.builtinRegex.test(line)) return { title: cleanTitle(line), level: 2 };
    if (this.learnedRegex?.test(line)) return { title: cleanTitle(line), level: 2 };

    return null;
  }

  /** 一行文本是否「值得」被解码出来做正则检测（廉价的前置过滤） */
  static worthDecoding(firstByte: number, lineChars: number, lineBytes: number): boolean {
    if (lineChars > 80 || lineBytes > 240) return false;
    // 数字、大小写字母、健壮的部分 CJK 首字节（0xE4–0xE9 覆盖常用区）
    return (
      (firstByte >= 0x30 && firstByte <= 0x39) ||
      (firstByte >= 0x41 && firstByte <= 0x5a) ||
      (firstByte >= 0x61 && firstByte <= 0x7a) ||
      firstByte === 0x5b || // '[' 手动标记
      (firstByte >= 0xe4 && firstByte <= 0xe9) ||
      firstByte === 0x20 ||
      firstByte === 0x09
    );
  }
}

function safeBuild(src: string): RegExp | null {
  try {
    return new RegExp(src);
  } catch {
    return null;
  }
}

function cleanTitle(line: string): string {
  return line
    .replace(/^\[::\]\s*/, '')
    .replace(/^第\s*([零一二三四五六七八九十百千两〇0-9]+)\s*([章节節回巻卷部篇集话話折幕])/, (_, n, u) => `第${n}${u}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * 目录侧栏用的短标题：去掉「正文 / 第X卷 / Chapter」等重复前缀，保留信息量大的部分。
 * 只影响显示，不改原文。
 */
export function simplifyTitle(title: string, index: number): string {
  let t = title.trim();
  t = t.replace(/^(正文|作品相关|内容|本书|全书)\s*[：:]?\s*/, '');
  t = t.replace(/^(第[零一二三四五六七八九十百千两〇0-9]+[卷部篇])\s*[^\p{L}\p{N}]*/u, '$1 ');
  t = t.replace(/^第([零一二三四五六七八九十百千两〇0-9]+)([章节節回话話])/, (_m, n, u) => {
    return `${u}${toNumber(n)}`;
  });
  if (!t) t = `第 ${index + 1} 节`;
  return t.length > 28 ? `${t.slice(0, 28)}…` : t;
}

function toNumber(zh: string): string {
  if (/^[0-9]+$/.test(zh)) return zh;
  const map: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2, 〇: 0,
  };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  let num = 0;
  for (const ch of zh) {
    if (map[ch] !== undefined) num = map[ch];
    else if (units[ch] !== undefined) {
      section += (num || 1) * units[ch];
      num = 0;
    }
  }
  total = section + num;
  return String(total || zh);
}

/**
 * 「向这本书学习」：从样本文本里归纳标题模板。
 * 思路：把候选行里的数字/汉字数字换成 `#`，统计模板频次，
 * 取命中 ≥ 4 次且形如「前缀 + # + 可选后缀」的模板作为 learned 正则。
 */
export function learnPatterns(sample: string, maxPatterns = 4): string[] {
  const builtin = build(BUILTIN_CHAPTER_SOURCES);
  const lines = sample.split('\n');
  const tally = new Map<string, number>();

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.length > 60 || line.length < 2) continue;
    if (builtin?.test(line)) continue; // 已能被通杀规则覆盖，无需学习
    const template = generalize(line);
    if (!template) continue;
    tally.set(template, (tally.get(template) ?? 0) + 1);
  }

  return [...tally.entries()]
    .filter(([, n]) => n >= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxPatterns)
    .map(([tpl]) => tpl);
}

/** 把一行里的序号替换成 `#`，得到可复用的模板 */
function generalize(line: string): string | null {
  // 必须含序号，否则「第一章 share」这种任意短句都会被当成标题
  const digit = line.replace(/[0-9]{1,4}/g, '#');
  if (digit !== line) {
    const escaped = escapeRegExp(digit)
      .replace(/#/g, '[0-9]{1,4}')
      .replace(/^\\s\+/, '^\\s*');
    return `^\\s*${escaped}$`;
  }
  if (new RegExp(`[${CJK_NUM}]`).test(line)) {
    const han = line.replace(new RegExp(`[${CJK_NUM}]{1,6}`, 'g'), '#');
    const escaped = escapeRegExp(han).replace(/#/g, `[${CJK_NUM}0-9]{1,6}`);
    return `^\\s*${escaped}$`;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 卷前、部头（正文/卷）、章回、卷末。决定标题牌的大小和另起一页。 */
export type ChapterRole = 'front' | 'part' | 'chapter' | 'back';

const FRONT_RE = /^(?:序章|序言|前言|引子|楔子|自序|引言|开篇|序幕|序|楔|引)/;
const BACK_RE = /^(?:后记|後记|尾声|尾聲|番外|附录|附錄|跋|结语)/;
const PART_RE =
  /^(?:正文|卷\s*[零一二三四五六七八九十百千两〇0-9]+|第\s*[零一二三四五六七八九十百千两〇0-9]+\s*[卷部篇])/;

export function chapterRole(title: string): ChapterRole {
  const t = title.trim();
  if (PART_RE.test(t)) return 'part';
  if (BACK_RE.test(t)) return 'back';
  if (FRONT_RE.test(t)) return 'front';
  return 'chapter';
}

export interface HeadingPlate {
  role: ChapterRole;
  /** 章回编号，如「第一章」。卷前卷末为空。 */
  kicker: string;
  /** 展示用标题。章回只留题名。 */
  title: string;
  /** 原文，给无障碍标签 */
  full: string;
  /** 短标题拉开字距，如「前 言」「正 文」 */
  spaced: boolean;
}

const headingDetector = new ChapterDetector();

export function headingKey(value: string): string {
  return value.trim().replace(/\s+/g, '');
}

function buildPlate(full: string, role: ChapterRole): HeadingPlate {
  const compact = full.replace(/\s+/g, '');
  const spaced = compact.length > 0 && compact.length <= 6;
  if (role !== 'chapter') return { role, kicker: '', title: full, full, spaced };
  const matched = full.match(
    /^(第\s*[零一二三四五六七八九十百千两〇0-9]+\s*[章节節回巻卷部篇集话話折幕])\s*(.*)$/,
  );
  const rest = matched?.[2]?.trim() ?? '';
  if (matched && rest) {
    return { role, kicker: matched[1].replace(/\s+/g, ''), title: rest, full, spaced: false };
  }
  return { role, kicker: '', title: full, full, spaced };
}

/** 这一行是不是章回标题。roleHint 用来接住索引时学到、但内置规则认不出的标题。 */
export function plateForLine(line: string, roleHint?: ChapterRole): HeadingPlate | null {
  const text = line.trim();
  if (!text) return null;
  const detected = headingDetector.test(text);
  if (detected) return buildPlate(detected.title, chapterRole(detected.title));
  if (!roleHint || text.length > 80) return null;
  return buildPlate(text.replace(/\s+/g, ' '), roleHint);
}

export function plateForStoredTitle(line: string, titles: readonly string[]): HeadingPlate | null {
  if (titles.length === 0) return null;
  const text = line.trim();
  if (!text || text.length > 80) return null;
  const key = headingKey(text);
  for (const title of titles) {
    if (headingKey(title) !== key) continue;
    return buildPlate(title.trim().replace(/\s+/g, ' '), chapterRole(title));
  }
  return null;
}

/**
 * 同一标题在一章里只成一次牌。seen 是这一轮渲染的记账，调用方自己准备。
 */
export function takeHeadingPlate(
  line: string,
  storedTitles: readonly string[],
  seen: Set<string>,
  roleHint?: ChapterRole,
): HeadingPlate | null {
  const plate = plateForLine(line, roleHint) ?? plateForStoredTitle(line, storedTitles);
  if (!plate) return null;
  const key = headingKey(plate.full);
  if (!key || seen.has(key)) return null;
  seen.add(key);
  return plate;
}

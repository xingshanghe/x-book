/**
 * 编码检测 —— 纯逻辑，输入 Uint8Array 样本，输出结论。
 * 顺序：BOM → 严格 UTF-8 → GB18030 评分 → UTF-16 NUL 分布 → 兜底
 *
 * 为什么必须自己判断：
 *   TXT 无元数据，且大陆网文历史上大量 GBK/GB18030 文件，
 *   一旦判错就是整本乱码。宁可慢一点也要判准，并随时允许手动重选。
 */

export type DetectedEncoding = 'utf-8' | 'gb18030' | 'big5' | 'utf-16le' | 'utf-16be';

export interface DetectResult {
  encoding: DetectedEncoding;
  /** 0–1，低于 0.5 时 UI 应给出「疑似乱码？可手动切换」入口 */
  confidence: number;
  hadBom: boolean;
  sample: string;
}

const CANDIDATES: DetectedEncoding[] = ['utf-8', 'gb18030', 'big5'];

function hasBomHead(bytes: Uint8Array, bom: number[]): boolean {
  return bom.every((b, i) => bytes[i] === b);
}

/** 严格解码，返回 null 表示不是该编码 */
function strictDecode(bytes: Uint8Array, enc: string): string | null {
  try {
    return new TextDecoder(enc, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 给候选编码打分：中文可读性 + 无替换符。
 * 核心指标：CJK 占比、常见标点占比、U+FFFD 数量。
 */
function scoreChinese(text: string): number {
  let cjk = 0;
  let punct = 0;
  let replacement = 0;
  let ctrl = 0;
  let total = 0;

  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    total++;
    if (cp === 0xfffd) {
      replacement++;
      continue;
    }
    if (cp < 0x20 && cp !== 0x0a && cp !== 0x0d && cp !== 0x09) ctrl++;
    else if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x20000 && cp <= 0x2a6df)
    )
      cjk++;
    else if (
      (cp >= 0x3000 && cp <= 0x303f) ||
      (cp >= 0xff01 && cp <= 0xff65) ||
      '，。！？；：、“”‘’（）《》【】'.includes(ch)
    )
      punct++;
  }

  if (total === 0) return 0;

  const cjkRatio = cjk / total;
  const replacementRatio = replacement / total;
  const ctrlRatio = ctrl / total;
  const punctRatio = punct / total;

  // 中文正文：cjk 通常 0.35–0.85；替换符必须为 0；控制字符几乎为 0
  let score = Math.min(cjkRatio / 0.35, 1);
  score += punctRatio > 0 ? Math.min(punctRatio * 4, 0.3) : 0;
  score -= replacementRatio * 20;
  score -= ctrlRatio * 8;
  if (replacement > 0) score *= 0.15;
  return Math.max(0, Math.min(1, score));
}

/** UTF-16 判别：看 NUL 字节落在奇数位还是偶数位 */
function detectUtf16(bytes: Uint8Array): { encoding: DetectedEncoding; confidence: number } | null {
  const len = Math.min(bytes.length, 4096);
  if (len < 8) return null;
  let evenNull = 0;
  let oddNull = 0;
  for (let i = 0; i + 1 < len; i += 2) {
    if (bytes[i] === 0) evenNull++;
    if (bytes[i + 1] === 0) oddNull++;
  }
  const half = len / 2;
  if (oddNull / half > 0.5 && oddNull > evenNull * 3)
    return { encoding: 'utf-16le', confidence: 0.9 };
  if (evenNull / half > 0.5 && evenNull > oddNull * 3)
    return { encoding: 'utf-16be', confidence: 0.9 };
  return null;
}

export function detectEncoding(sample: Uint8Array): DetectResult {
  // 1) BOM
  if (hasBomHead(sample, [0xef, 0xbb, 0xbf])) {
    return {
      encoding: 'utf-8',
      confidence: 1,
      hadBom: true,
      sample: new TextDecoder('utf-8').decode(sample.subarray(3)),
    };
  }
  if (hasBomHead(sample, [0xff, 0xfe])) {
    return {
      encoding: 'utf-16le',
      confidence: 1,
      hadBom: true,
      sample: new TextDecoder('utf-16le').decode(sample.subarray(2)),
    };
  }
  if (hasBomHead(sample, [0xfe, 0xff])) {
    return {
      encoding: 'utf-16be',
      confidence: 1,
      hadBom: true,
      sample: new TextDecoder('utf-16be').decode(sample.subarray(2)),
    };
  }

  // 2) UTF-16 无 BOM（NUL 分布非常干净时可确定）
  const utf16 = detectUtf16(sample);
  if (utf16 && utf16.confidence >= 0.9) {
    return { ...utf16, hadBom: false, sample: new TextDecoder(utf16.encoding).decode(sample) };
  }

  // 3) 严格 UTF-8
  const utf8 = strictDecode(sample, 'utf-8');
  if (utf8 !== null) {
    const s = scoreChinese(utf8);
    if (s >= 0.5) return { encoding: 'utf-8', confidence: Math.max(0.85, s), hadBom: false, sample: utf8 };
  }

  // 4) 双字节编码候选打分
  let best: { encoding: DetectedEncoding; score: number; text: string } | null = null;
  for (const enc of CANDIDATES) {
    if (enc === 'utf-8') continue;
    let text: string;
    try {
      text = new TextDecoder(enc, { fatal: false }).decode(sample);
    } catch {
      continue;
    }
    const score = scoreChinese(text);
    if (!best || score > best.score) best = { encoding: enc, score, text };
  }

  if (best && best.score > 0.25) {
    return { encoding: best.encoding, confidence: best.score, hadBom: false, sample: best.text };
  }

  // 5) 兜底：英文/空文件按 UTF-8 处理
  const fallback = new TextDecoder('utf-8', { fatal: false }).decode(sample);
  return { encoding: 'utf-8', confidence: 0.3, hadBom: false, sample: fallback };
}

/** 解码时可接受的标签（含 alias），供 TextDecoder 使用 */
export function toDecoderLabel(enc: DetectedEncoding): string {
  switch (enc) {
    case 'utf-16le':
      return 'utf-16le';
    case 'utf-16be':
      return 'utf-16be';
    case 'big5':
      return 'big5';
    case 'gb18030':
      return 'gb18030';
    default:
      return 'utf-8';
  }
}

/**
 * 从文件名识别书名与作者 —— 易笺做得很好的一点，直接影响书架的观感。
 * 支持三种主流命名：
 *   1. 《书名》作者：xxx.txt        / 《书名》.txt
 *   2. 书名.[作者].txt              / 书名(作者).txt / 书名【作者】.txt
 *   3. Book Name by Somebody.txt
 * 另处理：(完结)、(精校版)、[全本]、作者笔名塞一副标题等常见噪声。
 */

export interface MetaGuess {
  title: string;
  author?: string;
}

const NOISE = [
  /(完结|完本|全文结束|已完结|全本|全集|精校|精排版|校订版|修订版|最新版|完整版|未删减|无删减|txt版|电子书|下载|本书由|仅供|请勿传播)/g,
  /\[[^\]]{0,20}(完|结|全|精校)[^\]]{0,20}\]/g,
  /[(（][^)）]{0,20}(完|结|全|精校)[^)）]{0,20}[)）]/g,
];

const SIZE_HINTS = /\b(\d+(\.\d+)?\s*(kb|mb|k|m))\b/i;

export function guessMeta(fileName: string): MetaGuess {
  let raw = fileName.replace(/\.[^.]{1,8}$/, '').trim();
  if (!raw) return { title: fileName || '未命名' };

  let author: string | undefined;

  // 规则 3：英文 "Book Name by Author"
  const byMatch = raw.match(/^(.*?)\s+by\s+([A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+)*)\s*$/iu);
  if (byMatch) {
    raw = byMatch[1].trim();
    author = byMatch[2].trim();
  }

  // 规则 1：《书名》作者：xxx / 《书名》- 作者
  if (!author) {
    const m = raw.match(/[《<【]([^》>】]{1,80})[》>】]\s*(?:[作者著]*\s*[：:]\s*)?([^\s（(]{1,20})?\s*$/);
    if (m) {
      raw = m[1].trim();
      if (m[2]) author = m[2].replace(/^(作者|著|another)$/u, '').trim() || undefined;
    }
  }

  // 规则 2：书名.[作者] / 书名(作者) / 书名【作者】
  if (!author) {
    const m = raw.match(/^(.*?)[.。]\s*[\[［【（(]([^\]］】）)]{1,24})[\]］】）)]\s*$/);
    if (m) {
      raw = m[1].trim();
      author = m[2].trim();
    } else {
      const m2 = raw.match(/^(.*?)[\s]*[[［【（(]([^\]］】）)]{1,24})[\]］】）)]\s*$/);
      if (m2 && !SIZE_HINTS.test(m2[2])) {
        raw = m2[1].trim();
        author = m2[2].trim();
      }
    }
  }

  // 「作者：xxx」写在标题里的常见写法
  const inlineAuthor = raw.match(/[（(\[【]\s*(?:作者|著)\s*[:：]?\s*([^）)\]】]{1,24})\s*[）)\]】]/);
  if (inlineAuthor && !author) {
    author = inlineAuthor[1].trim();
    raw = raw.replace(inlineAuthor[0], '').trim();
  }

  for (const pat of NOISE) raw = raw.replace(pat, '');
  raw = raw.replace(/[_~]/g, ' ').replace(/\s{2,}/g, ' ').replace(/[—–-]{2,}/g, '—').trim();
  raw = raw.replace(/^[（(\[【]|[）)\]】]$/g, '').trim();

  if (author) {
    author = author.replace(/^(作者|著|another)\s*[:：]?\s*/u, '').trim();
    if (author.length > 24 || SIZE_HINTS.test(author)) author = undefined;
  }

  return { title: raw || fileName, author: author || undefined };
}

/** 猜测阅读语言（用于少量 UI 文案），只统计样例即可 */
export function guessLang(sample: string): 'zh' | 'en' | 'other' {
  let han = 0;
  let latin = 0;
  const limit = Math.min(sample.length, 2000);
  for (let i = 0; i < limit; i++) {
    const cp = sample.codePointAt(i) ?? 0;
    if (cp >= 0x4e00 && cp <= 0x9fff) han++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
  }
  if (han > latin * 1.5) return 'zh';
  if (latin > han * 1.5) return 'en';
  return 'other';
}

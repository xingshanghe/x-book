/**
 * 脚注：①–㊿ 引用与行首注释配对（吸收自易笺）。
 *
 * 约定（大陆 TXT 电子书的事实标准）：
 *   · 正文里出现 ①②…⑳ 等带圈数字，表示「这里有条注释」；
 *   · 对应的解释通常以同一个带圈数字**行首**出现，集中在章末或书末。
 * 我们不猜测配对位置，只收集定义行；渲染时引用处上标可点，点开看定义。
 */

/** U+2460 (1) – U+2473 (20)、U+3251–U+325F (21–35)、U+32B1–U+32BF (36–50) */
export const FOOTNOTE_CHARS = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿';

const DEF_RE = new RegExp(`^\\s*([${FOOTNOTE_CHARS}])\\s*(.{2,400})$`);

export function isFootnoteDef(line: string): boolean {
  return DEF_RE.test(line);
}

export function parseFootnoteDef(line: string): { marker: string; text: string } | null {
  const m = line.match(DEF_RE);
  if (!m) return null;
  return { marker: m[1], text: m[2].trim() };
}

/** 在正文段落里找引用标记的位置（用于渲染上标） */
export function findRefs(text: string): { marker: string; start: number }[] {
  const out: { marker: string; start: number }[] = [];
  const re = new RegExp(`[${FOOTNOTE_CHARS}]`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ marker: m[0], start: m.index });
  }
  return out;
}

/** 渲染层用：把段落文本按引用切开，输出 [{text, ref?}] 片段序列 */
export function splitByRefs(text: string): { text: string; ref?: string }[] {
  const refs = findRefs(text);
  if (refs.length === 0) return [{ text }];
  const out: { text: string; ref?: string }[] = [];
  let cursor = 0;
  for (const r of refs) {
    if (r.start > cursor) out.push({ text: text.slice(cursor, r.start) });
    out.push({ text: r.marker, ref: r.marker });
    cursor = r.start + r.marker.length;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

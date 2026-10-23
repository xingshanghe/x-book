/**
 * 注释。
 *
 * 易笺的做法是：正文里的注号收成小标记，移上去在标记旁边弹出注释，
 * 定义行从正文流里拿掉。这里保留章末注释列表（古籍本来就印在章末），
 * 但同样把正文里的注号收成可点的上标，点开贴在标记旁边。
 *
 * 两种标记：
 *   · 带圈数字 ①–㊿（易笺的原文约定，一段里可以重新从 ① 起）
 *   · 方括号序号 [22]、［22］、【22】、〔22〕（评点本、三国一类最常见）
 * 定义行以同一个标记起头。`* * *` 单独成行时是注释区的界线。
 */

/** U+2460 (1) – U+2473 (20)、U+3251–U+325F (21–35)、U+32B1–U+32BF (36–50) */
export const FOOTNOTE_CHARS =
  '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟㊱㊲㊳㊴㊵㊶㊷㊸㊹㊺㊻㊼㊽㊾㊿';

const CIRCLED = `[${FOOTNOTE_CHARS}]`;
const BRACKET = String.raw`(?:\[(\d{1,3})\]|［(\d{1,3})］|【(\d{1,3})】|〔(\d{1,3})〕)`;
const DEF_RE = new RegExp(String.raw`^\s*(?:${BRACKET}|(` + CIRCLED + String.raw`))\s*(.{2,800})$`);
const REF_RE = new RegExp(String.raw`${BRACKET}|${CIRCLED}`, 'g');
const DIVIDER_RE = /^(?:\*\s*){3,}$|^※{1,5}$|^[—－─]{3,}$/;

export interface NoteDef {
  marker: string;
  text: string;
}

export interface CollectedNote {
  text: string;
  char?: number;
}

export function isNoteDivider(line: string): boolean {
  return DIVIDER_RE.test(line.trim());
}

export function isFootnoteDef(line: string): boolean {
  return DEF_RE.test(line.trim());
}

export function parseFootnoteDef(line: string): NoteDef | null {
  const matched = line.trim().match(DEF_RE);
  if (!matched) return null;
  const marker = matched[1] || matched[2] || matched[3] || matched[4] || matched[5];
  const text = matched[6]?.trim();
  if (!marker || !text) return null;
  return { marker, text };
}

export function noteLabel(marker: string): string {
  return /^\d+$/.test(marker) ? `[${marker}]` : marker;
}

export function collectNotes(
  lines: readonly { text: string; char?: number }[],
): Map<string, CollectedNote> {
  const notes = new Map<string, CollectedNote>();
  for (const line of lines) {
    const def = parseFootnoteDef(line.text);
    if (!def) continue;
    notes.set(def.marker, { text: def.text, char: line.char });
  }
  return notes;
}

/** 在正文段落里找引用标记的位置（用于渲染上标） */
export function findRefs(text: string): { marker: string; start: number; raw: string }[] {
  const out: { marker: string; start: number; raw: string }[] = [];
  const re = new RegExp(REF_RE.source, 'g');
  let matched: RegExpExecArray | null;
  while ((matched = re.exec(text)) !== null) {
    const marker = matched[1] || matched[2] || matched[3] || matched[4] || matched[0];
    out.push({ marker, start: matched.index, raw: matched[0] });
  }
  return out;
}

/** 渲染层用：把段落文本按引用切开，输出 [{text, ref?}] 片段序列 */
export function splitByRefs(text: string): { text: string; ref?: string }[] {
  const refs = findRefs(text);
  if (refs.length === 0) return [{ text }];
  const out: { text: string; ref?: string }[] = [];
  let cursor = 0;
  for (const ref of refs) {
    if (ref.start > cursor) out.push({ text: text.slice(cursor, ref.start) });
    out.push({ text: ref.raw, ref: ref.marker });
    cursor = ref.start + ref.raw.length;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor) });
  return out;
}

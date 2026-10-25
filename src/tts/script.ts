/**
 * 从书籍块里取出即将朗读的句子。一次只拿一小段，读到临近末尾再往下取。
 */

import { isPageBreakLine } from '@/core/parser/reformat';
import { locateCharOffset } from '@/core/parser/scanner';
import type { BlockIndexView } from '@/core/reader/progress';
import { trimLeadingSpaces } from '@/core/text/sanitize';
import { sentenceSpans } from '@/core/text/sentences';

/** 点下开始时先读这么多块，好尽快出声。 */
export const FIRST_WINDOW_BLOCKS = 2;
/** 后面每次补这么多块，读完一块不会自己停。 */
export const NEXT_WINDOW_BLOCKS = 4;

export interface SpokenLine {
  text: string;
  char: number;
}

export interface SpokenSentence {
  text: string;
  charOffset: number;
  /** 这一句是所在段落的最后一句，段末停顿比句间长一点。 */
  paragraphEnd: boolean;
}

export interface SpokenWindow {
  sentences: SpokenSentence[];
  /** 下一次该从这里接着取。null 表示这本书读完了。 */
  nextChar: number | null;
}

/**
 * 从带字符偏移的行里取出 fromChar 所在的那一句，以及它后面的句子。
 * fromChar 落在句中时，仍从这一句的开头读。
 */
export function sentencesFromLines(
  lines: readonly SpokenLine[],
  fromChar: number,
): SpokenSentence[] {
  const out: SpokenSentence[] = [];
  let started = false;
  for (const line of lines) {
    if (!line.text.trim()) continue;
    const batch: SpokenSentence[] = [];
    for (const span of sentenceSpans(line.text)) {
      const charOffset = line.char + span.start;
      const end = charOffset + Array.from(span.text).length;
      if (!started) {
        if (end <= fromChar) continue;
        started = true;
      }
      batch.push({ text: span.text, charOffset, paragraphEnd: false });
    }
    const marked = batch.map((item, index) =>
      index === batch.length - 1 ? { ...item, paragraphEnd: true } : item,
    );
    out.push(...marked);
  }
  return out;
}

/** 读 fromChar 起的若干块。空白块留给调用方继续往后跳。 */
export async function loadSpokenWindow(
  readLines: (block: number) => Promise<string[]>,
  idx: BlockIndexView,
  fromChar: number,
  blocks: number,
): Promise<SpokenWindow> {
  if (idx.count <= 0 || blocks <= 0) return { sentences: [], nextChar: null };
  const startBlock = locateCharOffset(idx.charOffsets, idx.charCounts, fromChar).blockIndex;
  const endBlock = Math.min(idx.count, Math.max(0, startBlock) + blocks);
  const lines: SpokenLine[] = [];
  for (let block = Math.max(0, startBlock); block < endBlock; block++) {
    const rawLines = await readLines(block);
    const base = idx.charOffsets[block] ?? 0;
    let acc = 0;
    for (const raw of rawLines) {
      const text = trimLeadingSpaces(raw);
      if (!isPageBreakLine(raw) && text) lines.push({ text, char: base + acc });
      acc += raw.length + 1;
    }
  }
  const nextChar = endBlock >= idx.count ? null : (idx.charOffsets[endBlock] ?? null);
  return { sentences: sentencesFromLines(lines, fromChar), nextChar };
}

/** 跳过空块，直到凑出句子，或确认后面没有了。 */
export async function readSpokenScript(
  readLines: (block: number) => Promise<string[]>,
  idx: BlockIndexView,
  fromChar: number,
  blocks: number,
): Promise<SpokenWindow> {
  let from = fromChar;
  for (let guard = 0; guard < 8; guard++) {
    const window = await loadSpokenWindow(readLines, idx, from, blocks);
    if (window.sentences.length > 0) return window;
    if (window.nextChar == null || window.nextChar <= from) return window;
    from = window.nextChar;
  }
  return { sentences: [], nextChar: null };
}

/**
 * 分页阅读的取文逻辑。
 *
 * 与滚动模式共用 BlockReader，但只取「当前这一段」：
 *   · 有章节 → 一段 = 一章（一章几千字，DOM 完全扛得住，首屏只解 1~4 块）；
 *   · 无章节 → 一段 = 300 块，翻到边界再换段，避免把整本书塞进 DOM。
 *
 * 分页本身交给 CSS 多列（column-fill: auto + 固定列高），
 * 浏览器按真实排版断行，不需要自己算每行几个字，也就不会出现半个字被切掉。
 */

import type { BlockIndexView } from '@/core/reader/progress';
import type { BlockReader } from '@/core/reader/blockReader';
import type { Chapter } from '@/types/models';
import { trimLeadingSpaces } from '@/core/text/sanitize';

/** 无章节书按块切段的粒度 */
export const SEGMENT_BLOCKS = 300;

export interface FlowLine {
  /** 该行首个字符的全书偏移 */
  char: number;
  text: string;
  block: number;
}

export interface Segment {
  startBlock: number;
  endBlock: number;
  startChar: number;
  endChar: number;
  /** 章节标题：一块 16KB 可能大半是上一章的尾巴，靠标题把开头对齐 */
  startTitle?: string;
  endTitle?: string;
}

export function blockAtCharOffset(idx: BlockIndexView, charOffset: number): number {
  let lo = 0;
  let hi = idx.count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((idx.charOffsets[mid] ?? 0) <= charOffset) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

export function totalCharsOf(idx: BlockIndexView): number {
  if (idx.count <= 0) return 0;
  return (idx.charOffsets[idx.count - 1] ?? 0) + (idx.charCounts[idx.count - 1] ?? 0);
}

/**
 * 算出 charOffset 所在的那一段。
 * 章节优先；章节边界比块更贴合阅读习惯（翻到章末就该翻章了）。
 */
export function segmentOf(
  idx: BlockIndexView,
  chapters: Chapter[],
  charOffset: number,
  blockHint?: number,
): Segment {
  const total = totalCharsOf(idx);

  if (chapters.length > 0) {
    // 优先按块号找章：清洗规则会剔除行，chapters.charOffset 与块索引的
    // 字符统计口径不完全一致，直接比 charOffset 越往后偏得越多。
    let ci = 0;
    if (blockHint != null) {
      for (let i = 0; i < chapters.length; i++) {
        if ((chapters[i].blockIndex ?? 0) <= blockHint) ci = i;
        else break;
      }
    } else {
      for (let i = 0; i < chapters.length; i++) {
        if ((chapters[i].charOffset ?? 0) <= charOffset) ci = i;
        else break;
      }
    }
    const cur = chapters[ci];
    const next = chapters[ci + 1];
    const startChar = cur?.charOffset ?? 0;
    const endChar = next?.charOffset ?? total;
    // 块号直接用章节记录里的：它和标题行是索引器同时写下的，
    // 而从 charOffset 反推块号会因清洗行统计差异往前跑好几块。
    const startBlock = Math.min(
      idx.count - 1,
      Math.max(0, cur ? (cur.blockIndex ?? blockAtCharOffset(idx, startChar)) : 0),
    );
    // +1：下一章的标题块里，标题之前还留着本章的尾巴，
    // 不把这块读进来，本章最后一屏就永远翻不到。
    const endBlock = Math.min(
      idx.count,
      Math.max(
        startBlock + 1,
        next ? (next.blockIndex ?? blockAtCharOffset(idx, endChar)) + 1 : idx.count,
      ),
    );
    const titleOf = (c?: Chapter) => (c ? c.shortTitle || c.title : undefined);
    // 单章异常巨大（比如整本被识别成一章）时仍按块切，避免一次性铺十万行
    if (endBlock - startBlock > SEGMENT_BLOCKS) {
      const at = Math.max(0, blockAtCharOffset(idx, charOffset) - startBlock);
      const segStart = startBlock + Math.floor(at / SEGMENT_BLOCKS) * SEGMENT_BLOCKS;
      const segEnd = Math.min(endBlock, segStart + SEGMENT_BLOCKS);
      return {
        startBlock: segStart,
        endBlock: segEnd,
        startChar: idx.charOffsets[segStart] ?? startChar,
        endChar: segEnd >= idx.count ? total : (idx.charOffsets[segEnd] ?? endChar),
        // 只有第一片需要对齐标题
        startTitle: segStart === startBlock ? titleOf(cur) : undefined,
        endTitle: titleOf(next),
      };
    }
    return {
      startBlock,
      endBlock,
      startChar,
      endChar,
      startTitle: titleOf(cur),
      endTitle: titleOf(next),
    };
  }

  const b = blockAtCharOffset(idx, charOffset);
  const segStart = Math.floor(b / SEGMENT_BLOCKS) * SEGMENT_BLOCKS;
  const segEnd = Math.min(idx.count, segStart + SEGMENT_BLOCKS);
  return {
    startBlock: segStart,
    endBlock: segEnd,
    startChar: idx.charOffsets[segStart] ?? 0,
    endChar: segEnd >= idx.count ? total : (idx.charOffsets[segEnd] ?? total),
  };
}

/** 读出该段所有可见行（空行直接丢弃，段距交给 CSS 表达） */
export async function readSegment(
  reader: BlockReader,
  idx: BlockIndexView,
  seg: Segment,
): Promise<FlowLine[]> {
  // 先按标题裁一遍；万一标题被清洗/改写导致裁空了，退回不裁的版本，
  // 宁可多几行上一章的尾巴，也不能给用户一页空白。
  const trimmed = await readOnce(reader, idx, seg, true);
  if (trimmed.length > 0) return trimmed;
  return readOnce(reader, idx, seg, false);
}

async function readOnce(
  reader: BlockReader,
  idx: BlockIndexView,
  seg: Segment,
  useTitles: boolean,
): Promise<FlowLine[]> {
  const out: FlowLine[] = [];
  let started = !useTitles || !seg.startTitle;
  for (let b = seg.startBlock; b < seg.endBlock; b++) {
    const lines = await reader.readLines(b);
    const base = idx.charOffsets[b] ?? 0;
    let acc = 0;
    for (const raw of lines) {
      const t = trimLeadingSpaces(raw);
      if (!started) {
        // 还没到本章标题：这是上一章的尾巴，跳过
        if (t.includes(seg.startTitle as string)) started = true;
        else {
          acc += raw.length + 1;
          continue;
        }
      }
      // 撞上下一章标题就收工（前几行不判，避免正文里引用标题被误杀）
      if (useTitles && seg.endTitle && out.length > 3 && t.includes(seg.endTitle)) return out;
      if (t) out.push({ char: base + acc, text: t, block: b });
      acc += raw.length + 1;
    }
  }
  return started ? out : [];
}

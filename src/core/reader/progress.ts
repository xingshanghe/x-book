/**
 * 进度换算与定位。
 *
 * 四重锚点（精度从高到低）：
 *   charOffset > blockIndex+lineInBlock > percent > pixelOffset
 * 恢复时逐级回退；charOffset 用「可见字符」口径，跨字号/跨设备不漂移。
 */

import type { BlockIndex, Progress } from '@/types/models';
import { locateCharOffset } from '../parser/scanner';

export interface BlockIndexView {
  starts: Uint32Array;
  charCounts: Uint32Array;
  charOffsets: Uint32Array;
  lineCounts: Uint32Array;
  count: number;
}

export function viewOf(idx: BlockIndex): BlockIndexView {
  return {
    starts: idx.starts,
    charCounts: idx.charCounts,
    charOffsets: idx.charOffsets,
    lineCounts: idx.lineCounts,
    count: idx.count,
  };
}

export function percentOf(idx: BlockIndexView, charOffset: number): number {
  const total = idx.charOffsets[idx.count - 1] + idx.charCounts[idx.count - 1];
  if (total <= 0) return 0;
  return Math.min(1, Math.max(0, charOffset / total));
}

export function charOffsetOfPercent(idx: BlockIndexView, percent: number): number {
  const total = idx.charOffsets[idx.count - 1] + idx.charCounts[idx.count - 1];
  return Math.round(Math.min(1, Math.max(0, percent)) * total);
}

export function blockAtChar(idx: BlockIndexView, charOffset: number): number {
  return locateCharOffset(idx.charOffsets, idx.charCounts, charOffset).blockIndex;
}

/** 章节列表 → 某字符偏移所在章号（二分） */
export function chapterAtChar(chapterOffsets: readonly number[], charOffset: number): number {
  let lo = 0;
  let hi = chapterOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (chapterOffsets[mid] <= charOffset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function makeProgress(
  bookId: string,
  idx: BlockIndexView,
  blockIndex: number,
  lineInBlock: number,
  charOffset: number,
  deviceId: string,
): Progress {
  return {
    bookId,
    chapterIndex: 0,
    blockIndex,
    lineInBlock,
    charOffset,
    percent: percentOf(idx, charOffset),
    updatedAt: Date.now(),
    deviceId,
  };
}

/**
 * 依据保存的进度定位：
 *   1. charOffset 在合法范围内 → 按字符定位
 *   2. 否则回退 percent
 *   3. 再不行 → 0
 * 返回 { blockIndex, charTarget }；charTarget 供解码后逐行匹配。
 */
export function resolvePosition(
  idx: BlockIndexView,
  saved: Pick<Progress, 'charOffset' | 'percent' | 'blockIndex'> | null | undefined,
): { blockIndex: number; charTarget: number } {
  const total =
    idx.count > 0 ? idx.charOffsets[idx.count - 1] + idx.charCounts[idx.count - 1] : 0;

  if (saved) {
    if (Number.isFinite(saved.charOffset) && saved.charOffset >= 0 && saved.charOffset <= total) {
      const b = blockAtChar(idx, saved.charOffset);
      return { blockIndex: b, charTarget: saved.charOffset - idx.charOffsets[b] };
    }
    if (Number.isFinite(saved.percent)) {
      const co = charOffsetOfPercent(idx, saved.percent);
      const b = blockAtChar(idx, co);
      return { blockIndex: b, charTarget: co - idx.charOffsets[b] };
    }
  }
  return { blockIndex: 0, charTarget: 0 };
}

/**
 * 自动滚动的速度模型（纯函数，便于单测）。
 *
 * 速度单位用「行/分钟」而不是像素/秒：换字号、换行距之后，
 * 同一个数字仍然是同样的阅读节奏，不会因为版面变大而突然变快。
 */

/** 最慢：3 行/分钟，约 20 秒一行 */
export const AUTO_SCROLL_MIN_LPM = 3;
/** 最快：60 行/分钟，约 1 秒一行 */
export const AUTO_SCROLL_MAX_LPM = 60;
export const AUTO_SCROLL_STEP_LPM = 3;
export const AUTO_SCROLL_DEFAULT_LPM = 12;

/**
 * 把任意输入收进合法档位。非数字（老设置里没有这个字段、手改坏等）
 * 回落到默认值，而不是让滚动循环拿到 NaN 后原地卡死。
 */
export function clampAutoScrollSpeed(lpm: number): number {
  if (!Number.isFinite(lpm)) return AUTO_SCROLL_DEFAULT_LPM;
  const stepped = Math.round(lpm / AUTO_SCROLL_STEP_LPM) * AUTO_SCROLL_STEP_LPM;
  return Math.min(AUTO_SCROLL_MAX_LPM, Math.max(AUTO_SCROLL_MIN_LPM, stepped));
}

/** 加减档，delta 是「几档」而不是「几行」 */
export function bumpAutoScrollSpeed(lpm: number, delta: number): number {
  return clampAutoScrollSpeed(lpm + delta * AUTO_SCROLL_STEP_LPM);
}

/** 行/分钟 → 像素/秒。linePx 为该字号下的一行实际高度。 */
export function autoScrollPxPerSec(lpm: number, linePx: number): number {
  if (!Number.isFinite(linePx) || linePx <= 0) return 0;
  return (clampAutoScrollSpeed(lpm) * linePx) / 60;
}

export interface ScrollBox {
  scrollTop: number;
  clientHeight: number;
  /** 正文高度（不含底部留白），由块高度累加得到。 */
  scrollHeight: number;
}

/**
 * 是否已经滚到正文末尾。
 *
 * 用正文高度而不是容器的 scrollHeight：正文容器底部留了 30vh 的空白，
 * 若按容器算，自动滚动会在空白里再爬半分钟才停。
 */
export function atScrollEnd(box: ScrollBox, tolerance = 4): boolean {
  return box.scrollTop + box.clientHeight >= box.scrollHeight - tolerance;
}

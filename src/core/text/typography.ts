/**
 * 排版辅助：中西混排间距、行首禁则由 CSS line-break:strict 承担，
 * 这里只做浏览器做不了的部分。
 */

const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff\\u3000-\\u303f\\uff00-\\uffef';

/** 汉字与拉丁字母/数字之间加入细空格（text-autospace 的 JS 兜底） */
export function applyAutospace(text: string): string {
  return text
    .replace(new RegExp(`([${CJK}])([A-Za-z0-9@&])`, 'g'), '$1\u2009$2')
    .replace(new RegExp(`([A-Za-z0-9%,.)\\]])([${CJK}])`, 'g'), '$1\u2009$2');
}

/** 依容器尺寸估算每行可容纳的字符数（用于未渲染块的行数预估） */
export function estimateCharsPerLine(widthPx: number, fontSizePx: number, letterSpacingEm: number): number {
  const charW = fontSizePx * (1 + letterSpacingEm);
  return Math.max(4, Math.floor(widthPx / charW));
}

/** 行高像素值 */
export function lineHeightPx(fontSizePx: number, lineHeightRatio: number): number {
  return Math.round(fontSizePx * lineHeightRatio * 100) / 100;
}

/**
 * 翻页模式下每屏行数：视口高度向下取整到整行，
 * 这是「翻页永不切断文字」的数学前提 —— 所有行高一致，
 * 按行高的整数倍位移必然落在行边界上。
 */
export function linesPerPage(viewportPx: number, linePx: number): number {
  return Math.max(1, Math.floor(viewportPx / linePx));
}

/**
 * 渲染前的文本整形：只做「无损」处理，绝不改写句子本身。
 */

/** 段首空白统一交给 CSS text-indent，物理空格在渲染层剥离（原文不变） */
export function trimLeadingSpaces(line: string): string {
  return line.replace(/^[\s　]+/, '');
}

/** 行尾残留 \r（极端情况） */
export function trimTrailingCR(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * 超长单段切分：整本无换行的文件会出现 1MB 的「一段」，
 * 渲染层按句末标点切成 ≤ maxChars 的视觉段，进度锚点不受影响。
 */
export function splitLongParagraph(text: string, maxChars = 900): string[] {
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  const punct = new Set(['。', '！', '？', '…', '”', '』', '」', '！', '?', '!', '.']);
  let start = 0;
  for (let i = maxChars; i < text.length; i += maxChars) {
    let cut = -1;
    for (let j = i; j > i - 220 && j > start; j--) {
      if (punct.has(text[j])) {
        cut = j + 1;
        break;
      }
    }
    if (cut < 0) cut = i;
    out.push(text.slice(start, cut));
    start = cut;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/** 空行折叠：连续 ≥ 2 个空行视为 1 个段落间隔（渲染层用 margin 表达，不留空行 DOM） */
export function collapseBlankLines(lines: string[]): string[] {
  const out: string[] = [];
  let blankRun = 0;
  for (const l of lines) {
    if (l.trim() === '') {
      blankRun++;
      if (blankRun > 1) continue;
      out.push('');
    } else {
      blankRun = 0;
      out.push(l);
    }
  }
  return out;
}

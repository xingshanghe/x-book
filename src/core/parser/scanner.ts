/**
 * 字节级流式扫描器 —— 轻阅的技术核心。
 *
 * 输入：UTF-8 字节块（任意大小、任意次数）
 * 输出：块索引（字节区间 / 可见字符数 / 可见行数）、章节、脚注、被清洗的行
 *
 * 为什么不用解码就能建索引：
 *   UTF-8 的多字节序列后续字节均 ≥ 0x80，而 \n = 0x0A、\r = 0x0D，
 *   因此在字节层找换行永远不会切坏字符，扫描速度接近内存带宽。
 *
 * 字符数按「码点引导字节」计数（<0x80 或 ≥0xC0），与 TextDecoder 的
 * UTF-16 code unit 数不同，但全书口径一致，进度百分比不受影响。
 *
 * 设计约束：不依赖 DOM / React / IndexedDB，可在 Node 与 Worker 中运行。
 */

import { ChapterDetector } from './chapters';
import type { Cleaner } from './cleaner';
import { isFootnoteDef, parseFootnoteDef } from './footnotes';

export const DEFAULT_BLOCK_SIZE = 16 * 1024;

const CR = 0x0d;
const LF = 0x0a;
/** 行缓存上限：超过则放弃解码检测（超长行不可能是标题/广告） */
const LINE_CAP = 320;

export interface ScanOptions {
  blockSize?: number;
  detector?: ChapterDetector;
  cleaner?: Cleaner;
  detectFootnotes?: boolean;
}

export interface ChapterHit {
  index: number;
  title: string;
  level: number;
  blockIndex: number;
  /** 块内物理行号（含被清洗行） */
  lineInBlock: number;
  /** 全书可见字符偏移 */
  charOffset: number;
  byteOffset: number;
}

export interface FootnoteHit {
  marker: string;
  text: string;
  blockIndex: number;
  lineInBlock: number;
  charOffset: number;
}

export interface ScanResult {
  blockSize: number;
  blockCount: number;
  /** 长度 = blockCount + 1，最后元素为总字节数 */
  starts: Uint32Array;
  /** 长度 = blockCount，块内可见字符数 */
  charCounts: Uint32Array;
  /** 长度 = blockCount，块前累计可见字符数（前缀和） */
  charOffsets: Uint32Array;
  /** 长度 = blockCount，块内可见行数 */
  lineCounts: Uint32Array;
  charCount: number;
  lineCount: number;
  byteCount: number;
  chapters: ChapterHit[];
  footnotes: FootnoteHit[];
  /** 被清洗行：块号 → 块内物理行号数组 */
  hidden: Map<number, number[]>;
  cleanedLines: number;
  footnoteCount: number;
}

class GrowableU32 {
  private buf: Uint32Array;
  private _len = 0;

  constructor(cap = 1024) {
    this.buf = new Uint32Array(cap);
  }

  get length(): number {
    return this._len;
  }

  push(v: number): void {
    if (this._len === this.buf.length) this.grow();
    this.buf[this._len++] = v;
  }

  set(i: number, v: number): void {
    this.buf[i] = v;
  }

  get(i: number): number {
    return this.buf[i];
  }

  view(): Uint32Array {
    return this.buf.subarray(0, this._len);
  }

  private grow(): void {
    const next = new Uint32Array(this.buf.length * 2);
    next.set(this.buf);
    this.buf = next;
  }
}

export class StreamIndexer {
  private readonly blockSize: number;
  private readonly detector?: ChapterDetector;
  private readonly cleaner?: Cleaner;
  private readonly detectFootnotes: boolean;

  // 全局游标
  private abs = 0; // 已消费字节数
  private totalChars = 0; // 可见字符累计
  private totalLines = 0;

  // 当前块
  private blockStart = 0;
  private blockChars = 0;
  private blockLinesAll = 0;
  private blockLinesVisible = 0;
  private blockIndex = 0;

  // 当前行
  private lineStart = 0;
  private lineChars = 0;
  private lineBytes = new Uint8Array(LINE_CAP);
  private lineLen = 0;
  private lineOverflow = false;
  private justCR = false;

  private starts = new GrowableU32(4096);
  private charCounts = new GrowableU32(4096);
  private charOffsets = new GrowableU32(4096);
  private lineCounts = new GrowableU32(4096);

  private chapters: ChapterHit[] = [];
  private footnotes: FootnoteHit[] = [];
  private hidden = new Map<number, number[]>();
  private cleanedLines = 0;

  private decoder = new TextDecoder('utf-8');

  constructor(opts: ScanOptions = {}) {
    this.blockSize = opts.blockSize ?? DEFAULT_BLOCK_SIZE;
    this.detector = opts.detector;
    this.cleaner = opts.cleaner;
    this.detectFootnotes = opts.detectFootnotes ?? true;
  }

  /** 输入一段 UTF-8 字节；可分任意多次调用 */
  push(chunk: Uint8Array): void {
    const n = chunk.length;
    for (let i = 0; i < n; i++) {
      const b = chunk[i];

      if (this.justCR && b === LF) {
        this.justCR = false;
        continue; // \r\n 的后半，归属上一行
      }

      if (b === LF) {
        this.justCR = false;
        this.appendByte(b);
        this.closeLine(this.abs + i + 1);
        continue;
      }

      if (b === CR) {
        this.justCR = true;
        this.appendByte(b);
        this.closeLine(this.abs + i + 1);
        continue;
      }

      this.justCR = false;
      this.appendByte(b);
    }
    this.abs += n;
  }

  /** 文件读完时调用：处理无换行符的最后一行 */
  finish(): ScanResult {
    if (this.lineLen > 0 || this.lineChars > 0) this.closeLine(this.abs);
    if (this.blockLinesAll > 0 || this.blockChars > 0) this.closeBlock();
    if (this.charCounts.length === 0) {
      // 空文件：仍然生成一个空块，避免下游除零
      this.starts.push(0);
      this.charCounts.push(0);
      this.lineCounts.push(0);
      this.charOffsets.push(0);
    }
    // 收尾哨兵：starts 长度恒为 blockCount + 1，
    // 下游一律用 starts[i + 1] - starts[i] 取第 i 块的字节数。
    this.starts.push(this.abs);

    return {
      blockSize: this.blockSize,
      blockCount: this.charCounts.length,
      starts: this.starts.view(),
      charCounts: this.charCounts.view(),
      charOffsets: this.charOffsets.view(),
      lineCounts: this.lineCounts.view(),
      charCount: this.totalChars,
      lineCount: this.totalLines,
      byteCount: this.abs,
      chapters: this.chapters,
      footnotes: this.footnotes,
      hidden: this.hidden,
      cleanedLines: this.cleanedLines,
      footnoteCount: this.footnotes.length,
    };
  }

  private appendByte(b: number): void {
    this.lineChars += b < 0x80 || b >= 0xc0 ? 1 : 0;
    if (!this.lineOverflow) {
      if (this.lineLen < LINE_CAP) {
        this.lineBytes[this.lineLen++] = b;
      } else {
        this.lineOverflow = true;
      }
    }
  }

  private closeLine(lineEndAbs: number): void {
    const isFirstByte = this.lineLen > 0 ? this.lineBytes[0] : -1;
    let text: string | null = null;

    if (!this.lineOverflow && ChapterDetector.worthDecoding(isFirstByte, this.lineChars, this.lineLen)) {
      text = this.decoder.decode(this.lineBytes.subarray(0, this.lineLen));
    }

    // 1) 清洗：命中则整行隐藏，不计入可见字符/行
    const hit = text !== null && this.cleaner ? this.cleaner.test(text) : null;
    if (hit) {
      const list = this.hidden.get(this.blockIndex);
      if (list) list.push(this.blockLinesAll);
      else this.hidden.set(this.blockIndex, [this.blockLinesAll]);
      this.cleanedLines++;
      this.resetLine(lineEndAbs);
      return;
    }

    // 2) 脚注定义行：以 ①–㊿ 或 [n] 开头
    if (this.detectFootnotes && text !== null && isFootnoteDef(text) && this.lineChars > 2) {
      const def = parseFootnoteDef(text);
      if (def) {
        this.footnotes.push({
          marker: def.marker,
          text: def.text,
          blockIndex: this.blockIndex,
          lineInBlock: this.blockLinesAll,
          charOffset: this.totalChars,
        });
      }
    }

    // 3) 章节识别
    if (text !== null && this.detector) {
      const m = this.detector.test(text);
      if (m) {
        this.chapters.push({
          index: this.chapters.length,
          title: m.title,
          level: m.level,
          blockIndex: this.blockIndex,
          lineInBlock: this.blockLinesAll,
          charOffset: this.totalChars,
          byteOffset: this.lineStart,
        });
      }
    }

    // 4) 计入可见统计
    this.blockChars += this.lineChars;
    this.totalChars += this.lineChars;
    this.blockLinesVisible++;
    this.blockLinesAll++;
    this.totalLines++;

    this.resetLine(lineEndAbs);
  }

  private resetLine(lineEndAbs: number): void {
    this.lineStart = lineEndAbs;
    this.lineChars = 0;
    this.lineLen = 0;
    this.lineOverflow = false;

    // 5) 块收口：仅在行边界切，保证任意块可独立解码
    if (lineEndAbs - this.blockStart >= this.blockSize) this.closeBlock();
  }

  private closeBlock(): void {
    const end = this.lineStart; // 下一行起点 = 本块终点
    this.starts.push(this.blockStart);
    this.charCounts.push(this.blockChars);
    this.lineCounts.push(this.blockLinesVisible);
    this.charOffsets.push(this.totalChars - this.blockChars);

    this.blockIndex++;
    this.blockStart = end;
    this.blockChars = 0;
    this.blockLinesAll = 0;
    this.blockLinesVisible = 0;
  }
}

/** 二分：charOffset 落在哪个块（返回块号与块内可见字符偏移） */
export function locateCharOffset(
  charOffsets: Uint32Array,
  _charCounts: Uint32Array,
  target: number,
): { blockIndex: number; charInBlock: number } {
  let lo = 0;
  let hi = charOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (charOffsets[mid] <= target) lo = mid;
    else hi = mid - 1;
  }
  return { blockIndex: lo, charInBlock: Math.max(0, target - charOffsets[lo]) };
}

/**
 * 导入流水线编排（在 Web Worker 中运行）：
 *
 *   File/Blob → 采样检测编码 → [非 UTF-8: 流式转码] → 字节扫描建块索引
 *             → 章节识别 → 脚注配对 → 广告清洗 → 归一化 UTF-8 Blob
 *
 * 性能预算（M1 / iPhone12 基准）：100MB UTF-8 全程 < 2.5s
 * 每处理 ~4MB 上报一次进度；UTF-8 走快路径，不复制文件。
 */

import { BlobAccumulator, Transcoder, normalizeNewlines } from '../encoding/normalize';
import { detectEncoding, toDecoderLabel, type DetectedEncoding } from '../encoding/detect';
import { ChapterDetector, learnPatterns } from './chapters';
import { Cleaner, mergeRules } from './cleaner';
import { StreamIndexer, type ScanResult } from './scanner';
import { guessMeta, guessLang } from './meta';
import type { CleanRule } from '@/types/models';

export const LEARN_SAMPLE_BYTES = 512 * 1024;

export interface IndexOptions {
  fileName: string;
  blockSize?: number;
  detectChapters?: boolean;
  customChapterPattern?: string;
  cleanAds?: boolean;
  cleanRules?: CleanRule[];
  detectFootnotes?: boolean;
  /** 手动指定编码（跳过检测） */
  forceEncoding?: DetectedEncoding;
  onProgress?: (ratio: number, phase: 'detect' | 'scan') => void;
}

export interface IndexOutcome {
  normalized: Blob;
  scan: ScanResult;
  encoding: DetectedEncoding;
  encodingConfidence: number;
  hadBom: boolean;
  title: string;
  author?: string;
  lang: 'zh' | 'en' | 'other';
  learnedPatterns: string[];
  fingerprint: string;
}

/** 稳定指纹：文件大小 + 前 64KB 的 FNV-1a（同书去重） */
export function fingerprint(size: number, head: Uint8Array): string {
  let h = 0x811c9dc5;
  const n = Math.min(head.length, 64 * 1024);
  for (let i = 0; i < n; i++) {
    h ^= head[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${size.toString(36)}-${h.toString(36)}`;
}

async function readSlice(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  const buf = await blob.slice(start, end).arrayBuffer();
  return new Uint8Array(buf);
}

export async function indexBook(file: Blob, opts: IndexOptions): Promise<IndexOutcome> {
  const total = file.size;
  const onProgress = opts.onProgress ?? (() => {});

  // ── 1. 采样检测编码 ────────────────────────────────────────────
  const headSample = await readSlice(file, 0, Math.min(total, 256 * 1024));
  const det = opts.forceEncoding
    ? {
        encoding: opts.forceEncoding,
        confidence: 1,
        hadBom: false,
        sample: new TextDecoder(toDecoderLabel(opts.forceEncoding), { fatal: false }).decode(
          headSample,
        ),
      }
    : detectEncoding(headSample);
  onProgress(0.02, 'detect');

  const fp = fingerprint(total, headSample);
  const meta = guessMeta(opts.fileName);
  const lang = guessLang(det.sample);

  // ── 2. 用文件头部学习章节模板 ────────────────────────────────
  let learned: string[] = [];
  if (opts.detectChapters !== false) {
    const learnSampleBytes = await readSlice(file, 0, Math.min(total, LEARN_SAMPLE_BYTES));
    const learnText =
      det.encoding === 'utf-8'
        ? new TextDecoder('utf-8', { fatal: false }).decode(learnSampleBytes)
        : new TextDecoder(toDecoderLabel(det.encoding), { fatal: false }).decode(learnSampleBytes);
    learned = learnPatterns(normalizeNewlines(learnText));
  }

  const detector = opts.detectChapters === false ? undefined : new ChapterDetector({ learned, custom: opts.customChapterPattern });
  const cleaner = new Cleaner(mergeRules(opts.cleanRules), opts.cleanAds !== false);
  const indexer = new StreamIndexer({
    blockSize: opts.blockSize,
    detector,
    cleaner,
    detectFootnotes: opts.detectFootnotes !== false,
  });

  // ── 3. 流式扫描 ───────────────────────────────────────────────
  const accumulator = new BlobAccumulator();
  const needsTranscode = det.encoding !== 'utf-8';
  const transcoder = needsTranscode ? new Transcoder(toDecoderLabel(det.encoding)) : null;

  let lastReport = 0;
  let pending: Uint8Array | null = null; // 跨块残留（\r\n 拆开的情况）

  const feed = (chunk: Uint8Array) => {
    if (pending) {
      const merged = new Uint8Array(pending.length + chunk.length);
      merged.set(pending);
      merged.set(chunk, pending.length);
      pending = null;
      indexer.push(subarraySkipCR(merged));
      return;
    }
    indexer.push(subarraySkipCR(chunk));
  };

  // 读到块尾的 \r 时需要看下一个字节才能定夺，此处统一延迟一个字节
  function subarraySkipCR(chunk: Uint8Array): Uint8Array {
    if (chunk.length > 0 && chunk[chunk.length - 1] === 0x0d) {
      pending = chunk.subarray(chunk.length - 1);
      return chunk.subarray(0, chunk.length - 1);
    }
    return chunk;
  }

  let offset = 0;
  const reader = file.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const bytes: Uint8Array = value;

    if (needsTranscode && transcoder) {
      for (const out of transcoder.write(bytes)) {
        feed(out);
        accumulator.push(out);
      }
    } else {
      feed(bytes);
      accumulator.push(bytes);
    }

    offset += bytes.byteLength;
    const now = performance.now();
    if (now - lastReport > 120) {
      lastReport = now;
      onProgress(Math.min(0.98, 0.05 + (offset / total) * 0.92), 'scan');
      // 让出主循环，保证 Worker 消息畅通
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (needsTranscode && transcoder) {
    for (const out of transcoder.flush()) {
      feed(out);
      accumulator.push(out);
    }
  } else if (pending) {
    // 文件以 \r 结尾：补一个 \n，保持「行终止符」语义完整
    const tail = new Uint8Array([0x0a]);
    indexer.push(tail);
    accumulator.push(tail);
    pending = null;
  }

  // ── 4. 收尾 ──────────────────────────────────────────────────
  const scan = indexer.finish();
  onProgress(1, 'scan');

  return {
    normalized: needsTranscode ? accumulator.result() : file,
    scan,
    encoding: det.encoding,
    encodingConfidence: det.confidence,
    hadBom: det.hadBom,
    title: meta.title,
    author: meta.author,
    lang,
    learnedPatterns: learned,
    fingerprint: fp,
  };
}

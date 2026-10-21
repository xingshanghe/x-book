/**
 * 转码与换行归一化。
 *
 * 关键不变量：进入索引扫描器的字节流必须是 UTF-8。
 * UTF-8 中多字节序列的每个后续字节都 ≥ 0x80，而 \n 是 0x0A，
 * 所以在字节层扫描换行永远不会切坏字符 —— 这是「不用解码就能建索引」的前提。
 */

const LF = 0x0a;

/** \r\n / \r → \n，同时剔掉 BOM 与常见的零宽/控制字符 */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/[​-‏﻿]/g, '');
}

/**
 * 流式转码器：非 UTF-8 → UTF-8 字节块。
 * 每次 write 输出 0..n 个 Uint8Array，避免一次性持有整本书的字符串。
 */
export class Transcoder {
  private decoder: TextDecoder;
  private encoder = new TextEncoder();
  /** 跨块残留的 \r：行尾 \r 可能正好落在两个块的边界上 */
  private pendingCR = false;

  constructor(label: string) {
    this.decoder = new TextDecoder(label, { fatal: false, ignoreBOM: true });
  }

  write(chunk: Uint8Array): Uint8Array[] {
    const text = this.decoder.decode(chunk, { stream: true });
    return this.encodeNormalized(text);
  }

  /** 收尾：flush decoder，处理末尾残留的 \r */
  flush(): Uint8Array[] {
    const tail = this.decoder.decode();
    const out = this.encodeNormalized(tail);
    if (this.pendingCR) {
      out.push(new Uint8Array([LF]));
      this.pendingCR = false;
    }
    return out;
  }

  private encodeNormalized(text: string): Uint8Array[] {
    if (!text) return [];
    let s = normalizeNewlines(text);
    if (this.pendingCR) {
      s = s.startsWith('\n') ? s.slice(1) : `\n${s}`;
      this.pendingCR = false;
    }
    if (s.endsWith('\r')) {
      this.pendingCR = true;
      s = s.slice(0, -1);
    }
    // 最后一字节是 \r 的情况已在上一步处理；此处的 \r 全部是行内残留，直接丢弃
    s = s.replace(/\r/g, '');
    return s ? [this.encoder.encode(s)] : [];
  }
}

/** 把若干字节块合成 Blob，控制同时持有的块数量，峰值内存≈文件大小一份（非两份） */
export class BlobAccumulator {
  private parts: BlobPart[] = [];
  private tail: Uint8Array[] = [];
  private tailBytes = 0;
  private readonly threshold: number;

  constructor(threshold = 8 * 1024 * 1024) {
    this.threshold = threshold;
  }

  push(chunk: Uint8Array): void {
    this.tail.push(chunk);
    this.tailBytes += chunk.byteLength;
    if (this.tailBytes >= this.threshold) this.compact();
  }

  private compact(): void {
    if (this.tail.length === 0) return;
    this.parts.push(new Blob(this.tail as unknown as BlobPart[]));
    this.tail = [];
    this.tailBytes = 0;
  }

  result(): Blob {
    this.compact();
    return new Blob(this.parts, { type: 'text/plain;charset=utf-8' });
  }
}

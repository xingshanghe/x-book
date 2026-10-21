/// <reference lib="webworker" />
/**
 * 索引 Worker：解析全程不碰主线程。
 * 消息协议见 client.ts。
 */

import { indexBook } from '../parser/indexer';
import type { CleanRule } from '@/types/models';

export interface IndexRequest {
  type: 'index';
  id: string;
  file: Blob;
  fileName: string;
  blockSize?: number;
  detectChapters?: boolean;
  customChapterPattern?: string;
  cleanAds?: boolean;
  cleanRules?: CleanRule[];
  detectFootnotes?: boolean;
  forceEncoding?: 'utf-8' | 'gb18030' | 'big5' | 'utf-16le' | 'utf-16be';
}

export type WorkerRequest = IndexRequest | { type: 'cancel'; id: string };

export interface WorkerProgress {
  type: 'progress';
  id: string;
  ratio: number;
  phase: 'detect' | 'scan';
}

export interface WorkerDone {
  type: 'done';
  id: string;
  /** 其余字段与 IndexOutcome 一致（scan 里的 typed array 可直接结构化克隆） */
  payload: Awaited<ReturnType<typeof indexBook>>;
}

export interface WorkerError {
  type: 'error';
  id: string;
  message: string;
}

export type WorkerResponse = WorkerProgress | WorkerDone | WorkerError;

const cancelled = new Set<string>();

self.addEventListener('message', async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;

  if (msg.type === 'cancel') {
    cancelled.add(msg.id);
    return;
  }

  if (msg.type !== 'index') return;
  const { id } = msg;
  cancelled.delete(id);

  try {
    const result = await indexBook(msg.file, {
      fileName: msg.fileName,
      blockSize: msg.blockSize,
      detectChapters: msg.detectChapters,
      customChapterPattern: msg.customChapterPattern,
      cleanAds: msg.cleanAds,
      cleanRules: msg.cleanRules,
      detectFootnotes: msg.detectFootnotes,
      forceEncoding: msg.forceEncoding,
      onProgress: (ratio, phase) => {
        if (cancelled.has(id)) throw new DOMException('cancelled', 'AbortError');
        const reply: WorkerProgress = { type: 'progress', id, ratio, phase };
        (self as unknown as Worker).postMessage(reply);
      },
    });
    if (cancelled.has(id)) return;
    const reply: WorkerDone = { type: 'done', id, payload: result };
    (self as unknown as Worker).postMessage(reply);
  } catch (err) {
    if (cancelled.has(id)) return;
    const reply: WorkerError = {
      type: 'error',
      id,
      message: err instanceof Error ? err.message : String(err),
    };
    (self as unknown as Worker).postMessage(reply);
  } finally {
    cancelled.delete(id);
  }
});

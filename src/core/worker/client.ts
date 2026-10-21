/**
 * Worker 客户端：把并发请求封装成 Promise，主线程只等结果。
 *
 * 降级：某些 WebView（如部分定制内核、file:// 协议）禁止 Worker/Web Worker 跨域加载。
 * 一旦 Worker 不可用，直接退化为「主线程解析」——慢一点，但功能完全一致，
 * 进度上报机制不变。这是「渐进增强」在端侧的最后一层保障。
 */

import type {
  WorkerDone,
  WorkerError,
  WorkerProgress,
  WorkerRequest,
  WorkerResponse,
} from './indexer.worker';
import type { IndexOutcome } from '../parser/indexer';

type Handlers = {
  onProgress?: (p: WorkerProgress) => void;
};

let shared: Worker | null = null;
let workerBroken = false;

function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (shared) return shared;
  try {
    shared = new Worker(new URL('./indexer.worker.ts', import.meta.url), { type: 'module' });
    return shared;
  } catch {
    workerBroken = true;
    return null;
  }
}

export function terminateIndexer(): void {
  shared?.terminate();
  shared = null;
}

export function runIndex(
  req: Extract<WorkerRequest, { type: 'index' }>,
  handlers: Handlers = {},
): { promise: Promise<IndexOutcome>; cancel: () => void } {
  const worker = ensureWorker();
  if (!worker) return runOnMainThread(req, handlers);

  let settled = false;
  let onProgress: ((p: WorkerProgress) => void) | undefined = handlers.onProgress;

  const promise = new Promise<IndexOutcome>((resolve, reject) => {
    const onError = () => {
      workerBroken = true;
      worker.removeEventListener('message', listener);
      worker.removeEventListener('error', onError);
      if (settled) return;
      settled = true;
      // Worker 建立失败：立即改用主线程解析，静默降级
      runOnMainThread(req, handlers).promise.then(resolve, reject);
    };

    const listener = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (!msg || msg.id !== req.id) return;

      if (msg.type === 'progress') {
        onProgress?.(msg);
        return;
      }

      worker.removeEventListener('message', listener);
      worker.removeEventListener('error', onError);
      settled = true;
      if (msg.type === 'done') {
        resolve(msg.payload);
      } else {
        reject(new Error((msg as WorkerError).message || '解析失败'));
      }
    };

    worker.addEventListener('message', listener);
    worker.addEventListener('error', onError, { once: true });
    worker.postMessage(req);
  });

  return {
    promise,
    cancel: () => {
      if (settled) return;
      worker.postMessage({ type: 'cancel', id: req.id } satisfies WorkerRequest);
      onProgress = undefined;
    },
  };
}

/** 主线程降级实现：接口与 Worker 完全一致 */
function runOnMainThread(
  req: Extract<WorkerRequest, { type: 'index' }>,
  handlers: Handlers,
): { promise: Promise<IndexOutcome>; cancel: () => void } {
  const controller = { cancelled: false };
  const promise = import('../parser/indexer').then((mod) =>
    mod.indexBook(req.file, {
      fileName: req.fileName,
      blockSize: req.blockSize,
      detectChapters: req.detectChapters,
      customChapterPattern: req.customChapterPattern,
      cleanAds: req.cleanAds,
      cleanRules: req.cleanRules,
      detectFootnotes: req.detectFootnotes,
      forceEncoding: req.forceEncoding,
      onProgress: (ratio, phase) => {
        if (controller.cancelled) throw new DOMException('cancelled', 'AbortError');
        handlers.onProgress?.({ type: 'progress', id: req.id, ratio, phase });
      },
    }),
  );
  return {
    promise,
    cancel: () => {
      controller.cancelled = true;
    },
  };
}

export type { WorkerDone, WorkerError, WorkerProgress };

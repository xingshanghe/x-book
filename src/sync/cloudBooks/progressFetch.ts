/**
 * 带字节进度的云书架传输。
 * - 浏览器 / 普通移动端 WebView：走 XHR，可拿到真实 upload/download 进度
 * - Tauri / 鸿蒙桥：原生侧边传边报 loaded/total（不再用假阶段进度）
 */

import { hasHarmonyNet } from '@/lib/harmonyNet';
import { isTauri } from '@/lib/platform';
import { cloudFetch } from './nativeFetch';

export type ByteProgress = {
  loaded: number;
  total: number;
  /** 0–1；total 未知时用已收字节估算 */
  ratio: number;
};

export type ProgressCallback = (p: ByteProgress) => void;

export type ProgressFetchOptions = {
  /** 已知总字节：上传=blob.size，下载=meta.size */
  expectedTotal?: number;
};

function canUseXhrProgress(): boolean {
  if (typeof XMLHttpRequest === 'undefined') return false;
  if (isTauri() || hasHarmonyNet()) return false;
  return true;
}

function clampRatio(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function report(
  cb: ProgressCallback | undefined,
  loaded: number,
  total: number,
  ratio: number,
): void {
  cb?.({ loaded, total, ratio: clampRatio(ratio) });
}

/**
 * 浏览器路径：XHR 上传/下载带 progress。
 * 原生桥路径：cloudFetch + 原生真实字节进度。
 */
export async function cloudFetchWithProgress(
  url: string,
  init: RequestInit,
  onProgress?: ProgressCallback,
  options?: ProgressFetchOptions,
): Promise<Response> {
  if (canUseXhrProgress()) {
    return xhrFetch(url, init, onProgress, options?.expectedTotal);
  }
  return bridgedFetch(url, init, onProgress, options?.expectedTotal);
}

async function bridgedFetch(
  url: string,
  init: RequestInit,
  onProgress?: ProgressCallback,
  expectedTotal?: number,
): Promise<Response> {
  const body = init.body;
  const uploadTotal =
    body instanceof Blob
      ? body.size
      : typeof body === 'string'
        ? body.length
        : expectedTotal && expectedTotal > 0
          ? expectedTotal
          : 0;
  const totalHint = expectedTotal && expectedTotal > 0 ? expectedTotal : uploadTotal;
  report(onProgress, 0, totalHint, 0);

  const res = await cloudFetch(url, init, {
    onProgress,
    expectedTotal: totalHint > 0 ? totalHint : undefined,
  });

  const method = (init.method ?? 'GET').toUpperCase();
  if (method === 'PUT' || method === 'POST') {
    report(onProgress, uploadTotal || totalHint, uploadTotal || totalHint, 1);
  }
  // 下载体已在原生侧读完并封进 Response，这里不再二次 blob()，交给 apiGetFile
  return res;
}

function xhrFetch(
  url: string,
  init: RequestInit,
  onProgress?: ProgressCallback,
  expectedTotal?: number,
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open((init.method ?? 'GET').toUpperCase(), url, true);
    xhr.responseType = 'blob';

    const headers = new Headers(init.headers);
    headers.forEach((value, key) => {
      xhr.setRequestHeader(key, value);
    });

    const body = init.body;
    const uploadTotal = body instanceof Blob ? body.size : 0;
    const isUpload = Boolean(body) && (init.method ?? 'GET').toUpperCase() !== 'GET';

    if (isUpload && xhr.upload) {
      xhr.upload.onprogress = (ev) => {
        const total = ev.lengthComputable ? ev.total : uploadTotal;
        const loaded = ev.loaded;
        // 只报真实字节比；留给 meta 的余量由 transfer.ts 缩放
        const ratio = total > 0 ? loaded / total : 0.5;
        report(onProgress, loaded, total, ratio);
      };
    } else {
      xhr.onprogress = (ev) => {
        const total = ev.lengthComputable
          ? ev.total
          : expectedTotal && expectedTotal > 0
            ? expectedTotal
            : 0;
        const loaded = ev.loaded;
        const ratio =
          total > 0 ? loaded / total : Math.min(0.95, 0.1 + loaded / (5 * 1024 * 1024));
        report(onProgress, loaded, total, ratio);
      };
    }

    xhr.onload = () => {
      const blob = xhr.response instanceof Blob ? xhr.response : new Blob();
      const headerLines = xhr.getAllResponseHeaders();
      const resHeaders = new Headers();
      for (const line of headerLines.split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i <= 0) continue;
        resHeaders.append(line.slice(0, i).trim(), line.slice(i + 1).trim());
      }
      report(onProgress, isUpload ? uploadTotal : blob.size, isUpload ? uploadTotal : blob.size, 1);
      resolve(
        new Response(blob, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: resHeaders,
        }),
      );
    };

    xhr.onerror = () => reject(new TypeError('Failed to fetch'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));

    report(onProgress, 0, isUpload ? uploadTotal : expectedTotal || 0, 0);
    xhr.send(body instanceof Blob || typeof body === 'string' ? body : null);
  });
}

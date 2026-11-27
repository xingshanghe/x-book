/**
 * 桌面壳里的云书架请求走本机 curl。
 * 阅读窗口是安全来源，直接 fetch http:// 会被系统拦住，表现就是「Load failed」。
 * 鸿蒙壳同样拦明文 http，走原生 __QY_NET__ 桥。
 */

import { harmonyFetch, hasHarmonyNet, type HarmonyFetchProgress } from '@/lib/harmonyNet';
import { isTauri } from '@/lib/platform';

export type CloudFetchProgress = {
  onProgress?: (p: { loaded: number; total: number; ratio: number }) => void;
  /** 已知总字节：上传=blob.size，下载=meta.size */
  expectedTotal?: number;
};

export async function cloudFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  progress?: CloudFetchProgress,
): Promise<Response> {
  if (hasHarmonyNet()) {
    const harmonyProgress: HarmonyFetchProgress | undefined = progress?.onProgress
      ? { onProgress: progress.onProgress, expectedTotal: progress.expectedTotal }
      : undefined;
    return harmonyFetch(input, init, harmonyProgress);
  }
  if (!isTauri()) return fetch(input, init);
  return tauriCloudFetch(input, init, progress);
}

async function tauriCloudFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  progress?: CloudFetchProgress,
): Promise<Response> {
  const { invoke } = await import('@tauri-apps/api/core');
  const url = requestUrl(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  let bodyBase64: string | null = null;
  let bodySize = 0;
  if (init?.body != null) {
    const bytes = await bodyToBytes(init.body);
    bodySize = bytes.byteLength;
    bodyBase64 = bytesToBase64(bytes);
  }
  const headerMap: Record<string, string> = {};
  headers.forEach((value, key) => {
    headerMap[key] = value;
  });

  const expectedTotal =
    progress?.expectedTotal && progress.expectedTotal > 0
      ? progress.expectedTotal
      : bodySize > 0
        ? bodySize
        : 0;
  const wantProgress = Boolean(progress?.onProgress);
  const progressId = wantProgress
    ? `cloud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    : null;

  let unlisten: (() => void) | undefined;
  if (progressId && progress?.onProgress) {
    const { listen } = await import('@tauri-apps/api/event');
    const onProgress = progress.onProgress;
    unlisten = await listen<{ id: string; loaded: number; total: number }>(
      'cloud-http-progress',
      (event) => {
        if (event.payload.id !== progressId) return;
        const loaded = event.payload.loaded;
        const total = event.payload.total > 0 ? event.payload.total : expectedTotal;
        const ratio = total > 0 ? loaded / total : 0;
        onProgress({ loaded, total, ratio });
      },
    );
  }

  try {
    const result = await invoke<{ status: number; bodyBase64: string; contentType: string }>(
      'cloud_http',
      {
        request: {
          method,
          url,
          bodyBase64,
          headers: headerMap,
          progressId,
          expectedTotal: expectedTotal > 0 ? expectedTotal : null,
        },
      },
    );
    const bytes = base64ToBytes(result.bodyBase64);
    const contentType = result.contentType || 'application/octet-stream';
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    if (progress?.onProgress) {
      const total = bytes.byteLength || expectedTotal;
      progress.onProgress({ loaded: total, total, ratio: 1 });
    }
    return new Response(new Blob([copy], { type: contentType }), {
      status: result.status,
      headers: { 'Content-Type': contentType },
    });
  } finally {
    unlisten?.();
  }
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function bodyToBytes(body: BodyInit): Promise<Uint8Array> {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    throw new Error('云书架不支持 FormData 上传');
  }
  throw new Error('不支持的上传内容');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

export function base64ToBytes(input: string): Uint8Array {
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

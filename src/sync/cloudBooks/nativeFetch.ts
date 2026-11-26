/**
 * 桌面壳里的云书架请求走本机 curl。
 * 阅读窗口是安全来源，直接 fetch http:// 会被系统拦住，表现就是「Load failed」。
 */

import { isTauri } from '@/lib/platform';

export async function cloudFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!isTauri()) return fetch(input, init);
  const { invoke } = await import('@tauri-apps/api/core');
  const url = requestUrl(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  let bodyBase64: string | null = null;
  if (init?.body != null) {
    bodyBase64 = bytesToBase64(await bodyToBytes(init.body));
  }
  const headerMap: Record<string, string> = {};
  headers.forEach((value, key) => {
    headerMap[key] = value;
  });
  const result = await invoke<{ status: number; bodyBase64: string; contentType: string }>(
    'cloud_http',
    {
      request: { method, url, bodyBase64, headers: headerMap },
    },
  );
  const bytes = base64ToBytes(result.bodyBase64);
  const contentType = result.contentType || 'application/octet-stream';
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(new Blob([copy], { type: contentType }), {
    status: result.status,
    headers: { 'Content-Type': contentType },
  });
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

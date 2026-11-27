/** 云书架 HTTP API：Bearer = 账号 accessToken */

import { accountSession } from '@/account/session';
import type { CloudBookMeta } from './catalog';
import { readCloudConfig } from './config';
import { cloudFetch } from './nativeFetch';
import { cloudFetchWithProgress, type ProgressCallback } from './progressFetch';

export class CloudApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CloudApiError';
  }
}

/** 取可用 accessToken；必要时 restore；未登录抛 401 */
export async function ensureAccessToken(): Promise<string> {
  let token = accountSession.client().accessToken();
  if (token) return token;
  if (accountSession.hasStoredSession()) {
    await accountSession.restore();
    token = accountSession.client().accessToken();
  }
  if (!token) throw new CloudApiError('请先登录账号', 401);
  return token;
}

function apiRoot(): string {
  return readCloudConfig().apiBase.replace(/\/+$/, '');
}

async function callJson<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: T } | { ok: false; status: number; message: string }> {
  const token = await ensureAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !(init.body instanceof Blob) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  let res: Response;
  try {
    res = await cloudFetch(`${apiRoot()}${path}`, { ...init, headers });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: netErrorMessage(err),
    };
  }
  // 二进制下载不走这里
  let body: { success?: boolean; message?: string; data?: T };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, status: res.status, message: '云书架服务没有返回结果' };
  }
  if (!res.ok || body.success === false) {
    return {
      ok: false,
      status: res.status,
      message: body.message || `请求失败（${res.status}）`,
    };
  }
  return { ok: true, data: (body.data ?? null) as T };
}

export async function apiListBooks(): Promise<CloudBookMeta[]> {
  const result = await callJson<{ items: CloudBookMeta[] }>('/v1/books/cloud');
  if (!result.ok) {
    if (result.status === 401) throw new CloudApiError(result.message, 401);
    return [];
  }
  return Array.isArray(result.data?.items) ? result.data.items : [];
}

export async function apiProbe(): Promise<{ ok: boolean; reason?: string }> {
  try {
    const token = await ensureAccessToken();
    const res = await cloudFetch(`${apiRoot()}/v1/books/cloud`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) return { ok: false, reason: '请先登录账号' };
    if (!res.ok) {
      try {
        const body = (await res.json()) as { message?: string };
        return { ok: false, reason: body.message || `HTTP ${res.status}` };
      } catch {
        return { ok: false, reason: `HTTP ${res.status}` };
      }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: netErrorMessage(err) };
  }
}

/** WebKit 拦截明文 http 时常见文案是 Load failed，换成可读提示 */
function netErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '');
  const text = raw.trim();
  if (!text) return '网络错误';
  if (/load failed|failed to fetch|networkerror|网络/i.test(text)) {
    return '连不上云书架，请检查网络后重试';
  }
  return text;
}

export async function apiPutFile(
  fingerprint: string,
  blob: Blob,
  contentType: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const token = await ensureAccessToken();
  const res = await cloudFetchWithProgress(
    `${apiRoot()}/v1/books/cloud/${encodeURIComponent(fingerprint)}/file`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': contentType,
      },
      body: blob,
    },
    onProgress,
    { expectedTotal: blob.size },
  );
  if (!res.ok) {
    let message = `上传失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new CloudApiError(message, res.status);
  }
}

export async function apiPutMeta(fingerprint: string, meta: CloudBookMeta): Promise<CloudBookMeta> {
  const result = await callJson<CloudBookMeta>(
    `/v1/books/cloud/${encodeURIComponent(fingerprint)}/meta`,
    {
      method: 'PUT',
      body: JSON.stringify(meta),
    },
  );
  if (!result.ok) throw new CloudApiError(result.message, result.status);
  return result.data;
}

export async function apiGetMeta(fingerprint: string): Promise<CloudBookMeta> {
  const result = await callJson<CloudBookMeta>(
    `/v1/books/cloud/${encodeURIComponent(fingerprint)}/meta`,
  );
  if (!result.ok) throw new CloudApiError(result.message, result.status);
  return result.data;
}

export async function apiGetFile(
  fingerprint: string,
  onProgress?: ProgressCallback,
  expectedTotal?: number,
): Promise<Blob> {
  const token = await ensureAccessToken();
  const res = await cloudFetchWithProgress(
    `${apiRoot()}/v1/books/cloud/${encodeURIComponent(fingerprint)}/file`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    onProgress,
    { expectedTotal: expectedTotal && expectedTotal > 0 ? expectedTotal : undefined },
  );
  if (!res.ok) {
    let message = `下载失败（${res.status}）`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw new CloudApiError(message, res.status);
  }
  const blob = await res.blob();
  onProgress?.({ loaded: blob.size, total: blob.size, ratio: 1 });
  return blob;
}

/** 删除云端书籍（meta + file）；幂等，不存在也算成功 */
export async function apiDeleteBook(fingerprint: string): Promise<void> {
  const result = await callJson<{ ok?: boolean }>(
    `/v1/books/cloud/${encodeURIComponent(fingerprint)}`,
    { method: 'DELETE' },
  );
  if (!result.ok) throw new CloudApiError(result.message, result.status);
}

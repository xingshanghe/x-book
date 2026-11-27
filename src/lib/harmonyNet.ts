/**
 * 鸿蒙壳网络桥：页面跑在 https://local.qingyue，直连明文 http:// 会被 ArkWeb 拦掉
 * （登录/注册 toast「Failed to fetch」）。原生侧注入 window.__QY_NET__.request。
 *
 * 进度：原生 request(..., progressId, expectedTotal) 期间通过
 * window.__QY_NET_PROGRESS__(id, loaded, total) 回调真实字节。
 * 多任务共用一个全局分发器（按 id 路由），避免 finally 互相覆盖。
 */

type HarmonyNetBridge = {
  request(
    method: string,
    url: string,
    headersJson: string,
    bodyBase64: string,
    progressId?: string,
    expectedTotal?: string,
  ): Promise<string> | string;
};

type ProgressHandler = (loaded: number, total: number) => void;

declare global {
  interface Window {
    __QY_NET__?: HarmonyNetBridge;
    __QY_NET_PROGRESS__?: (id: string, loaded: number, total: number) => void;
  }
}

export type HarmonyFetchProgress = {
  onProgress?: (p: { loaded: number; total: number; ratio: number }) => void;
  expectedTotal?: number;
};

const progressHandlers = new Map<string, ProgressHandler>();

function ensureProgressDispatcher(): void {
  if (typeof window === 'undefined') return;
  if (window.__QY_NET_PROGRESS__?.name === 'qyNetProgressDispatch') return;
  const dispatch = function qyNetProgressDispatch(id: string, loaded: number, total: number): void {
    progressHandlers.get(id)?.(loaded, total);
  };
  window.__QY_NET_PROGRESS__ = dispatch;
}

export function hasHarmonyNet(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof window.__QY_NET__?.request === 'function';
}

export async function harmonyFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  progress?: HarmonyFetchProgress,
): Promise<Response> {
  const bridge = typeof window !== 'undefined' ? window.__QY_NET__ : undefined;
  if (!bridge?.request) {
    throw new Error('连不上账号服务');
  }

  const url = requestUrl(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  let bodyBase64 = '';
  let bodySize = 0;
  if (init?.body != null) {
    const bytes = await bodyToBytes(init.body, headers);
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
    ? `hm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    : '';

  if (progressId && progress?.onProgress) {
    ensureProgressDispatcher();
    const onProgress = progress.onProgress;
    progressHandlers.set(progressId, (loaded, total) => {
      const safeTotal = total > 0 ? total : expectedTotal;
      const ratio = safeTotal > 0 ? loaded / safeTotal : 0;
      onProgress({ loaded, total: safeTotal, ratio });
    });
  }

  let raw: string;
  try {
    raw = await Promise.resolve(
      bridge.request(
        method,
        url,
        JSON.stringify(headerMap),
        bodyBase64,
        progressId,
        expectedTotal > 0 ? String(expectedTotal) : '0',
      ),
    );
  } catch (error) {
    const message =
      typeof error === 'string' && error.trim()
        ? error.trim()
        : error instanceof Error && error.message.trim()
          ? error.message.trim()
          : '连不上账号服务';
    throw new Error(message);
  } finally {
    if (progressId) progressHandlers.delete(progressId);
  }

  let parsed: { status?: number; bodyBase64?: string; contentType?: string };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new Error('账号服务没有返回结果');
  }

  const status = typeof parsed.status === 'number' ? parsed.status : 0;
  if (status <= 0) {
    throw new Error('连不上账号服务');
  }

  const bytes = base64ToBytes(parsed.bodyBase64 ?? '');
  const contentType = parsed.contentType || 'application/octet-stream';
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  if (progress?.onProgress) {
    const total = bytes.byteLength || expectedTotal;
    progress.onProgress({ loaded: total, total, ratio: 1 });
  }
  return new Response(new Blob([copy], { type: contentType }), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

async function bodyToBytes(body: BodyInit, headers: Headers): Promise<Uint8Array> {
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const encoded = await encodeFormData(body);
    headers.set('Content-Type', encoded.contentType);
    return encoded.bytes;
  }
  throw new Error('不支持的上传内容');
}

async function encodeFormData(form: FormData): Promise<{ bytes: Uint8Array; contentType: string }> {
  const boundary = `qy${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  const push = (text: string) => chunks.push(encoder.encode(text));
  for (const [name, value] of form.entries()) {
    push(`--${boundary}\r\n`);
    if (typeof value === 'string') {
      push(`Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
      continue;
    }
    const filename = value.name || 'sample.wav';
    const type = value.type || 'application/octet-stream';
    push(
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    );
    chunks.push(new Uint8Array(await value.arrayBuffer()));
    push('\r\n');
  }
  push(`--${boundary}--\r\n`);
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { bytes, contentType: `multipart/form-data; boundary=${boundary}` };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

function base64ToBytes(input: string): Uint8Array {
  if (!input) return new Uint8Array(0);
  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

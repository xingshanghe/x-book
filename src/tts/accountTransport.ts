/**
 * 桌面壳里的账号请求走本机 curl。
 * 阅读窗口是安全来源，直接 fetch http:// 会被系统拦住，表现就是「连不上账号服务」。
 * 服务器其实收不到这次请求。
 */

export async function accountFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { invoke } = await import('@tauri-apps/api/core');
  const url = requestUrl(input);
  const method = (init?.method ?? 'GET').toUpperCase();
  const headers = new Headers(init?.headers);
  let bodyBase64: string | null = null;
  if (typeof init?.body === 'string') {
    bodyBase64 = bytesToBase64(new TextEncoder().encode(init.body));
  } else if (init?.body instanceof FormData) {
    const encoded = await encodeFormData(init.body);
    bodyBase64 = bytesToBase64(encoded.bytes);
    headers.set('Content-Type', encoded.contentType);
  }
  const headerMap: Record<string, string> = {};
  headers.forEach((value, key) => {
    headerMap[key] = value;
  });
  const result = await invoke<{ status: number; body: string }>('account_http', {
    request: { method, url, bodyBase64, headers: headerMap },
  });
  return new Response(result.body, {
    status: result.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
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
  const step = 0x1000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

/**
 * 轻量 S3 客户端（SigV4），专供 MinIO path-style。
 * 不引入 aws-sdk，控制包体。
 *
 * 反代注意：endpoint 形如 http://host/s3 时，实际请求路径带 /s3 前缀，
 * 但签名用的 canonical URI 必须是 MinIO 收到的路径（去掉 /s3），
 * 否则签名校验失败。
 */

export interface S3ClientOptions {
  endpoint: string;
  accessKey: string;
  secretKey: string;
  region?: string;
}

export class S3Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'S3Error';
  }
}

export function createS3Client(opts: S3ClientOptions) {
  const endpoint = opts.endpoint.replace(/\/+$/, '');
  const region = opts.region ?? 'us-east-1';
  const { accessKey, secretKey } = opts;

  const parsed = new URL(endpoint);
  const host = parsed.host;
  /** 反代前缀，如 "/s3"；直连 MinIO 时为空 */
  const proxyPrefix = parsed.pathname.replace(/\/+$/, '') || '';

  async function request(
    method: string,
    /** MinIO 侧路径，以 / 开头，不含 proxyPrefix，如 /bucket/key */
    objectPath: string,
    body?: BodyInit | null,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const amzDate = toAmzDate(new Date());
    const dateStamp = amzDate.slice(0, 8);
    // 大文件（≥8MB）用 UNSIGNED-PAYLOAD，避免整包进内存算 SHA-256
    const useUnsigned =
      body != null &&
      !(typeof body === 'string') &&
      (body instanceof Blob ? body.size >= 8 * 1024 * 1024 : (body as ArrayBuffer).byteLength >= 8 * 1024 * 1024);
    const payloadHash = useUnsigned
      ? 'UNSIGNED-PAYLOAD'
      : body
        ? await sha256Hex(typeof body === 'string' ? body : await toArrayBuffer(body))
        : await sha256Hex('');

    // host 只参与签名；浏览器 fetch 不允许也不需要手动设 Host
    const signHeaders: Record<string, string> = {
      host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      ...extraHeaders,
    };

    const signedHeaderNames = Object.keys(signHeaders)
      .map((k) => k.toLowerCase())
      .sort();
    const signedHeaders = signedHeaderNames.join(';');
    const canonicalHeaders = signedHeaderNames
      .map((k) => {
        const raw = signHeaders[k] ?? signHeaders[Object.keys(signHeaders).find((x) => x.toLowerCase() === k)!];
        return `${k}:${raw.trim()}\n`;
      })
      .join('');

    const qIndex = objectPath.indexOf('?');
    const uriPath = qIndex >= 0 ? objectPath.slice(0, qIndex) : objectPath;
    const canonicalQuery = qIndex >= 0 ? objectPath.slice(qIndex + 1) : '';
    const canonicalRequest = [
      method,
      uriPath,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = await getSignatureKey(secretKey, dateStamp, region, 's3');
    const signature = await hmacHex(signingKey, stringToSign);

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const url = `${parsed.origin}${proxyPrefix}${objectPath}`;
    const sendHeaders: Record<string, string> = {
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: authorization,
      ...extraHeaders,
    };
    const res = await fetch(url, {
      method,
      headers: sendHeaders,
      body: body ?? undefined,
    });

    return res;
  }

  return {
    async putObject(
      bucket: string,
      key: string,
      body: Blob | ArrayBuffer | string,
      contentType = 'application/octet-stream',
    ): Promise<void> {
      const path = `/${bucket}/${encodeS3Key(key)}`;
      // Blob 直接流式上传（大文件配合 UNSIGNED-PAYLOAD）；小字符串 / ArrayBuffer 原样传
      const payload: BodyInit =
        typeof body === 'string' || body instanceof ArrayBuffer || body instanceof Blob
          ? body
          : await (body as Blob).arrayBuffer();
      const res = await request('PUT', path, payload, {
        'content-type': contentType,
      });
      if (!res.ok) {
        throw new S3Error(await readError(res), res.status);
      }
    },

    async getObject(bucket: string, key: string): Promise<Blob> {
      const path = `/${bucket}/${encodeS3Key(key)}`;
      const res = await request('GET', path);
      if (!res.ok) {
        throw new S3Error(await readError(res), res.status);
      }
      return res.blob();
    },

    async headObject(bucket: string, key: string): Promise<boolean> {
      const path = `/${bucket}/${encodeS3Key(key)}`;
      const res = await request('HEAD', path);
      if (res.status === 404) return false;
      if (!res.ok) {
        throw new S3Error(await readError(res), res.status);
      }
      return true;
    },

    async listObjects(bucket: string, prefix: string): Promise<string[]> {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const params = new URLSearchParams();
        params.set('list-type', '2');
        params.set('prefix', prefix);
        if (token) params.set('continuation-token', token);
        // 查询串必须按 key 排序后编码（SigV4 要求）
        const query = [...params.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
          .join('&');
        const path = `/${bucket}?${query}`;
        const res = await request('GET', path);
        if (!res.ok) {
          throw new S3Error(await readError(res), res.status);
        }
        const xml = await res.text();
        keys.push(...parseListKeys(xml));
        token = parseContinuationToken(xml);
      } while (token);
      return keys;
    },

    async createBucket(bucket: string): Promise<void> {
      const res = await request('PUT', `/${bucket}`);
      // 200/200 OK；已存在时 MinIO 返回 BucketAlreadyOwnedByYou（409）——视为成功
      if (res.ok || res.status === 409) return;
      throw new S3Error(await readError(res), res.status);
    },

    async ensureBucket(bucket: string): Promise<void> {
      try {
        await this.createBucket(bucket);
      } catch (err) {
        // 竞态或权限问题：随后 list 再试
        if (err instanceof S3Error && (err.status === 409 || err.status === 200)) return;
        throw err;
      }
    },

    async probe(bucket: string): Promise<{ ok: boolean; reason?: string }> {
      try {
        await this.ensureBucket(bucket);
        const params = new URLSearchParams();
        params.set('list-type', '2');
        params.set('max-keys', '1');
        params.set('prefix', 'books/');
        const query = [...params.entries()]
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => `${uriEncode(k)}=${uriEncode(v)}`)
          .join('&');
        const res = await request('GET', `/${bucket}?${query}`);
        if (!res.ok) {
          return { ok: false, reason: await readError(res) };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}

export type S3Client = ReturnType<typeof createS3Client>;

/* ───────────── helpers ───────────── */

function encodeS3Key(key: string): string {
  return key
    .split('/')
    .map((seg) => uriEncode(seg))
    .join('/');
}

/** AWS 风格 URI 编码：空格 → %20，不编码 ~ */
function uriEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function toAmzDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return hex(hash);
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyBytes =
    key instanceof Uint8Array ? key.slice().buffer : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

async function hmacHex(key: ArrayBuffer, data: string): Promise<string> {
  return hex(await hmac(key, data));
}

async function getSignatureKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Promise<ArrayBuffer> {
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function toArrayBuffer(body: BodyInit): Promise<ArrayBuffer> {
  if (typeof body === 'string') return new TextEncoder().encode(body).buffer;
  if (body instanceof ArrayBuffer) return body;
  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  }
  if (body instanceof Blob) return body.arrayBuffer();
  // FormData / URLSearchParams / ReadableStream —— 本客户端不会传
  throw new Error('unsupported body type');
}

async function readError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    const msg = text.match(/<Message>([^<]+)<\/Message>/)?.[1];
    return msg ? `${res.status} ${msg}` : `${res.status} ${res.statusText || text.slice(0, 120)}`;
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}

function parseListKeys(xml: string): string[] {
  const keys: string[] = [];
  const re = /<Key>([^<]+)<\/Key>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    keys.push(decodeXml(m[1]));
  }
  return keys;
}

function parseContinuationToken(xml: string): string | undefined {
  if (!/<IsTruncated>true<\/IsTruncated>/i.test(xml)) return undefined;
  const m = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
  return m ? decodeXml(m[1]) : undefined;
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

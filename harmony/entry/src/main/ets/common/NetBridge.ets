/**
 * 鸿蒙壳网络桥：H5 在 https://local.qingyue 下直连明文 http:// 会被 ArkWeb 拦掉，
 * 表现就是登录/注册 toast「Failed to fetch」。桌面壳用 curl 绕过，这里用系统 HTTP。
 *
 * 前端通过 window.__QY_NET__.request(method, url, headersJson, bodyBase64, progressId?, expectedTotal?)
 * 调用，返回 Promise<string>（JSON：{ status, bodyBase64, contentType }）。
 *
 * 带 progressId 的云书架传输出流式请求，期间经 progressEmitter 回调真实字节；
 * H5 侧由 Index 注入 window.__QY_NET_PROGRESS__(id, loaded, total)。
 *
 * 体积说明：经 JSBridge 传 base64，手机内存扛不住桌面壳那档 300MB；
 * 这里上限 64MB，覆盖账号与多数 txt 云同步；超大 PDF 需另做分片通道。
 */

import http from '@ohos.net.http';
import { util } from '@kit.ArkTS';
import { hilog } from '@kit.PerformanceAnalysisKit';

const TAG = 'QingYueNet';
const ALLOWED_HOSTS: string[] = ['47.108.79.158'];
/** JSBridge 传 base64 的实用上限（账号 8MB 够用；云书架 txt 通常远小于此） */
const MAX_BODY = 64 * 1024 * 1024;
const ACCOUNT_TIMEOUT_MS = 40_000;
const CLOUD_TIMEOUT_MS = 600_000;

export type ProgressEmitter = (id: string, loaded: number, total: number) => void;

class EmitThrottle {
  lastAt: number = 0;
  lastLoaded: number = -1;
}

export class NetBridge {
  private progressEmitter: ProgressEmitter | null = null;
  private emitThrottleById: Record<string, EmitThrottle> = {};

  setProgressEmitter(emitter: ProgressEmitter): void {
    this.progressEmitter = emitter;
  }

  /**
   * 同步注册到 methodList，但返回 Promise，H5 侧可 await。
   * headersJson: JSON 对象字符串；bodyBase64 无体时传空串。
   * progressId / expectedTotal 由 H5 可选传入（JSBridge 只方便传字符串）。
   */
  request(
    method: string,
    url: string,
    headersJson: string,
    bodyBase64: string,
    progressId?: string,
    expectedTotal?: string,
  ): Promise<string> {
    return new Promise<string>((resolve: (value: string) => void, reject: (reason: string) => void) => {
      const verb = (method || 'GET').toUpperCase();
      if (verb !== 'GET' && verb !== 'POST' && verb !== 'PUT' && verb !== 'DELETE' && verb !== 'HEAD') {
        reject('不支持的请求方法');
        return;
      }
      if (!urlAllowed(url)) {
        reject('账号服务地址不正确');
        return;
      }

      let headers: Record<string, string> = {};
      try {
        if (headersJson && headersJson.length > 0) {
          headers = JSON.parse(headersJson) as Record<string, string>;
        }
      } catch (_e) {
        reject('请求头无法解析');
        return;
      }

      let body: ArrayBuffer | undefined = undefined;
      let uploadTotal = 0;
      if (bodyBase64 && bodyBase64.length > 0) {
        try {
          const bytes = base64Decode(bodyBase64);
          if (bytes.byteLength > MAX_BODY) {
            reject('上传内容太大');
            return;
          }
          body = bytes;
          uploadTotal = bytes.byteLength;
        } catch (_e) {
          reject('请求内容无法解析');
          return;
        }
      }

      const progressKey = (progressId || '').trim();
      const parsedExpected = Number(expectedTotal || '0');
      const knownTotal =
        parsedExpected > 0 ? parsedExpected : uploadTotal > 0 ? uploadTotal : 0;
      const wantProgress = progressKey.length > 0 && isCloudFileUrl(url);

      const timeoutMs = isCloudUrl(url) ? CLOUD_TIMEOUT_MS : ACCOUNT_TIMEOUT_MS;
      const client = http.createHttp();
      const options: http.HttpRequestOptions = {
        method: mapMethod(verb),
        header: sanitizeHeaders(headers),
        expectDataType: http.HttpDataType.ARRAY_BUFFER,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
      };
      if (body !== undefined) {
        options.extraData = body;
      }

      if (wantProgress) {
        this.runStreamRequest(client, url, options, progressKey, knownTotal, uploadTotal > 0, resolve, reject);
        return;
      }

      client
        .request(url, options)
        .then((data: http.HttpResponse) => {
          try {
            const result = data.result;
            let bytes: Uint8Array;
            if (result instanceof ArrayBuffer) {
              bytes = new Uint8Array(result);
            } else if (typeof result === 'string') {
              bytes = encodeText(result);
            } else {
              bytes = new Uint8Array(0);
            }
            const contentType = readContentType(data.header) || 'application/octet-stream';
            const payload = JSON.stringify({
              status: data.responseCode,
              bodyBase64: base64Encode(bytes),
              contentType: contentType,
            });
            resolve(payload);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            hilog.error(0x0000, TAG, `打包响应失败: ${msg}`);
            reject('连不上账号服务');
          } finally {
            client.destroy();
          }
        })
        .catch((e: Error) => {
          client.destroy();
          const msg = e?.message ?? String(e);
          hilog.error(0x0000, TAG, `请求失败 ${verb} ${url}: ${msg}`);
          reject('连不上账号服务');
        });
    });
  }

  private emitProgress(id: string, loaded: number, total: number): void {
    const emitter = this.progressEmitter;
    if (!emitter) {
      return;
    }
    let state = this.emitThrottleById[id];
    if (!state) {
      state = new EmitThrottle();
      this.emitThrottleById[id] = state;
    }
    const now = Date.now();
    if (loaded !== total && now - state.lastAt < 100 && Math.abs(loaded - state.lastLoaded) < 32 * 1024) {
      return;
    }
    state.lastAt = now;
    state.lastLoaded = loaded;
    try {
      emitter(id, loaded, total);
    } catch (_e) {
      // 忽略 H5 未就绪
    }
  }

  private clearEmitThrottle(id: string): void {
    // ArkTS 禁止 delete；重建一份去掉该 id 的表
    const next: Record<string, EmitThrottle> = {};
    const keys = Object.keys(this.emitThrottleById);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (key !== id) {
        next[key] = this.emitThrottleById[key];
      }
    }
    this.emitThrottleById = next;
  }

  private runStreamRequest(
    client: http.HttpRequest,
    url: string,
    options: http.HttpRequestOptions,
    progressId: string,
    knownTotal: number,
    isUpload: boolean,
    resolve: (value: string) => void,
    reject: (reason: string) => void,
  ): void {
    const chunks: ArrayBuffer[] = [];
    let contentType = 'application/octet-stream';
    let received = 0;
    let totalHint = knownTotal;
    let aborted = false;
    this.emitProgress(progressId, 0, totalHint);

    client.on('headersReceive', (header: Object) => {
      const ct = readContentType(header);
      if (ct) {
        contentType = ct;
      }
      const len = readContentLength(header);
      if (len > 0) {
        totalHint = Math.max(totalHint, len);
      }
      if (len > MAX_BODY) {
        aborted = true;
        try {
          client.destroy();
        } catch (_e) {
          // ignore
        }
      }
    });

    client.on('dataReceive', (data: ArrayBuffer) => {
      if (aborted) {
        return;
      }
      received += data.byteLength;
      if (received > MAX_BODY) {
        aborted = true;
        chunks.length = 0;
        try {
          client.destroy();
        } catch (_e) {
          // ignore
        }
        return;
      }
      chunks.push(data);
      if (!isUpload) {
        const total = totalHint > 0 ? totalHint : received;
        this.emitProgress(progressId, received, total);
      }
    });

    client.on('dataReceiveProgress', (info: http.DataReceiveProgressInfo) => {
      if (isUpload) {
        return;
      }
      const loaded = info.receiveSize;
      if (info.totalSize > 0) {
        totalHint = Math.max(totalHint, info.totalSize);
      }
      const total = totalHint > 0 ? totalHint : loaded;
      this.emitProgress(progressId, loaded, total);
    });

    client.on('dataSendProgress', (info: http.DataSendProgressInfo) => {
      if (!isUpload) {
        return;
      }
      const loaded = info.sendSize;
      const total = info.totalSize > 0 ? info.totalSize : totalHint > 0 ? totalHint : loaded;
      this.emitProgress(progressId, loaded, total);
    });

    client
      .requestInStream(url, options)
      .then((responseCode: number) => {
        try {
          if (aborted) {
            reject('云书架响应过大');
            return;
          }
          const bytes = concatChunks(chunks);
          if (bytes.byteLength > MAX_BODY) {
            reject('云书架响应过大');
            return;
          }
          const total = isUpload
            ? totalHint > 0
              ? totalHint
              : bytes.byteLength
            : bytes.byteLength || totalHint;
          this.emitProgress(progressId, total, total > 0 ? total : 1);
          const payload = JSON.stringify({
            status: responseCode,
            bodyBase64: base64Encode(bytes),
            contentType: contentType,
          });
          resolve(payload);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          hilog.error(0x0000, TAG, `打包流式响应失败: ${msg}`);
          reject('连不上账号服务');
        } finally {
          this.clearEmitThrottle(progressId);
          cleanupHttp(client);
        }
      })
      .catch((e: Error) => {
        this.clearEmitThrottle(progressId);
        cleanupHttp(client);
        if (aborted) {
          reject('云书架响应过大');
          return;
        }
        const msg = e?.message ?? String(e);
        hilog.error(0x0000, TAG, `流式请求失败 ${url}: ${msg}`);
        reject('连不上账号服务');
      });
  }
}

function cleanupHttp(client: http.HttpRequest): void {
  try {
    client.off('headersReceive');
    client.off('dataReceive');
    client.off('dataReceiveProgress');
    client.off('dataSendProgress');
  } catch (_e) {
    // ignore
  }
  client.destroy();
}

function concatChunks(chunks: ArrayBuffer[]): Uint8Array {
  let size = 0;
  for (let i = 0; i < chunks.length; i++) {
    size += chunks[i].byteLength;
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (let i = 0; i < chunks.length; i++) {
    out.set(new Uint8Array(chunks[i]), offset);
    offset += chunks[i].byteLength;
  }
  return out;
}

function encodeText(text: string): Uint8Array {
  try {
    const encoder = new util.TextEncoder();
    // 优先 encode；部分 SDK 把 encodeInto(string) 当 encode 用
    const anyEncoder = encoder as Object as Record<string, Function>;
    if (typeof anyEncoder['encode'] === 'function') {
      return anyEncoder['encode'](text) as Uint8Array;
    }
    return anyEncoder['encodeInto'](text) as Uint8Array;
  } catch (_e) {
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) {
      out[i] = text.charCodeAt(i) & 0xff;
    }
    return out;
  }
}

function mapMethod(verb: string): http.RequestMethod {
  if (verb === 'POST') return http.RequestMethod.POST;
  if (verb === 'PUT') return http.RequestMethod.PUT;
  if (verb === 'DELETE') return http.RequestMethod.DELETE;
  if (verb === 'HEAD') return http.RequestMethod.HEAD;
  return http.RequestMethod.GET;
}

function urlAllowed(url: string): boolean {
  if (!url || url.length > 2000 || url.startsWith('-')) {
    return false;
  }
  for (let i = 0; i < url.length; i++) {
    const code = url.charCodeAt(i);
    if (code < 32 || code === 127) {
      return false;
    }
  }
  let rest = '';
  if (url.startsWith('https://')) {
    rest = url.substring('https://'.length);
  } else if (url.startsWith('http://')) {
    rest = url.substring('http://'.length);
  } else {
    return false;
  }
  if (!rest || rest.startsWith('/')) {
    return false;
  }
  if (rest.indexOf('@') >= 0) {
    return false;
  }
  const slash = rest.indexOf('/');
  if (slash < 0) {
    return false;
  }
  const hostPort = rest.substring(0, slash);
  const pathAndQuery = rest.substring(slash + 1);
  const colon = hostPort.indexOf(':');
  const host = colon >= 0 ? hostPort.substring(0, colon) : hostPort;
  if (ALLOWED_HOSTS.indexOf(host) < 0) {
    return false;
  }
  const path = pathAndQuery.split('?')[0].split('#')[0];
  const segments = path.split('/');
  for (let i = 0; i < segments.length; i++) {
    if (segments[i] === '..') {
      return false;
    }
  }
  // 账号 / 建档 / 云书架 / TTS 静态都在同一主机的 /v1 或 /tts 下
  return path === 'v1' || path.startsWith('v1/') || path === 'tts' || path.startsWith('tts/');
}

function isCloudUrl(url: string): boolean {
  const marker = '://47.108.79.158/';
  const at = url.indexOf(marker);
  if (at < 0) {
    return false;
  }
  const path = url.substring(at + marker.length);
  return path === 'v1/books' || path.startsWith('v1/books/');
}

/** 书籍文件上传/下载（需要字节进度） */
function isCloudFileUrl(url: string): boolean {
  if (!isCloudUrl(url)) {
    return false;
  }
  const marker = '://47.108.79.158/';
  const at = url.indexOf(marker);
  const path = url.substring(at + marker.length).split('?')[0].split('#')[0];
  return path.indexOf('/file') >= 0 || path.endsWith('/file');
}

function sanitizeHeaders(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const keys = Object.keys(input);
  for (let i = 0; i < keys.length; i++) {
    const name = keys[i];
    const value = input[name];
    if (!headerAllowed(name)) {
      continue;
    }
    if (typeof value !== 'string') {
      continue;
    }
    if (value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0 || value.length > 4096) {
      continue;
    }
    out[name] = value;
  }
  return out;
}

function headerAllowed(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === 'content-type' || lower === 'authorization';
}

function readContentType(header: Object | string | undefined): string {
  if (!header) {
    return '';
  }
  if (typeof header === 'string') {
    return '';
  }
  const map = header as Record<string, string | string[]>;
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === 'content-type') {
      const raw = map[keys[i]];
      const text = Array.isArray(raw) ? raw[0] : raw;
      if (!text) {
        return '';
      }
      const semi = text.indexOf(';');
      return (semi >= 0 ? text.substring(0, semi) : text).trim();
    }
  }
  return '';
}

function readContentLength(header: Object | string | undefined): number {
  if (!header || typeof header === 'string') {
    return 0;
  }
  const map = header as Record<string, string | string[]>;
  const keys = Object.keys(map);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === 'content-length') {
      const raw = map[keys[i]];
      const text = Array.isArray(raw) ? raw[0] : raw;
      const n = Number(text);
      return Number.isFinite(n) && n > 0 ? n : 0;
    }
  }
  return 0;
}

function base64Encode(bytes: Uint8Array): string {
  const helper = new util.Base64Helper();
  return helper.encodeToStringSync(bytes);
}

function base64Decode(input: string): ArrayBuffer {
  const helper = new util.Base64Helper();
  const cleaned = input.replace(/\s+/g, '');
  const bytes = helper.decodeSync(cleaned);
  // 拷一份，避免 Uint8Array 是 SharedArrayBuffer 视图时带上多余字节
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

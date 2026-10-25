import { manifestReady } from './manifest';
import type { EngineFile, EngineManifest, EnginePhase } from './types';

export interface ByteSink {
  size(): Promise<number>;
  write(chunk: Uint8Array): Promise<void>;
  bytes(): Promise<Uint8Array>;
  /** 校验通过后留下最终文件，失败时由调用方 discard。 */
  commit(): Promise<void>;
  discard(): Promise<void>;
}

export interface DownloadResult {
  phase: EnginePhase;
  error?: string;
}

/**
 * 用户确认之后才下载。confirmed 为 false 时不调用 fetch。
 * 校验失败会丢掉已写入的字节，状态回到 absent。
 */
export async function downloadEngine(opts: {
  confirmed: boolean;
  manifest: EngineManifest;
  fetchImpl?: typeof fetch;
  openSink: (file: EngineFile) => ByteSink;
  signal?: AbortSignal;
  onPhase?: (phase: EnginePhase) => void;
}): Promise<DownloadResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const setPhase = (phase: EnginePhase) => opts.onPhase?.(phase);

  if (!opts.confirmed) {
    setPhase('absent');
    return { phase: 'absent' };
  }
  if (!manifestReady(opts.manifest)) {
    setPhase('failed');
    return { phase: 'failed', error: '引擎清单还没有校验值，暂不能下载' };
  }

  setPhase('downloading');
  try {
    for (const file of opts.manifest.files) {
      const sink = opts.openSink(file);
      const existing = await sink.size();
      const headers: Record<string, string> = {};
      if (existing > 0) headers.Range = `bytes=${existing}-`;
      const response = await fetchImpl(file.url, { headers, signal: opts.signal });
      if (!response.ok && response.status !== 206) {
        setPhase('failed');
        return { phase: 'failed', error: `下载失败（${response.status}）` };
      }
      const reader = response.body?.getReader();
      if (!reader) {
        const whole = new Uint8Array(await response.arrayBuffer());
        await sink.write(whole);
      } else {
        while (true) {
          if (opts.signal?.aborted) {
            setPhase('absent');
            return { phase: 'absent', error: '已取消' };
          }
          const step = await reader.read();
          if (step.done) break;
          await sink.write(step.value);
        }
      }

      if (opts.signal?.aborted) {
        setPhase('absent');
        return { phase: 'absent', error: '已取消' };
      }
      setPhase('verifying');
      const got = await sha256Hex(await sink.bytes());
      if (got.toLowerCase() !== file.sha256.toLowerCase()) {
        await sink.discard();
        setPhase('absent');
        return { phase: 'absent', error: '校验不一致，已删除未完成的文件' };
      }
      await sink.commit();
    }
    setPhase('installed');
    return { phase: 'installed' };
  } catch (error) {
    if (opts.signal?.aborted) {
      setPhase('absent');
      return { phase: 'absent', error: '已取消' };
    }
    setPhase('failed');
    return { phase: 'failed', error: error instanceof Error ? error.message : '下载失败' };
  }
}

export function createMemorySink(): ByteSink & { snapshot(): Uint8Array } {
  let stored = new Uint8Array(0);
  let discarded = false;
  return {
    async size() {
      return discarded ? 0 : stored.byteLength;
    },
    async write(chunk) {
      if (discarded) stored = new Uint8Array(0);
      discarded = false;
      const next = new Uint8Array(stored.byteLength + chunk.byteLength);
      next.set(stored, 0);
      next.set(chunk, stored.byteLength);
      stored = next;
    },
    async bytes() {
      return stored;
    },
    snapshot() {
      return stored;
    },
    async commit() {},
    async discard() {
      stored = new Uint8Array(0);
      discarded = true;
    },
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

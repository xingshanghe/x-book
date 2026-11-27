import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudFetchWithProgress } from '@/sync/cloudBooks/progressFetch';

describe('cloudFetchWithProgress XHR 真实进度', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('下载 onprogress 按 loaded/total 报 ratio', async () => {
    class FakeXHR {
      static UNSENT = 0;
      readyState = 0;
      status = 0;
      statusText = '';
      response: Blob | null = null;
      responseType = '';
      upload = { onprogress: null as ((ev: ProgressEvent) => void) | null };
      onprogress: ((ev: ProgressEvent) => void) | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;

      open(): void {
        this.readyState = 1;
      }
      setRequestHeader(): void {}
      getAllResponseHeaders(): string {
        return 'content-length: 1000\r\ncontent-type: application/octet-stream\r\n';
      }
      send(): void {
        this.onprogress?.({ lengthComputable: true, loaded: 400, total: 1000 } as ProgressEvent);
        this.onprogress?.({ lengthComputable: true, loaded: 1000, total: 1000 } as ProgressEvent);
        this.status = 200;
        this.statusText = 'OK';
        this.response = new Blob([new Uint8Array(1000)]);
        this.onload?.();
      }
    }

    vi.stubGlobal('XMLHttpRequest', FakeXHR as unknown as typeof XMLHttpRequest);
    vi.stubGlobal('window', { __QY_NET__: undefined } as Window & typeof globalThis);

    const ticks: number[] = [];
    const res = await cloudFetchWithProgress(
      'http://example.test/file',
      { method: 'GET' },
      (p) => ticks.push(p.ratio),
      { expectedTotal: 1000 },
    );

    expect(res.ok).toBe(true);
    expect(ticks).toContain(0.4);
    expect(ticks.at(-1)).toBe(1);
  });
});

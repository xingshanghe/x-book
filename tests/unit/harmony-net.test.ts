import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { harmonyFetch, hasHarmonyNet } from '@/lib/harmonyNet';

type Bridge = NonNullable<Window['__QY_NET__']>;

function installWindow(): void {
  const stub = { __QY_NET__: undefined as Bridge | undefined } as unknown as Window &
    typeof globalThis;
  vi.stubGlobal('window', stub);
}

describe('鸿蒙网络桥', () => {
  beforeEach(() => {
    installWindow();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('没有桥时 hasHarmonyNet 为 false', () => {
    expect(hasHarmonyNet()).toBe(false);
  });

  it('注入桥后 hasHarmonyNet 为 true', () => {
    window.__QY_NET__ = {
      request: () => Promise.resolve('{}'),
    };
    expect(hasHarmonyNet()).toBe(true);
  });

  it('harmonyFetch 把原生 JSON 封成 Response', async () => {
    const body = JSON.stringify({ success: true, message: 'ok', data: { id: '1' } });
    window.__QY_NET__ = {
      request: vi.fn(async (method, url, headersJson, bodyBase64, progressId, expectedTotal) => {
        expect(method).toBe('POST');
        expect(url).toBe('http://47.108.79.158/v1/auth/login');
        const headers = JSON.parse(headersJson) as Record<string, string>;
        const contentType = headers['Content-Type'] ?? headers['content-type'];
        expect(contentType).toBe('application/json');
        expect(atob(bodyBase64)).toContain('xingshanghe');
        expect(progressId).toBe('');
        // 无进度回调时仍会带 body 大小；H5 侧不监听即可
        expect(Number(expectedTotal)).toBeGreaterThan(0);
        return JSON.stringify({
          status: 200,
          bodyBase64: btoa(body),
          contentType: 'application/json',
        });
      }),
    };

    const response = await harmonyFetch('http://47.108.79.158/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'xingshanghe', password: 'secret123' }),
    });

    expect(response.ok).toBe(true);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });

  it('带进度时注册 __QY_NET_PROGRESS__ 并传入 progressId', async () => {
    const ticks: Array<{ loaded: number; total: number; ratio: number }> = [];
    window.__QY_NET__ = {
      request: vi.fn(async (_m, _u, _h, _b, progressId, expectedTotal) => {
        expect(progressId).toMatch(/^hm-/);
        expect(expectedTotal).toBe('1024');
        window.__QY_NET_PROGRESS__?.(progressId!, 512, 1024);
        return JSON.stringify({
          status: 200,
          bodyBase64: btoa('ok'),
          contentType: 'application/octet-stream',
        });
      }),
    };

    await harmonyFetch(
      'http://47.108.79.158/v1/books/cloud/fp/file',
      { method: 'GET' },
      {
        expectedTotal: 1024,
        onProgress: (p) => ticks.push(p),
      },
    );

    expect(ticks.some((t) => t.loaded === 512 && t.total === 1024 && t.ratio === 0.5)).toBe(true);
    expect(ticks.at(-1)?.ratio).toBe(1);
    // 全局分发器常驻；任务结束后 handler 已卸掉
    expect(typeof window.__QY_NET_PROGRESS__).toBe('function');
  });

  it('原生 reject 时抛出可读错误', async () => {
    window.__QY_NET__ = {
      request: () => Promise.reject('连不上账号服务'),
    };
    await expect(harmonyFetch('http://47.108.79.158/v1/auth/login')).rejects.toThrow(
      '连不上账号服务',
    );
  });
});

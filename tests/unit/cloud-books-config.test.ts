import { describe, expect, it } from 'vitest';
import {
  cloudConfigReady,
  defaultCloudConfig,
  readCloudConfig,
  writeCloudConfig,
} from '@/sync/cloudBooks/config';

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

describe('cloudBooks config', () => {
  it('defaults enabled with api base', () => {
    const s = memoryStorage();
    const cfg = readCloudConfig(s);
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiBase).toContain('47.108');
    expect(cloudConfigReady(cfg)).toBe(true);
  });

  it('migrates old /s3 endpoint to api root', () => {
    const s = memoryStorage({
      'qingyue.cloud.v1': JSON.stringify({
        enabled: true,
        endpoint: 'http://47.108.79.158/s3',
        accessKey: 'old',
        secretKey: 'old',
      }),
    });
    const cfg = readCloudConfig(s);
    expect(cfg.apiBase).toBe('http://47.108.79.158');
  });

  it('persists apiBase without secrets', () => {
    const s = memoryStorage();
    const next = writeCloudConfig({ enabled: false, apiBase: ' http://example.com/ ' }, s);
    expect(next.enabled).toBe(false);
    expect(next.apiBase).toBe('http://example.com');
    const raw = JSON.parse(s.getItem('qingyue.cloud.v1')!);
    expect(raw.accessKey).toBeUndefined();
    expect(raw.secretKey).toBeUndefined();
  });

  it('defaultCloudConfig is ready', () => {
    expect(cloudConfigReady(defaultCloudConfig())).toBe(true);
  });
});

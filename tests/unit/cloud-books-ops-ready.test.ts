import { describe, expect, it } from 'vitest';
import { cloudConfigReady, cloudOpsReady, defaultCloudConfig } from '@/sync/cloudBooks/config';

describe('cloudOpsReady', () => {
  it('requires both enabled config and login', () => {
    const cfg = defaultCloudConfig();
    expect(cloudConfigReady(cfg)).toBe(true);
    expect(cloudOpsReady(cfg, false)).toBe(false);
    expect(cloudOpsReady(cfg, true)).toBe(true);
  });

  it('stays false when cloud shelf is disabled even if logged in', () => {
    expect(cloudOpsReady({ ...defaultCloudConfig(), enabled: false }, true)).toBe(false);
  });

  it('stays false when apiBase is empty', () => {
    expect(cloudOpsReady({ enabled: true, apiBase: '' }, true)).toBe(false);
  });
});

/** 同步能力入口：createSync() 的能力探测与适配器选择 */

import type { SyncStatus } from '@/types/models';
import { NoopAdapter } from './noopAdapter';
import { SyncEngine } from './engine';
import type { SyncAdapter, SyncConfig } from './types';

export type { SyncAdapter, SyncConfig, SyncStatus };
export { NoopAdapter, SyncEngine };

/**
 * 能力探测 + 适配器选择。
 * 当前只注册了 noop（单机）；未来接入 HTTP/WebDAV 适配器时在此登记即可，
 * UI 与存储层完全不动。
 */
const ADAPTERS: SyncAdapter[] = [new NoopAdapter()];

export function availableAdapters(): SyncAdapter[] {
  return ADAPTERS;
}

export function createSync(config: SyncConfig | null): SyncEngine {
  const chosen =
    ADAPTERS.find((a) => a.id === config?.adapterId && config.enabled) ?? new NoopAdapter();
  return new SyncEngine(chosen.id === 'noop' ? null : config);
}

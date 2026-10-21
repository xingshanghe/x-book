/** 默认适配器：永远单机，零网络请求 */

import type { SyncOp, SyncPayload } from '@/types/models';
import type { SyncAdapter } from './types';

export class NoopAdapter implements SyncAdapter {
  readonly id = 'noop';
  readonly label = '单机模式';

  async probe(): Promise<{ ok: boolean; reason?: string }> {
    return { ok: false, reason: '未配置同步服务' };
  }

  async pull(): Promise<SyncPayload> {
    return { serverTime: Date.now(), ops: [] };
  }

  async push(_ops: SyncOp[]): Promise<void> {
    /* 单机： nothing to do */
  }
}

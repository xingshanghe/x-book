/**
 * 同步接口（可选能力，本期只留接口 + 单机模式）。
 *
 * 硬约束：
 *   · 默认实现是 NoopAdapter —— 不配置就永不发任何请求；
 *   · 适配器抛出的任何异常都会被 engine 捕获并降级，
 *     绝不允许影响本地功能（C4）。
 */

import type { SyncOp, SyncPayload } from '@/types/models';

export interface SyncAdapter {
  readonly id: string;
  readonly label: string;
  /** 能力探测：4s 超时，任何异常都视为不可用 */
  probe(signal: AbortSignal): Promise<{ ok: boolean; reason?: string }>;
  pull(since: number, signal: AbortSignal): Promise<SyncPayload>;
  push(ops: SyncOp[], signal: AbortSignal): Promise<void>;
}

export interface SyncConfig {
  adapterId: string | null;
  endpoint?: string;
  token?: string;
  enabled: boolean;
}

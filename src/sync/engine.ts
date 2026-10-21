/**
 * 同步引擎：状态机 disabled → probing → online ⇄ degraded → disabled
 *
 * 铁律（C4）：任何异常 → 静默降级，不弹窗、不清数据、不阻塞本地功能。
 * 本期只接 NoopAdapter（永远 disabled）；HTTP 适配器留到下一期，
 * 但状态机与降级逻辑现在就位，接入时无需改动 UI。
 */

import type { SyncOp, SyncStatus } from '@/types/models';
import { NoopAdapter } from './noopAdapter';
import type { SyncAdapter, SyncConfig } from './types';

export type SyncListener = (status: SyncStatus) => void;

const BACKOFF = [30_000, 120_000, 600_000];

export class SyncEngine {
  private adapter: SyncAdapter;
  private config: SyncConfig;
  private status: SyncStatus;
  private listeners = new Set<SyncListener>();
  private backoffIndex = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private outbox: SyncOp[] = [];

  constructor(config: SyncConfig | null) {
    this.config = config ?? { adapterId: null, enabled: false };
    this.adapter = new NoopAdapter();
    this.status = {
      state: 'disabled',
      adapterId: 'noop',
      pendingOps: 0,
    };
  }

  onChange(fn: SyncListener): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  /** 启动：没有配置 → 直接停在 disabled，不发任何请求 */
  start(): void {
    if (!this.config?.enabled || !this.config.adapterId || this.config.adapterId === 'noop') {
      this.setState({ state: 'disabled', adapterId: 'noop', pendingOps: this.outbox.length });
      return;
    }
    void this.probe();
  }

  stop(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.setState({ state: 'disabled', adapterId: 'noop', pendingOps: this.outbox.length });
  }

  /** UI 的「手动重试」按钮 */
  retry(): void {
    this.backoffIndex = 0;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.probe();
  }

  /** 本地变更入队（LWW 时间戳），仅 online 状态会尝试推送 */
  enqueue(op: SyncOp): void {
    this.outbox.push(op);
    if (this.outbox.length > 500) this.outbox.splice(0, this.outbox.length - 500);
    this.setState({ ...this.status, pendingOps: this.outbox.length });
  }

  private setState(next: SyncStatus): void {
    this.status = next;
    for (const fn of this.listeners) fn(next);
  }

  private async probe(): Promise<void> {
    this.setState({ ...this.status, state: 'probing' });
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const killer = setTimeout(() => this.controller?.abort(), 4000);
    try {
      const res = await this.adapter.probe(signal);
      if (res.ok) {
        this.backoffIndex = 0;
        this.setState({
          state: 'online',
          adapterId: this.adapter.id,
          lastOkAt: Date.now(),
          pendingOps: this.outbox.length,
        });
        void this.flush();
      } else {
        this.degrade(res.reason ?? '探测未通过');
      }
    } catch (e) {
      this.degrade(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(killer);
    }
  }

  private degrade(reason: string): void {
    const delay = BACKOFF[Math.min(this.backoffIndex, BACKOFF.length - 1)];
    this.backoffIndex++;
    this.setState({
      state: 'degraded',
      adapterId: this.adapter.id,
      lastError: reason,
      pendingOps: this.outbox.length,
    });
    this.timer = setTimeout(() => void this.probe(), delay);
  }

  private async flush(): Promise<void> {
    if (this.status.state !== 'online' || this.outbox.length === 0) return;
    this.controller = new AbortController();
    const batch = this.outbox.slice(0, 50);
    try {
      await this.adapter.push(batch, this.controller.signal);
      this.outbox.splice(0, batch.length);
      this.setState({ ...this.status, pendingOps: this.outbox.length, lastOkAt: Date.now() });
      if (this.outbox.length) void this.flush();
    } catch (e) {
      this.degrade(e instanceof Error ? e.message : String(e));
    }
  }
}

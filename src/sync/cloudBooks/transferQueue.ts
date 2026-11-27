/** 云书架上传 / 下载任务队列（进度托盘 + 封面角标共用） */

import { create } from 'zustand';
import { nanoid } from '@/lib/id';

export type TransferKind = 'upload' | 'download';
export type TransferStatus = 'running' | 'done' | 'error';

export interface TransferTask {
  id: string;
  kind: TransferKind;
  fingerprint: string;
  title: string;
  size: number;
  /** 0–1 */
  ratio: number;
  status: TransferStatus;
  error?: string;
}

interface TransferStore {
  tasks: TransferTask[];
  begin: (input: {
    kind: TransferKind;
    fingerprint: string;
    title: string;
    size: number;
  }) => string;
  patch: (id: string, patch: Partial<TransferTask>) => void;
  finish: (id: string, patch?: Partial<TransferTask>) => void;
  fail: (id: string, error: string) => void;
  clearFinished: () => void;
}

export const useTransferQueue = create<TransferStore>((set) => ({
  tasks: [],

  begin: (input) => {
    const id = nanoid(8);
    const task: TransferTask = {
      id,
      kind: input.kind,
      fingerprint: input.fingerprint,
      title: input.title,
      size: input.size,
      ratio: 0,
      status: 'running',
    };
    set((s) => ({
      // 同 fingerprint 旧任务（含失败残留）清掉，避免托盘叠两条
      tasks: [...s.tasks.filter((t) => t.fingerprint !== input.fingerprint), task],
    }));
    return id;
  },

  patch: (id, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  finish: (id, patch) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...patch, status: 'done', ratio: 1 } : t)),
    })),

  fail: (id, error) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, status: 'error', error } : t)),
    })),

  clearFinished: () =>
    set((s) => ({
      tasks: s.tasks.filter((t) => t.status === 'running'),
    })),
}));

export function describeTransfer(t: TransferTask): string {
  if (t.status === 'error') return t.error ?? '失败';
  if (t.status === 'done') return t.kind === 'upload' ? '已上传' : '已下载';
  const pct = Math.round(t.ratio * 100);
  return t.kind === 'upload' ? `上传中 ${pct}%` : `下载中 ${pct}%`;
}

export function activeTransferByFingerprint(
  tasks: TransferTask[],
  fingerprint: string,
): TransferTask | undefined {
  return tasks.find((t) => t.fingerprint === fingerprint && t.status === 'running');
}

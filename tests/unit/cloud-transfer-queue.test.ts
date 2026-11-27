import { beforeEach, describe, expect, it } from 'vitest';
import {
  activeTransferByFingerprint,
  describeTransfer,
  useTransferQueue,
} from '@/sync/cloudBooks/transferQueue';

describe('cloud transferQueue', () => {
  beforeEach(() => {
    useTransferQueue.setState({ tasks: [] });
  });

  it('tracks upload progress and finish', () => {
    const id = useTransferQueue.getState().begin({
      kind: 'upload',
      fingerprint: 'fp1',
      title: '龙宫',
      size: 1024,
    });
    useTransferQueue.getState().patch(id, { ratio: 0.42 });
    const running = activeTransferByFingerprint(useTransferQueue.getState().tasks, 'fp1');
    expect(running?.ratio).toBeCloseTo(0.42);
    expect(describeTransfer(running!)).toContain('42%');

    useTransferQueue.getState().finish(id);
    const done = useTransferQueue.getState().tasks.find((t) => t.id === id);
    expect(done?.status).toBe('done');
    expect(done?.ratio).toBe(1);
    expect(activeTransferByFingerprint(useTransferQueue.getState().tasks, 'fp1')).toBeUndefined();
  });

  it('replaces prior task for same fingerprint', () => {
    useTransferQueue.getState().begin({
      kind: 'download',
      fingerprint: 'fp2',
      title: '旧',
      size: 1,
    });
    useTransferQueue.getState().begin({
      kind: 'download',
      fingerprint: 'fp2',
      title: '新',
      size: 2,
    });
    const tasks = useTransferQueue.getState().tasks.filter((t) => t.fingerprint === 'fp2');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('新');
  });

  it('records failure message', () => {
    const id = useTransferQueue.getState().begin({
      kind: 'download',
      fingerprint: 'fp3',
      title: '坏书',
      size: 10,
    });
    useTransferQueue.getState().fail(id, '网络中断');
    const task = useTransferQueue.getState().tasks.find((t) => t.id === id)!;
    expect(task.status).toBe('error');
    expect(describeTransfer(task)).toBe('网络中断');
  });
});

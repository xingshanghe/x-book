/** 拖放导入 + 导入 / 云传输任务托盘 */

import { useEffect, useMemo } from 'react';
import { describeTask, totalBytes, useImportQueue } from '@/features/import/importQueue';
import { formatBytes } from '@/lib/format';
import { describeTransfer, useTransferQueue } from '@/sync/cloudBooks/transferQueue';
import { Progress } from '@/ui';
import { IconClose } from '@/ui/icons';

/**
 * 返回拖放绑定与当前拖入状态。
 * 监听器由 installGlobalDrop() 统一挂在 window 上（任何页面拖入都生效），
 * 这里只负责把状态读出来给遮罩用。
 */
export function useDropImport() {
  const dragging = useImportQueue((s) => s.dragging);
  const props = {};
  return [props, dragging] as const;
}

export function ImportTray() {
  const importTasks = useImportQueue((s) => s.tasks);
  const clearImports = useImportQueue((s) => s.clearFinished);
  const transferTasks = useTransferQueue((s) => s.tasks);
  const clearTransfers = useTransferQueue((s) => s.clearFinished);

  const activeImports = importTasks.filter((t) => t.status === 'running' || t.status === 'queued');
  const activeTransfers = transferTasks.filter((t) => t.status === 'running');
  const activeCount = activeImports.length + activeTransfers.length;
  const finishedImports = importTasks.length - activeImports.length;
  const finishedTransfers = transferTasks.length - activeTransfers.length;

  const headLabel = useMemo(() => {
    const bits: string[] = [];
    if (activeTransfers.length) bits.push(`传输 ${activeTransfers.length}`);
    if (activeImports.length) bits.push(`导入 ${activeImports.length}`);
    if (!bits.length) {
      if (transferTasks.length) bits.push('传输完成');
      if (importTasks.length) bits.push('导入完成');
    }
    const bytes =
      (importTasks.length ? totalBytes(importTasks) : '') ||
      (transferTasks.length ? formatBytes(transferTasks.reduce((acc, t) => acc + t.size, 0)) : '');
    return `${bits.join(' · ') || '任务'}${bytes ? ` · ${bytes}` : ''}`;
  }, [activeTransfers.length, activeImports.length, transferTasks, importTasks]);

  useEffect(() => {
    if (activeCount > 0) return;
    const hasDoneOnly =
      importTasks.every((t) => t.status !== 'error') &&
      transferTasks.every((t) => t.status !== 'error');
    // 失败项留着让用户看清原因；仅成功时自动收起
    if (!hasDoneOnly) return;
    if (importTasks.length === 0 && transferTasks.length === 0) return;
    const timer = setTimeout(() => {
      clearImports();
      clearTransfers();
    }, 6000);
    return () => clearTimeout(timer);
  }, [activeCount, importTasks, transferTasks, clearImports, clearTransfers]);

  if (importTasks.length === 0 && transferTasks.length === 0) return null;

  const transferSlice = transferTasks.slice(-3);
  const importSlice = importTasks.slice(-3);

  return (
    <aside className="import-tray" aria-live="polite">
      <div className="import-tray-head">
        <span>{headLabel}</span>
        {activeCount === 0 && (
          <button
            type="button"
            className="qy-icon-btn"
            style={{ width: 26, height: 26 }}
            onClick={() => {
              clearImports();
              clearTransfers();
            }}
            aria-label="收起"
          >
            <IconClose size={14} />
          </button>
        )}
      </div>
      {transferSlice.map((t) => (
        <div key={`xfer:${t.id}`} className={`import-item ${t.status === 'error' ? 'error' : ''}`}>
          <div className="name">
            {t.kind === 'upload' ? '↑' : '↓'} {t.title}
          </div>
          {t.status === 'running' ? (
            <Progress value={t.ratio} thin />
          ) : (
            <div className="state">{describeTransfer(t)}</div>
          )}
        </div>
      ))}
      {importSlice.map((t) => (
        <div key={`imp:${t.id}`} className={`import-item ${t.status === 'error' ? 'error' : ''}`}>
          <div className="name">{t.fileName}</div>
          {t.status === 'running' ? (
            <Progress value={t.ratio} thin />
          ) : (
            <div className="state">{describeTask(t)}</div>
          )}
        </div>
      ))}
      {(finishedImports > 0 || finishedTransfers > 0) && activeCount > 0 && (
        <div className="import-item">
          <div className="state">另有 {finishedImports + finishedTransfers} 项已完成</div>
        </div>
      )}
    </aside>
  );
}

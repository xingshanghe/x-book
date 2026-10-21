/** 拖放导入 + 导入任务托盘 */

import { useEffect, useRef, useState } from 'react';
import { describeTask, totalBytes, useImportQueue } from '@/features/import/importQueue';
import { Progress } from '@/ui';
import { IconClose } from '@/ui/icons';

/** 返回拖放事件绑定与当前拖入状态 */
export function useDropImport() {
  const [dragging, setDragging] = useState(false);
  const counter = useRef(0);
  const add = useImportQueue((s) => s.add);

  useEffect(() => {
    // 阻止浏览器默认打开文件
    const prevent = (e: DragEvent) => {
      e.preventDefault();
    };
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      counter.current++;
      if (e.dataTransfer?.types.includes('Files')) setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      e.preventDefault();
      counter.current = Math.max(0, counter.current - 1);
      if (counter.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      counter.current = 0;
      setDragging(false);
      const files = e.dataTransfer?.files;
      if (files?.length) add([...files]);
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', prevent);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [add]);

  const props = {};
  return [props, dragging] as const;
}

export function ImportTray() {
  const tasks = useImportQueue((s) => s.tasks);
  const clearFinished = useImportQueue((s) => s.clearFinished);

  const active = tasks.filter((t) => t.status === 'running' || t.status === 'queued');
  const finished = tasks.length - active.length;

  useEffect(() => {
    if (active.length === 0 && tasks.length > 0) {
      const timer = setTimeout(() => clearFinished(), 6000);
      return () => clearTimeout(timer);
    }
  }, [active.length, tasks.length, clearFinished]);

  if (tasks.length === 0) return null;

  return (
    <aside className="import-tray" aria-live="polite">
      <div className="import-tray-head">
        <span>
          导入中 {active.length > 0 ? `· ${active.length}` : ''} · {totalBytes(tasks)}
        </span>
        {active.length === 0 && (
          <button
            type="button"
            className="qy-icon-btn"
            style={{ width: 26, height: 26 }}
            onClick={clearFinished}
            aria-label="收起"
          >
            <IconClose size={14} />
          </button>
        )}
      </div>
      {tasks.slice(-4).map((t) => (
        <div key={t.id} className={`import-item ${t.status === 'error' ? 'error' : ''}`}>
          <div className="name">{t.fileName}</div>
          {t.status === 'running' ? (
            <Progress value={t.ratio} thin />
          ) : (
            <div className="state">{describeTask(t)}</div>
          )}
        </div>
      ))}
      {finished > 0 && active.length > 0 && (
        <div className="import-item">
          <div className="state">另有 {finished} 项已完成</div>
        </div>
      )}
    </aside>
  );
}

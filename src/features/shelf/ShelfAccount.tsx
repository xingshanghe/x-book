import { type ComponentType, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** 书架右上角的账号入口。点开才加载账号代码；不登录也可以继续用书架和阅读。 */
export function ShelfAccount({ toast }: { toast: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [Panel, setPanel] = useState<ComponentType<{ toast: (text: string) => void }> | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = () => {
    setOpen(true);
    if (Panel) return;
    void import('@/features/settings/UserCenterSection').then((mod) => {
      setPanel(() => mod.UserCenterSection);
    });
  };

  return (
    <div className="shelf-account">
      <button type="button" className="shelf-account-btn" aria-expanded={open} aria-label="账号" onClick={toggle}>
        账号
      </button>
      {open &&
        createPortal(
          <div className="qy-overlay shelf-account-modal" onMouseDown={() => setOpen(false)}>
            <div
              className="shelf-account-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="账号"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button type="button" className="shelf-account-close" onClick={() => setOpen(false)}>
                关闭
              </button>
              {Panel ? <Panel toast={toast} /> : <p className="desc">正在打开账号…</p>}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

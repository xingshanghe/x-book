import { type ComponentType, useEffect, useRef, useState } from 'react';

/** 书架右上角的账号入口。点开才加载账号代码；不登录也可以继续用书架和阅读。 */
export function ShelfAccount({ toast }: { toast: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [Panel, setPanel] = useState<ComponentType<{ toast: (text: string) => void }> | null>(
    null,
  );
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const toggle = () => {
    setOpen((value) => !value);
    if (Panel) return;
    void import('@/features/settings/UserCenterSection').then((mod) => {
      setPanel(() => mod.UserCenterSection);
    });
  };

  return (
    <div className="shelf-account" ref={root}>
      <button
        type="button"
        className="shelf-account-btn"
        aria-expanded={open}
        aria-label="账号"
        onClick={toggle}
      >
        账号
      </button>
      {open && (
        <div className="shelf-account-pop">
          {Panel ? <Panel toast={toast} /> : <p className="desc">正在打开账号…</p>}
        </div>
      )}
    </div>
  );
}

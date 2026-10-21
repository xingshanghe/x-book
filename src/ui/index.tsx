/** 设计系统：Button / Segmented / Slider / Switch / Sheet / Drawer / Progress / EmptyState / Toast */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import './ui.css';
import { IconClose } from './icons';

/* ─────────────── Button ─────────────── */

type ButtonVariant = 'primary' | 'ghost' | 'soft' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export function Button({
  children,
  variant = 'soft',
  size = 'md',
  icon,
  block,
  ...rest
}: {
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  block?: boolean;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'size'>) {
  const cls = ['qy-btn', `qy-btn-${variant}`, `qy-btn-${size}`, block ? 'qy-btn-block' : '']
    .filter(Boolean)
    .join(' ');
  return (
    <button type="button" className={cls} {...rest}>
      {icon}
      {children != null && children !== '' && <span>{children}</span>}
    </button>
  );
}

/* ─────────────── Segmented ─────────────── */

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`qy-seg qy-seg-${size}`} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className="qy-seg-item"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ─────────────── Slider ─────────────── */

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  label: ReactNode;
}) {
  const id = useId();
  return (
    <div className="qy-row">
      <label className="qy-row-label" htmlFor={id}>
        {label}
      </label>
      <div className="qy-slider">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output className="mono">{format ? format(value) : value}</output>
      </div>
    </div>
  );
}

/* ─────────────── Switch ─────────────── */

export function Switch({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="qy-row">
      <div className="qy-row-text">
        <span className="qy-row-label">{label}</span>
        {hint && <span className="qy-row-hint">{hint}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`qy-switch${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="qy-switch-knob" />
      </button>
    </div>
  );
}

/* ─────────────── Sheet（底部弹层，移动端） / Drawer（侧栏） ─────────────── */

function useLockScroll(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  side = 'bottom',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  side?: 'bottom' | 'left' | 'right';
}) {
  useLockScroll(open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="qy-overlay" onClick={onClose} role="presentation">
      <div
        className={`qy-sheet qy-sheet-${side}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {(title || side !== 'bottom') && (
          <header className="qy-sheet-head">
            <h3>{title}</h3>
            <button type="button" className="qy-icon-btn" onClick={onClose} aria-label="关闭">
              <IconClose />
            </button>
          </header>
        )}
        <div className="qy-sheet-body">{children}</div>
      </div>
    </div>
  );
}

/* ─────────────── Progress ─────────────── */

export function Progress({
  value,
  indeterminate,
  thin,
  style,
}: {
  value?: number;
  indeterminate?: boolean;
  thin?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`qy-progress${thin ? ' thin' : ''}`}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round((value ?? 0) * 100)}
      style={style}
    >
      {indeterminate ? (
        <span className="qy-progress-indeterminate" />
      ) : (
        <span style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      )}
    </div>
  );
}

/* ─────────────── EmptyState ─────────────── */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="qy-empty">
      <div className="qy-empty-art" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <h3>{title}</h3>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}

/* ─────────────── Toast ─────────────── */

interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'ok' | 'warn';
}

const ToastCtx = createContext<{ push: (text: string, kind?: ToastItem['kind']) => void }>({
  push: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((text: string, kind: ToastItem['kind'] = 'info') => {
    const id = ++seq.current;
    setItems((prev) => [...prev.slice(-2), { id, text, kind }]);
    setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="qy-toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`qy-toast qy-toast-${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

/* ─────────────── Menu（轻量弹出菜单） ─────────────── */

export function Menu({
  trigger,
  items,
  align = 'start',
}: {
  trigger: ReactNode;
  items: { key: string; label: ReactNode; danger?: boolean; onSelect: () => void }[];
  align?: 'start' | 'end';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  return (
    <div className="qy-menu" ref={ref}>
      <span onClick={() => setOpen((v) => !v)}>{trigger}</span>
      {open && (
        <div className={`qy-menu-list ${align === 'end' ? 'end' : ''}`} role="menu">
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              className={it.danger ? 'danger' : ''}
              onClick={() => {
                setOpen(false);
                it.onSelect();
              }}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

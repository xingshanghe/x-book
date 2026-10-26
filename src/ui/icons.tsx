/** 设计系统图标：手写 SVG，线性 1.5px，24 网格 */
import type { CSSProperties } from 'react';

type P = { size?: number; style?: CSSProperties; className?: string };

const base = (size = 20): { width: number; height: number; viewBox: string; fill: string; stroke: string; strokeWidth: number; strokeLinecap: 'round'; strokeLinejoin: 'round' } => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
});

export function IconBook({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5V5.5" />
      <path d="M20 18v3H6.5" />
    </svg>
  );
}

export function IconGear({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.2l2 1.2M17.5 15.6l2 1.2M4.5 16.8l2-1.2M17.5 8.4l2-1.2" />
    </svg>
  );
}

export function IconPlus({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconSearch({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  );
}

export function IconList({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M4 6h16M4 12h12M4 18h8" />
    </svg>
  );
}

export function IconBookmark({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M7 3h10a1 1 0 0 1 1 1v17l-6-4.5L6 21V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

export function IconSun({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5 5l1.4 1.4M17.6 17.6L19 19M19 5l-1.4 1.4M6.4 17.6L5 19" />
    </svg>
  );
}

export function IconMoon({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />
    </svg>
  );
}

export function IconChevronLeft({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

export function IconChevronRight({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}

export function IconTrash({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />
    </svg>
  );
}

export function IconClose({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function IconSettings2({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
      <circle cx="15" cy="8" r="2" />
      <circle cx="9" cy="16" r="2" />
    </svg>
  );
}

/** 更多操作：三个圆点 */
export function IconMore({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <circle cx="5.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 音色：五根等高错落的声纹 */
export function IconVoice({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4" />
    </svg>
  );
}

export function IconSpark({ size, style, className }: P) {
  return (
    <svg {...base(size)} style={style} className={className} aria-hidden>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}

/**
 * 品牌符号（VI v2.0 §03）：一页纸的折角
 *   画布 80×104，页身 60×96，右上折角边长 22 严格 45°，填朱砂；
 *   描边 4.5 随尺寸等比，线端圆角、拐角斜接。
 * 16px 以下改用「实心页身 + 折角负形」，保证 favicon / 小图标仍是一页纸。
 * size = 图形宽度（高度按 80:104 推出），注意图形比字标高半格。
 */
export function LogoMark({ size = 20, style, className }: P & { size?: number }) {
  const solid = size < 18;
  return (
    <svg
      width={size}
      height={(size * 104) / 80}
      viewBox="0 0 80 104"
      style={style}
      className={className}
      aria-hidden
    >
      {solid ? (
        <>
          <path
            d="M14 2h34l30 30v70a2 2 0 0 1-2 2H14a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z"
            fill="currentColor"
          />
          <path d="M48 2l30 30H48Z" fill="var(--paper-1)" />
        </>
      ) : (
        <>
          <path
            d="M16 4H48L70 26V94a6 6 0 0 1-6 6H16a6 6 0 0 1-6-6V10a6 6 0 0 1 6-6Z"
            fill="none"
            stroke="currentColor"
            strokeWidth={4.5}
            strokeLinejoin="round"
          />
          <path d="M48 4l22 22H48Z" fill="var(--seal)" />
          {size >= 30 && (
            <path
              d="M30 42h20M30 56h20M30 70h12"
              stroke="currentColor"
              strokeWidth={4}
              strokeLinecap="round"
              opacity={0.26}
            />
          )}
        </>
      )}
    </svg>
  );
}

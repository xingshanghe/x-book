/**
 * 订阅 matchMedia，横竖屏 / 窄宽切换时同步重渲染。
 */

import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [query]);

  return matches;
}

/** 阅读器 / 书架：窄屏或竖屏手机不常驻侧栏，改用抽屉 */
export const NARROW_LAYOUT_QUERY = '(max-width: 820px)';

export function useNarrowLayout(): boolean {
  return useMediaQuery(NARROW_LAYOUT_QUERY);
}

/** 横屏矮窗：顶栏少占垂直空间（手机横屏、折叠内屏等） */
export const LANDSCAPE_COMPACT_QUERY = '(orientation: landscape) and (max-height: 560px)';

const LANDSCAPE_COMPACT_MAX_HEIGHT = 560;

function landscapeCompactBySize(): boolean {
  if (typeof window === 'undefined') return false;
  // ArkWeb 等对 orientation 媒体查询不可靠：用宽>高 + 矮窗兜底
  return window.innerWidth > window.innerHeight && window.innerHeight <= LANDSCAPE_COMPACT_MAX_HEIGHT;
}

export function useLandscapeCompact(): boolean {
  const mq = useMediaQuery(LANDSCAPE_COMPACT_QUERY);
  const [bySize, setBySize] = useState(landscapeCompactBySize);

  useEffect(() => {
    const sync = () => setBySize(landscapeCompactBySize());
    sync();
    window.addEventListener('resize', sync, { passive: true });
    window.addEventListener('orientationchange', sync, { passive: true });
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, []);

  return mq || bySize;
}

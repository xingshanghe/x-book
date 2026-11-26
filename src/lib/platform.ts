/**
 * 平台探测：只做能力判断，不做 UA 嗅探品牌的分支。
 * 所有返回值都允许在 SSR/Worker 之外调用（内部有 typeof 保护）。
 */

export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

export function isStandalone(): boolean {
  if (!isBrowser()) return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    navigator.standalone === true
  );
}

export function isTouch(): boolean {
  if (!isBrowser()) return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

export function supportsFilePicker(): boolean {
  if (!isBrowser()) return false;
  return typeof (window as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker === 'function';
}

export function isTauri(): boolean {
  if (!isBrowser()) return false;
  const w = window as unknown as Record<string, unknown>;
  return typeof w.__TAURI_INTERNALS__ !== 'undefined' || Boolean(w.isTauri);
}

export function isIOS(): boolean {
  if (!isBrowser()) return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export type OsName = 'macos' | 'windows' | 'linux' | 'ios' | 'android' | 'harmony';

export function detectOs(): OsName {
  if (!isBrowser()) return 'linux';
  const ua = navigator.userAgent;
  if (/OpenHarmony|HarmonyOS/i.test(ua)) return 'harmony';
  if (/Android/i.test(ua)) return 'android';
  if (isIOS()) return 'ios';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macos';
  return 'linux';
}

/**
 * 把运行环境写到 <html data-os data-shell data-arkweb> 上，交给 CSS 适配窗口 chrome。
 *
 * 为什么需要它：macOS 壳用 Overlay 标题栏，红绿灯是浮在网页内容之上的，
 * 页面必须自己让出左上角那条区域，否则品牌字会被圆点压住；
 * Windows / Linux 保留系统标题栏，内容从 0 开始，不让位。
 * 浏览器 / PWA 里没有任何系统按钮，同样不让位。
 * 鸿蒙 ArkWeb 全屏时 status bar 叠在内容上，且常不回报 safe-area，需 CSS 兜底。
 */
export function applyPlatformFlags(): void {
  if (!isBrowser()) return;
  const el = document.documentElement;
  el.dataset.os = detectOs();
  el.dataset.shell = isTauri() ? 'tauri' : 'web';
  if (isArkWeb()) {
    el.dataset.arkweb = '1';
    // ArkWeb 对 env(safe-area-*) / CSS max() 不可靠，直接写入可计算的安全区
    const insetTop = readSafeInset('top');
    const insetBottom = readSafeInset('bottom');
    el.style.setProperty('--safe-t', `${Math.max(insetTop, 56)}px`);
    el.style.setProperty('--safe-b', `${Math.max(insetBottom, 20)}px`);
  } else {
    delete el.dataset.arkweb;
  }
}

/** 读取 env(safe-area-inset-*)；解析失败或不支持时返回 0。 */
function readSafeInset(edge: 'top' | 'bottom' | 'left' | 'right'): number {
  if (!isBrowser()) return 0;
  try {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;' +
      `padding-${edge}:env(safe-area-inset-${edge}, 0px);`;
    document.documentElement.appendChild(probe);
    const raw = getComputedStyle(probe).getPropertyValue(`padding-${edge}`);
    probe.remove();
    const px = Number.parseFloat(raw);
    return Number.isFinite(px) ? px : 0;
  } catch {
    return 0;
  }
}

/** 是否为 HarmonyOS ArkWeb（仅用于规避少数已知差异，不做功能降级） */
export function isArkWeb(): boolean {
  if (!isBrowser()) return false;
  const w = window as unknown as { __QY_HARMONY__?: boolean };
  if (w.__QY_HARMONY__ === true) return true;
  return /OpenHarmony|HarmonyOS/i.test(navigator.userAgent);
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!isBrowser() || !navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function estimateQuota(): Promise<{ usage: number; quota: number } | null> {
  if (!isBrowser() || !navigator.storage?.estimate) return null;
  try {
    const e = await navigator.storage.estimate();
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

export function prefersDark(): boolean {
  if (!isBrowser()) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function prefersReducedMotion(): boolean {
  if (!isBrowser()) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

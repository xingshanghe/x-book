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

/** 是否为 HarmonyOS ArkWeb（仅用于规避少数已知差异，不做功能降级） */
export function isArkWeb(): boolean {
  if (!isBrowser()) return false;
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

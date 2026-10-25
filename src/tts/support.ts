import { detectOs, isTauri } from '@/lib/platform';

/** 阶段 1 只在 macOS 桌面壳里下载引擎和朗读。其他端只提示，不发下载。 */
export function desktopReadingReady(): boolean {
  return isTauri() && detectOs() === 'macos';
}

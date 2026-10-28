import { detectOs, isArkWeb, isTauri } from '@/lib/platform';

/** 手机、鸿蒙和浏览器点朗读时看到的说明。这些环境不能执行下载来的程序。 */
export const READING_UNSUPPORTED = '请用 Windows、Linux 或 macOS 桌面版朗读';

/**
 * 桌面壳可以下载引擎并调用本机程序。
 * Android、iOS 不允许执行下载来的程序，鸿蒙外壳也没有这条通道。
 */
export function desktopReadingReady(): boolean {
  if (!isTauri() || isArkWeb()) return false;
  const os = detectOs();
  return os === 'macos' || os === 'windows' || os === 'linux';
}
